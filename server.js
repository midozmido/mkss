#!/usr/bin/env node
// نقطة الدخول — سيرفر HTTP + المراقب، على node:http وحده.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import crypto from 'node:crypto';

import { db, get, run, nowISO, setting } from './src/db.js';
import { migrate } from './src/migrations.js';
import * as auth from './src/auth.js';
import * as repo from './src/repo.js';
import * as admin from './src/admin-repo.js';
import * as monitor from './src/monitor.js';
import {
  esc, createRouter, readForm as readFormRaw, parseCookies, cookieHeader, sendHtml, sendJson, redirect,
  securityHeaders, clientIp, createRateLimiter, pick,
} from './src/http-util.js';
import * as pages from './src/views/pages.js';
import * as adminViews from './src/views/admin.js';
import * as billing from './src/billing.js';
import * as chat from './src/chat.js';
import * as billingViews from './src/views/billing.js';
import * as chatViews from './src/views/chat.js';
import * as bot from './src/bot.js';
import * as kb from './src/kb.js';
import * as kbViews from './src/views/kb.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECURE = BASE_URL.startsWith('https:');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/** يعيد استخدام النموذج الذي قرأه فحص CSRF بدل قراءة الجسم مرتين */
const readForm = (req) => (req.parsedForm ? Promise.resolve(req.parsedForm) : readFormRaw(req));

const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });
const formLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
const chatLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

// ——————————————————— الملفات الساكنة ———————————————————

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const staticCache = new Map();

function serveStatic(res, pathname) {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, 'public', rel);
  if (!file.startsWith(join(ROOT, 'public')) || !existsSync(file)) return false;
  const ext = file.slice(file.lastIndexOf('.'));
  if (!MIME[ext]) return false;

  let body = staticCache.get(file);
  if (!body || process.env.NODE_ENV !== 'production') {
    body = readFileSync(file);
    staticCache.set(file, body);
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext],
    'Cache-Control': process.env.NODE_ENV === 'production' ? 'public, max-age=3600' : 'no-store',
  });
  res.end(body);
  return true;
}

// ——————————————————— الرسائل العابرة ———————————————————

function flashCookie(kind, text) {
  return cookieHeader('mkss_flash', JSON.stringify({ kind, text }), { maxAge: 20, secure: SECURE, sameSite: 'Lax' });
}
function readFlash(req) {
  const raw = parseCookies(req).mkss_flash;
  if (!raw) return null;
  try {
    const f = JSON.parse(raw);
    return f && typeof f.text === 'string' ? f : null;
  } catch {
    return null;
  }
}
const clearFlash = () => cookieHeader('mkss_flash', '', { maxAge: 0, secure: SECURE });

// ——————————————————— المسارات ———————————————————

const router = createRouter();

// —— الدخول والخروج ——

router.get('/login', (ctx) => {
  if (ctx.user) return redirect(ctx.res, ctx.user.role === 'admin' ? '/admin' : '/');
  sendHtml(ctx.res, pages.loginPage({ notice: ctx.query.get('activated') ? 'تم تفعيل حسابك. سجّل الدخول الآن.' : null }));
});

router.post('/login', async (ctx) => {
  const form = await readForm(ctx.req);
  const email = String(form.email || '').trim().toLowerCase();
  const key = `${ctx.ip}|${email}`;

  if (!loginLimiter.check(key).allowed || auth.loginBlocked(key)) {
    return sendHtml(ctx.res, pages.loginPage({ error: 'محاولات كثيرة. انتظر ربع ساعة ثم حاول مجددًا.', email }), { status: 429 });
  }

  const user = auth.findUserByEmail(email);
  // تجزئة وهمية عند غياب الحساب: بدونها يفضح فرقُ التوقيت أي الإيميلات مسجلة
  const okPassword = user ? auth.verifyPassword(form.password || '', user.password_hash) : (auth.burnTime(), false);

  if (!user || !okPassword || !user.active) {
    auth.noteLoginFailure(key);
    return sendHtml(ctx.res, pages.loginPage({ error: 'البريد أو كلمة السر غير صحيحة.', email }), { status: 401 });
  }

  auth.clearLoginFailures(key);
  loginLimiter.reset(key);
  const session = auth.createSession(user.id, { ip: ctx.ip, ua: ctx.req.headers['user-agent'] });
  admin.audit(user.id, 'login', `user#${user.id}`, null, ctx.ip);

  redirect(ctx.res, user.role === 'admin' ? '/admin' : '/', {
    headers: {
      'Set-Cookie': cookieHeader(auth.COOKIE_NAME, session.id, { expires: session.expires, secure: SECURE }),
    },
  });
});

router.post('/logout', async (ctx) => {
  auth.destroySession(ctx.sid);
  redirect(ctx.res, '/login', {
    headers: { 'Set-Cookie': cookieHeader(auth.COOKIE_NAME, '', { maxAge: 0, secure: SECURE }) },
  });
});

// —— طلب إعادة التعيين: لا شيء يحدث تلقائيًا ——

router.post('/reset-request', async (ctx) => {
  const form = await readForm(ctx.req);
  const email = String(form.email || '').trim().toLowerCase();
  if (formLimiter.check(ctx.ip).allowed && email) {
    const user = auth.findUserByEmail(email);
    if (user) {
      const existing = get("SELECT id FROM reset_requests WHERE user_id = ? AND status = 'pending'", user.id);
      if (!existing) {
        run('INSERT INTO reset_requests(user_id, requested_at, ip) VALUES(?,?,?)', user.id, nowISO(), ctx.ip);
      }
    }
  }
  // الرد واحد دائمًا — لا نؤكد للمهاجم أي إيميل مسجل عندنا
  sendHtml(
    ctx.res,
    pages.loginPage({ notice: 'إذا كان البريد مسجلًا لدينا، سيتواصل معك فريقنا برابط جديد.' })
  );
});

// —— التفعيل واختيار كلمة السر ——

router.get('/activate/:token', (ctx) => {
  const link = auth.peekOneTimeLink(ctx.params.token);
  if (!link) {
    return sendHtml(
      ctx.res,
      pages.errorPage({ status: 410, message: 'هذا الرابط منتهٍ أو مستخدَم من قبل. اطلب رابطًا جديدًا من فريقنا.' }),
      { status: 410 }
    );
  }
  sendHtml(ctx.res, pages.setPasswordPage({ token: ctx.params.token, kind: link.kind }));
});

router.post('/set-password', async (ctx) => {
  const form = await readForm(ctx.req);
  const token = String(form.token || '');
  const link = auth.peekOneTimeLink(token);
  if (!link) {
    return sendHtml(ctx.res, pages.errorPage({ status: 410, message: 'الرابط منتهٍ أو مستخدَم.' }), { status: 410 });
  }
  const pw = String(form.password || '');
  const problem = auth.passwordProblem(pw) || (pw !== form.confirm ? 'كلمتا السر غير متطابقتين' : null);
  if (problem) {
    return sendHtml(ctx.res, pages.setPasswordPage({ token, kind: link.kind, error: problem }), { status: 400 });
  }
  const consumed = auth.consumeOneTimeLink(token);
  if (!consumed) {
    return sendHtml(ctx.res, pages.errorPage({ status: 410, message: 'الرابط استُخدم للتو.' }), { status: 410 });
  }
  auth.setUserPassword(consumed.user_id, pw);
  run("UPDATE reset_requests SET status = 'used', handled_at = ? WHERE user_id = ? AND status = 'issued'", nowISO(), consumed.user_id);
  admin.audit(consumed.user_id, 'set_password', `user#${consumed.user_id}`, consumed.kind, ctx.ip);
  redirect(ctx.res, '/login?activated=1');
});

// —— صفحات العميل ——

router.get('/', (ctx) => {
  if (!ctx.user) return redirect(ctx.res, '/login');
  if (ctx.user.role === 'admin') return redirect(ctx.res, '/admin');
  const st = ctx.user.billing || billing.accountState(ctx.user.id);
  const banner = billingViews.billingBanner(st, {
    link: billing.whatsappLink(`السلام عليكم، أنا ${ctx.user.name} وأريد تفعيل الاشتراك`),
  });
  sendHtml(ctx.res, pages.dashboardPage({
    user: ctx.user, data: repo.dashboard(ctx.user.id), flash: ctx.flash, billingBanner: banner,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.get('/site/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const site = repo.getSite(ctx.user.id, id);
  const check = repo.latestCheck(ctx.user.id, id);
  let detail = null;
  try { detail = check?.detail ? JSON.parse(check.detail) : null; } catch { detail = null; }
  sendHtml(
    ctx.res,
    pages.sitePage({
      user: ctx.user,
      site,
      check,
      detail,
      checks: repo.recentChecks(ctx.user.id, id, 60),
      incidents: repo.siteIncidents(ctx.user.id, id),
      maintenance: repo.siteMaintenance(ctx.user.id, id),
      uptime: repo.uptimeStats(ctx.user.id, id, 30),
      streak: repo.currentStreak(ctx.user.id, id),
      flash: ctx.flash,
    }),
    { headers: { 'Set-Cookie': clearFlash() } }
  );
});

router.get('/invoices', (ctx) => {
  sendHtml(ctx.res, pages.invoicesPage({
    user: ctx.user, invoices: repo.userInvoices(ctx.user.id), due: repo.outstanding(ctx.user.id), flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.get('/invoice/:id', (ctx) => {
  sendHtml(ctx.res, pages.invoicePage({ user: ctx.user, invoice: repo.getInvoice(ctx.user.id, Number(ctx.params.id)) }));
});

router.get('/tickets', (ctx) => {
  sendHtml(ctx.res, pages.ticketsPage({
    user: ctx.user, tickets: repo.userTickets(ctx.user.id), sites: repo.listSites(ctx.user.id),
    csrf: ctx.user.csrf, flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.post('/tickets', async (ctx) => {
  const f = await readForm(ctx.req);
  const id = repo.createTicket(ctx.user.id, {
    subject: f.subject, body: f.body,
    siteId: f.siteId ? Number(f.siteId) : null, priority: f.priority,
  });
  redirect(ctx.res, `/ticket/${id}`, { headers: { 'Set-Cookie': flashCookie('ok', 'تم إرسال طلبك. سنرد عليك قريبًا.') } });
});

router.get('/ticket/:id', (ctx) => {
  sendHtml(ctx.res, pages.ticketPage({
    user: ctx.user, ticket: repo.getTicket(ctx.user.id, Number(ctx.params.id)), csrf: ctx.user.csrf, flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.post('/ticket/:id/reply', async (ctx) => {
  const f = await readForm(ctx.req);
  repo.replyToTicket(ctx.user.id, Number(ctx.params.id), f.body);
  redirect(ctx.res, `/ticket/${ctx.params.id}`);
});

// —— الاشتراك والدفع ——

router.get('/billing', (ctx) => {
  const st = { ...billing.accountState(ctx.user.id), csrf: ctx.user.csrf };
  const cfg = billing.paymentSettings();
  const link = billing.whatsappLink(`السلام عليكم، أنا ${ctx.user.name} وأريد تفعيل الاشتراك`);
  const claims = billing.userClaims(ctx.user.id);
  const view = st.locked ? billingViews.lockedPage : billingViews.billingPage;
  sendHtml(ctx.res, view({ user: ctx.user, st, cfg, link, claims, flash: ctx.flash }), {
    headers: { 'Set-Cookie': clearFlash() },
  });
});

router.post('/billing/claim', async (ctx) => {
  const f = await readForm(ctx.req);
  try {
    const cents = Math.round(Number(f.amount) * 100);
    const id = billing.claimPayment(ctx.user.id, {
      invoiceId: f.invoiceId ? Number(f.invoiceId) : null,
      method: f.method,
      amountCents: cents,
      senderRef: f.senderRef,
    });
    // نُعلم الأدمن داخل الشات فورًا — أسرع قناة وصول لديه
    chat.sendMessage(ctx.user.id, {
      role: 'system',
      body: `أبلغ العميل بتحويل ${(cents / 100).toFixed(2)} ج.م عبر ${
        { instapay: 'إنستا باي', vodafone: 'فودافون كاش', other: 'طريقة أخرى' }[f.method] || f.method
      }${f.senderRef ? ` من الرقم ${f.senderRef}` : ''}. رقم الإشعار #${id}`,
    });
    admin.audit(ctx.user.id, 'payment_claim', `claim#${id}`, f.method, ctx.ip);
    redirect(ctx.res, '/billing', {
      headers: { 'Set-Cookie': flashCookie('ok', 'وصلنا إشعارك. سنؤكد السداد فور المطابقة.') },
    });
  } catch (e) {
    redirect(ctx.res, '/billing', { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

// —— الشات: العميل ——

router.get('/chat', (ctx) => {
  const mode = bot.isLive(ctx.user.id) ? 'live' : 'bot';
  const messages = chat.history(ctx.user.id, 100, 'client');
  chat.markRead(ctx.user.id, 'client');
  const st = billing.accountState(ctx.user.id);
  sendHtml(ctx.res, chatViews.clientChatPage({
    user: ctx.user, messages, mode, locked: st.locked,
    topics: mode === 'bot' ? bot.quickTopics() : [],
    greeting: setting('bot_greeting') || 'أهلًا بك',
    hours: bot.workingHours(),
    botName: bot.botName(),
    color: ctx.user.chat_color || setting('chat_color_default') || '#0d7a6f',
    flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.post('/chat', async (ctx) => {
  const f = await readForm(ctx.req);
  const wantsJson = String(ctx.req.headers.accept || '').includes('application/json');
  try {
    if (!chatLimiter.check(`chat:${ctx.user.id}`).allowed) throw new Error('رسائل كثيرة — تمهّل قليلًا');
    // القناة تتبع الوضع الحالي: بدونها لا يظهر سؤال العميل في ملخص التحويل،
    // فيرى الدعم إجابات المساعد بلا الأسئلة — وهذا يُبطل الغرض من النقلة كلها.
    const live = bot.isLive(ctx.user.id);
    const msg = chat.sendMessage(ctx.user.id, {
      body: f.body, role: 'client', authorId: ctx.user.id, channel: live ? 'live' : 'bot',
    });

    // في وضع المساعد يرد البوت فورًا؛ وفي الوضع البشري لا يتدخل إطلاقًا،
    // فلا شيء أسوأ من بوت يقاطع محادثة جارية مع موظف.
    // سامي يفكّر 3–7 ثوانٍ ثم يرد عبر البث — لا نحجب الطلب في انتظاره
    let thinking = null;
    if (!live) thinking = bot.handleDelayed(ctx.user.id, f.body);
    if (wantsJson) return sendJson(ctx.res, { message: msg, thinking });
    redirect(ctx.res, '/chat');
  } catch (e) {
    if (wantsJson) return sendJson(ctx.res, { error: e.message }, { status: 400 });
    redirect(ctx.res, '/chat', { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

router.post('/chat/color', async (ctx) => {
  const f = await readForm(ctx.req);
  if (chatViews.isValidColor(f.color)) {
    run('UPDATE users SET chat_color = ? WHERE id = ?', f.color, ctx.user.id);
  }
  redirect(ctx.res, '/chat');
});

router.post('/chat/escalate', async (ctx) => {
  const f = await readForm(ctx.req);
  bot.escalate(ctx.user.id, { reason: String(f.reason || 'طلب العميل').slice(0, 120) });
  redirect(ctx.res, '/chat');
});

router.post('/chat/article', async (ctx) => {
  const f = await readForm(ctx.req);
  bot.showArticle(ctx.user.id, Number(f.articleId));
  redirect(ctx.res, '/chat');
});

router.post('/chat/feedback', async (ctx) => {
  const f = await readForm(ctx.req);
  const helpful = f.helpful === '1';
  kb.recordFeedback(Number(f.articleId), ctx.user.id, helpful, f.question);
  if (!helpful) {
    // «لم يفدني» ليس نهاية الطريق — نعرض الدعم البشري فورًا
    chat.sendMessage(ctx.user.id, {
      role: 'bot', channel: 'bot',
      body: 'آسف إن الإجابة ما أفادتكش. تحب أحوّلك لفريق الدعم؟ اضغط «كلم الدعم الفني» وهينقل معاك كل اللي اتكلمنا فيه.',
      meta: { kind: 'no_answer', question: f.question || '' },
    });
  } else {
    chat.sendMessage(ctx.user.id, { role: 'bot', channel: 'bot', body: 'تمام 👍 لو احتجت أي حاجة تانية أنا هنا.' });
  }
  redirect(ctx.res, '/chat');
});

router.get('/chat/stream', (ctx) => {
  chat.openStream(ctx.res, `u:${ctx.user.id}`);
});

router.get('/chat/since', (ctx) => {
  sendJson(ctx.res, { messages: chat.since(ctx.user.id, ctx.query.get('after'), 'client') });
});

// —— قاعدة المعرفة للعميل ——

router.get('/help', (ctx) => {
  sendHtml(ctx.res, kbViews.helpIndex({
    user: ctx.user, categories: kb.categories(), articles: kb.listArticles(), flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.get('/help/:slug', (ctx) => {
  const a = kb.getArticle(ctx.params.slug);
  if (!a || !a.active) return sendHtml(ctx.res, pages.errorPage({ user: ctx.user, message: 'المقال غير موجود' }), { status: 404 });
  kb.countView(a.id);
  sendHtml(ctx.res, kbViews.helpArticle({ user: ctx.user, article: a, flash: ctx.flash }));
});

// —— لوحة الأدمن ——

router.get('/admin', (ctx) => {
  sendHtml(ctx.res, adminViews.adminHome({
    user: ctx.user, sites: admin.adminAllSites(), stats: admin.adminStats(),
    openIncidents: admin.adminOpenIncidents(), pendingResets: admin.adminPendingResets(),
    openTickets: admin.adminOpenTickets(), flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.get('/admin/clients', (ctx) => {
  sendHtml(ctx.res, adminViews.adminClients({ user: ctx.user, clients: admin.adminClients(), flash: ctx.flash }), {
    headers: { 'Set-Cookie': clearFlash() },
  });
});

router.post('/admin/clients', async (ctx) => {
  const f = pick(await readForm(ctx.req), ['name', 'email', 'company', 'phone', 'whatsapp', 'mvp_url', 'mvp_label']);
  if (!f.name || !f.email) {
    return redirect(ctx.res, '/admin/clients', { headers: { 'Set-Cookie': flashCookie('danger', 'الاسم والبريد مطلوبان.') } });
  }
  if (auth.findUserByEmail(f.email)) {
    return redirect(ctx.res, '/admin/clients', { headers: { 'Set-Cookie': flashCookie('danger', 'هذا البريد مسجل بالفعل.') } });
  }
  // كلمة سر عشوائية لا يعرفها أحد — يستبدلها العميل عبر رابط التفعيل
  const id = admin.adminCreateClient(f, auth.hashPassword(crypto.randomUUID() + crypto.randomUUID()));
  admin.audit(ctx.user.id, 'create_client', `user#${id}`, f.email, ctx.ip);
  redirect(ctx.res, `/admin/client/${id}?link=1`);
});

router.get('/admin/client/:id', (ctx) => {
  const client = admin.adminGetClient(Number(ctx.params.id));
  if (!client) return sendHtml(ctx.res, pages.errorPage({ user: ctx.user, message: 'العميل غير موجود' }), { status: 404 });

  let link = null;
  if (ctx.query.get('link')) {
    const l = auth.createOneTimeLink(client.id, 'activate', 72);
    link = { ...l, url: `${BASE_URL}/activate/${l.token}` };
  }
  sendHtml(ctx.res, adminViews.adminClient({
    user: ctx.user, client, link,
    sites: admin.adminClientSites(client.id),
    invoices: admin.adminClientInvoices(client.id),
    state: billing.accountState(client.id),
    flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.post('/admin/client/:id/reset-link', async (ctx) => {
  const f = await readForm(ctx.req);
  const client = admin.adminGetClient(Number(ctx.params.id));
  if (!client) return redirect(ctx.res, '/admin/clients');
  const l = auth.createOneTimeLink(client.id, 'reset', 24);
  if (f.request_id) admin.adminMarkResetIssued(Number(f.request_id));
  admin.audit(ctx.user.id, 'issue_reset_link', `user#${client.id}`, null, ctx.ip);
  ctx.res.writeHead(303, {
    Location: `/admin/client/${client.id}`,
    'Set-Cookie': flashCookie('ok', `الرابط: ${BASE_URL}/activate/${l.token}`),
  });
  ctx.res.end();
});

router.post('/admin/client/:id/sites', async (ctx) => {
  const f = await readForm(ctx.req);
  const userId = Number(ctx.params.id);
  if (!admin.adminGetClient(userId)) return redirect(ctx.res, '/admin/clients');
  const siteId = admin.adminAddSite(userId, { name: f.name, url: f.url });
  admin.audit(ctx.user.id, 'add_site', `site#${siteId}`, f.url, ctx.ip);
  // فحص فوري حتى يرى العميل بيانات من أول دخول
  monitor.checkSite(admin.adminGetSite(siteId)).catch(() => {});
  redirect(ctx.res, `/admin/client/${userId}`, { headers: { 'Set-Cookie': flashCookie('ok', 'أُضيف الموقع وبدأ الفحص.') } });
});

router.get('/admin/site/:id', (ctx) => {
  const site = admin.adminGetSite(Number(ctx.params.id));
  if (!site) return sendHtml(ctx.res, pages.errorPage({ user: ctx.user, message: 'الموقع غير موجود' }), { status: 404 });
  sendHtml(ctx.res, adminViews.adminSite({
    user: ctx.user, site, client: admin.adminGetClient(site.user_id) || { name: '—' },
    check: admin.adminSiteChecks(site.id, 1)[0],
    maintenance: admin.adminSiteMaintenance(site.id),
    incidents: admin.adminSiteIncidents(site.id),
    flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.post('/admin/site/:id/check', async (ctx) => {
  const site = admin.adminGetSite(Number(ctx.params.id));
  if (!site) return redirect(ctx.res, '/admin');
  try {
    const { result } = await monitor.checkSite(site);
    redirect(ctx.res, `/admin/site/${site.id}`, {
      headers: { 'Set-Cookie': flashCookie('ok', `تم الفحص — الدرجة ${result.health.score}/100`) },
    });
  } catch (e) {
    redirect(ctx.res, `/admin/site/${site.id}`, { headers: { 'Set-Cookie': flashCookie('danger', `فشل الفحص: ${e.message}`) } });
  }
});

router.post('/admin/site/:id/maintenance', async (ctx) => {
  const f = await readForm(ctx.req);
  const site = admin.adminGetSite(Number(ctx.params.id));
  if (!site) return redirect(ctx.res, '/admin');
  admin.adminLogMaintenance(site.id, pick(f, ['title', 'type', 'notes', 'performed_by', 'next_due_at']));
  admin.audit(ctx.user.id, 'log_maintenance', `site#${site.id}`, f.title, ctx.ip);
  redirect(ctx.res, `/admin/site/${site.id}`, { headers: { 'Set-Cookie': flashCookie('ok', 'سُجّلت الصيانة — العميل يراها الآن.') } });
});

router.post('/admin/client/:id/invoices', async (ctx) => {
  const f = await readForm(ctx.req);
  const userId = Number(ctx.params.id);
  if (!admin.adminGetClient(userId)) return redirect(ctx.res, '/admin/clients');
  try {
    const inv = admin.adminCreateInvoice(userId, pick(f, ['description', 'amount', 'currency', 'due_at']));
    admin.audit(ctx.user.id, 'create_invoice', `invoice#${inv.id}`, `${f.amount} ${f.currency}`, ctx.ip);
    redirect(ctx.res, `/admin/client/${userId}`, { headers: { 'Set-Cookie': flashCookie('ok', `صدرت الفاتورة ${inv.number}`) } });
  } catch (e) {
    redirect(ctx.res, `/admin/client/${userId}`, { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

router.post('/admin/invoice/:id/pay', async (ctx) => {
  const f = await readForm(ctx.req);
  const inv = get('SELECT * FROM invoices WHERE id = ?', Number(ctx.params.id));
  if (!inv) return redirect(ctx.res, '/admin/clients');
  try {
    const r = admin.adminRecordPayment(inv.id, { amount: f.amount, method: f.method, note: f.note }, db);
    admin.audit(ctx.user.id, 'record_payment', `invoice#${inv.id}`, String(f.amount), ctx.ip);
    redirect(ctx.res, `/admin/client/${inv.user_id}`, {
      headers: { 'Set-Cookie': flashCookie('ok', `سُجّلت الدفعة — الفاتورة الآن ${r.status === 'paid' ? 'مدفوعة' : 'مدفوعة جزئيًا'}`) },
    });
  } catch (e) {
    redirect(ctx.res, `/admin/client/${inv.user_id}`, { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

router.get('/admin/chat', (ctx) => {
  sendHtml(ctx.res, chatViews.adminChatList({ user: ctx.user, threads: chat.adminThreads(), flash: ctx.flash }), {
    headers: { 'Set-Cookie': clearFlash() },
  });
});

router.get('/admin/chat/stream', (ctx) => {
  chat.openStream(ctx.res, 'admin');
});

router.get('/admin/chat/:id', (ctx) => {
  const client = admin.adminGetClient(Number(ctx.params.id));
  if (!client) return sendHtml(ctx.res, pages.errorPage({ user: ctx.user, message: 'العميل غير موجود' }), { status: 404 });
  const messages = chat.history(client.id, 100, 'admin');
  chat.markRead(client.id, 'admin');
  sendHtml(ctx.res, chatViews.adminChatThread({
    user: ctx.user, client, messages,
    state: billing.accountState(client.id),
    mode: client.support_mode || 'bot',
    replies: [],
    botName: bot.botName(),
    flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.get('/admin/chat/:id/since', (ctx) => {
  sendJson(ctx.res, { messages: chat.since(Number(ctx.params.id), ctx.query.get('after')) });
});

router.post('/admin/chat/:id', async (ctx) => {
  const f = await readForm(ctx.req);
  const client = admin.adminGetClient(Number(ctx.params.id));
  const wantsJson = String(ctx.req.headers.accept || '').includes('application/json');
  if (!client) {
    return wantsJson ? sendJson(ctx.res, { error: 'العميل غير موجود' }, { status: 404 }) : redirect(ctx.res, '/admin/chat');
  }
  try {
    const msg = chat.sendMessage(client.id, { body: f.body, role: 'admin', authorId: ctx.user.id });
    bot.markFirstReply(client.id);
    if (wantsJson) return sendJson(ctx.res, { message: msg });
    redirect(ctx.res, `/admin/chat/${client.id}`);
  } catch (e) {
    if (wantsJson) return sendJson(ctx.res, { error: e.message }, { status: 400 });
    redirect(ctx.res, `/admin/chat/${client.id}`, { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

router.post('/admin/chat/:id/close', async (ctx) => {
  const id = Number(ctx.params.id);
  if (!admin.adminGetClient(id)) return redirect(ctx.res, '/admin/chat');
  bot.backToBot(id);
  admin.audit(ctx.user.id, 'close_chat', `user#${id}`, null, ctx.ip);
  redirect(ctx.res, `/admin/chat/${id}`, { headers: { 'Set-Cookie': flashCookie('ok', 'أُنهيت المحادثة وعاد العميل للمساعد الآلي.') } });
});

router.post('/admin/chat/:id/note', async (ctx) => {
  const f = await readForm(ctx.req);
  const id = Number(ctx.params.id);
  if (!admin.adminGetClient(id)) return redirect(ctx.res, '/admin/chat');
  try {
    chat.sendMessage(id, { body: f.body, role: 'system', authorId: ctx.user.id, visibility: 'internal' });
  } catch (e) { /* رسالة فارغة */ }
  redirect(ctx.res, `/admin/chat/${id}`);
});

// —— قاعدة المعرفة: إدارة ——

router.get('/admin/kb', (ctx) => {
  sendHtml(ctx.res, kbViews.adminKbList({
    user: ctx.user, articles: kb.listArticles({ activeOnly: false }),
    unanswered: kb.unanswered(10), weak: kb.weakArticles(), flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.get('/admin/kb/new', (ctx) => {
  sendHtml(ctx.res, kbViews.adminKbForm({ user: ctx.user, article: null, flash: ctx.flash }));
});

router.get('/admin/kb/:id', (ctx) => {
  const a = kb.getArticle(Number(ctx.params.id));
  if (!a) return redirect(ctx.res, '/admin/kb');
  sendHtml(ctx.res, kbViews.adminKbForm({ user: ctx.user, article: a, flash: ctx.flash }));
});

router.post('/admin/kb', async (ctx) => {
  const f = pick(await readForm(ctx.req), ['id', 'slug', 'title', 'body', 'keywords', 'category', 'sort_order', 'active']);
  if (!f.title || !f.body) {
    return redirect(ctx.res, '/admin/kb', { headers: { 'Set-Cookie': flashCookie('danger', 'العنوان والمحتوى مطلوبان.') } });
  }
  try {
    const id = kb.saveArticle({ ...f, id: f.id ? Number(f.id) : null, active: f.active === '1' ? 1 : 0 });
    admin.audit(ctx.user.id, f.id ? 'update_article' : 'create_article', `kb#${id}`, f.title, ctx.ip);
    redirect(ctx.res, '/admin/kb', { headers: { 'Set-Cookie': flashCookie('ok', 'حُفظ المقال.') } });
  } catch (e) {
    redirect(ctx.res, '/admin/kb', { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

router.post('/admin/kb/:id/delete', async (ctx) => {
  kb.deleteArticle(Number(ctx.params.id));
  admin.audit(ctx.user.id, 'delete_article', `kb#${ctx.params.id}`, null, ctx.ip);
  redirect(ctx.res, '/admin/kb', { headers: { 'Set-Cookie': flashCookie('ok', 'حُذف المقال.') } });
});

router.get('/admin/payments', (ctx) => {
  sendHtml(ctx.res, adminViews.adminPayments({
    user: ctx.user, claims: billing.pendingClaims(), cfg: billing.paymentSettings(), flash: ctx.flash,
  }), { headers: { 'Set-Cookie': clearFlash() } });
});

router.post('/admin/claim/:id/confirm', async (ctx) => {
  const f = await readForm(ctx.req);
  const claim = get('SELECT * FROM payment_claims WHERE id = ?', Number(ctx.params.id));
  if (!claim) return redirect(ctx.res, '/admin/payments');
  try {
    const r = billing.confirmClaim(claim.id, ctx.user.id, db);
    if (r.already) {
      return redirect(ctx.res, '/admin/payments', {
        headers: { 'Set-Cookie': flashCookie('info', 'هذا الإشعار مؤكَّد بالفعل — لم تُسجَّل دفعة ثانية.') },
      });
    }
    chat.sendMessage(claim.user_id, { role: 'system', body: 'تم تأكيد سدادك — شكرًا لك. حسابك يعمل بكامل مزاياه.' });
    admin.audit(ctx.user.id, 'confirm_claim', `claim#${claim.id}`, String(claim.amount_cents), ctx.ip);
    redirect(ctx.res, '/admin/payments', {
      headers: { 'Set-Cookie': flashCookie('ok', r.linked ? 'تم تأكيد السداد.' : 'أُكّد الإشعار — لكنه غير مرتبط بفاتورة، فلم تُسجَّل دفعة.') },
    });
  } catch (e) {
    redirect(ctx.res, '/admin/payments', { headers: { 'Set-Cookie': flashCookie('danger', e.message) } });
  }
});

router.post('/admin/claim/:id/reject', async (ctx) => {
  const f = await readForm(ctx.req);
  const claim = get('SELECT * FROM payment_claims WHERE id = ?', Number(ctx.params.id));
  if (!claim) return redirect(ctx.res, '/admin/payments');
  // مشروط أيضًا: لا نرفض إشعارًا سبق تأكيده
  const done = run(
    "UPDATE payment_claims SET status = 'rejected', handled_at = ?, handled_by = ? WHERE id = ? AND status = 'pending'",
    nowISO(), ctx.user.id, claim.id
  );
  if (done.changes !== 1) return redirect(ctx.res, '/admin/payments');
  chat.sendMessage(claim.user_id, {
    role: 'admin', authorId: ctx.user.id,
    body: f.reason ? `بخصوص إشعار التحويل: ${String(f.reason).slice(0, 400)}` : 'لم نتمكن من مطابقة التحويل — من فضلك راجعنا.',
  });
  admin.audit(ctx.user.id, 'reject_claim', `claim#${claim.id}`, f.reason || null, ctx.ip);
  redirect(ctx.res, '/admin/payments');
});

router.get('/admin/settings', (ctx) => {
  sendHtml(ctx.res, adminViews.adminSettings({ user: ctx.user, cfg: billing.paymentSettings(), flash: ctx.flash }), {
    headers: { 'Set-Cookie': clearFlash() },
  });
});

router.post('/admin/settings', async (ctx) => {
  const f = pick(await readForm(ctx.req), ['pay_instapay', 'pay_vodafone', 'pay_whatsapp', 'pay_holder', 'trial_months', 'grace_days']);
  for (const [k, v] of Object.entries(f)) setting(k, String(v).slice(0, 120));
  admin.audit(ctx.user.id, 'update_settings', null, Object.keys(f).join(','), ctx.ip);
  redirect(ctx.res, '/admin/settings', { headers: { 'Set-Cookie': flashCookie('ok', 'حُفظت الإعدادات.') } });
});

router.post('/admin/client/:id/exempt', async (ctx) => {
  const f = await readForm(ctx.req);
  const id = Number(ctx.params.id);
  const on = f.exempt === '1' ? 1 : 0;
  run('UPDATE users SET exempt = ? WHERE id = ?', on, id);
  admin.audit(ctx.user.id, on ? 'exempt_on' : 'exempt_off', `user#${id}`, null, ctx.ip);
  redirect(ctx.res, `/admin/client/${id}`, {
    headers: { 'Set-Cookie': flashCookie('ok', on ? 'أُعفي العميل من القفل.' : 'أُلغي الإعفاء.') },
  });
});

router.get('/admin/requests', (ctx) => {
  sendHtml(ctx.res, adminViews.adminRequests({ user: ctx.user, requests: admin.adminPendingResets(), flash: ctx.flash }), {
    headers: { 'Set-Cookie': clearFlash() },
  });
});

router.get('/health', (ctx) => {
  const last = get('SELECT MAX(at) AS at FROM checks');
  ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  ctx.res.end(JSON.stringify({ ok: true, at: nowISO(), lastCheckAt: last?.at || null, uptimeSec: Math.round(process.uptime()) }));
});

// ——————————————————— المعالج ———————————————————

const PUBLIC_PATHS = new Set(['/login', '/reset-request', '/set-password', '/health']);
const isPublic = (p) => PUBLIC_PATHS.has(p) || p.startsWith('/activate/');

/**
 * ما يبقى مفتوحًا للعميل المقفول.
 * القاعدة: القفل يقفل المزايا، ولا يقفل طريق الدفع ولا قناة التواصل أبدًا —
 * عميل لا يرى ما عليه ولا يصل إليك لن يدفع أسرع، بل أبطأ.
 */
const OPEN_WHEN_LOCKED = new Set([
  '/billing', '/billing/claim',
  '/chat', '/chat/stream', '/chat/since', '/chat/escalate', '/chat/article', '/chat/feedback', '/chat/color',
  '/invoices', '/logout', '/health',
]);
const openWhenLocked = (p) =>
  OPEN_WHEN_LOCKED.has(p) || p.startsWith('/invoice/') || p.startsWith('/help');

export function createApp() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    let url;
    try {
      url = new URL(req.url, BASE_URL);
    } catch {
      res.writeHead(400).end('طلب غير صالح');
      return;
    }
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && serveStatic(res, pathname)) return;

      const sid = parseCookies(req)[auth.COOKIE_NAME];
      const sessionUser = auth.sessionUser(sid);
      let user = null;
      if (sessionUser) {
        user = { ...sessionUser, csrf: auth.csrfToken(sid) };
        // شارات شريط التنقل
        if (user.role === 'admin') {
          user.unreadChat = chat.unreadForAdmin();
          user.pendingClaims = billing.pendingClaims().length;
          user.pendingResets = admin.adminPendingResets().length;
        } else {
          user.unreadChat = chat.unreadForClient(user.id);
        }
      }
      const ip = clientIp(req, { trustProxy: TRUST_PROXY });

      // رؤوس أمان بوابتنا على كل رد HTML
      for (const [k, v] of Object.entries(securityHeaders({ secure: SECURE }))) res.setHeader(k, v);

      const route = router.match(req.method, pathname);
      if (!route) {
        return sendHtml(res, pages.errorPage({ user, status: 404, message: 'الصفحة غير موجودة' }), { status: 404 });
      }

      // حماية المسارات
      if (!isPublic(pathname) && !user) {
        return redirect(res, '/login');
      }
      if (pathname.startsWith('/admin') && user?.role !== 'admin') {
        // 404 لا 403: لا نؤكد لغير المخوَّل وجود لوحة أدمن
        return sendHtml(res, pages.errorPage({ user, status: 404, message: 'الصفحة غير موجودة' }), { status: 404 });
      }

      // بوابة الاشتراك: تُقفل المزايا بعد انتهاء مهلة السداد
      if (user && user.role === 'client' && !openWhenLocked(pathname)) {
        const st = billing.accountState(user.id);
        billing.syncRestriction(user.id, st);
        if (st.locked) return redirect(res, '/billing');
        user.billing = st;
      }

      // CSRF على كل POST من مستخدم مسجل
      if (req.method === 'POST' && user && !['/login', '/reset-request', '/set-password'].includes(pathname)) {
        const form = await readFormRaw(req);
        if (!auth.csrfOk(sid, form._csrf)) {
          return sendHtml(res, pages.errorPage({ user, status: 403, message: 'انتهت صلاحية النموذج. أعد المحاولة.' }), { status: 403 });
        }
        req.parsedForm = form; // لا نقرأ الجسم مرتين
      }

      await route.handler({
        req, res, user, sid, ip, params: route.params, query: url.searchParams, flash: readFlash(req),
      });
    } catch (e) {
      if (e?.name === 'OwnershipError') {
        return sendHtml(res, pages.errorPage({ status: 404, message: 'الصفحة غير موجودة' }), { status: 404 });
      }
      console.error(`✗ ${req.method} ${pathname}:`, e.message);
      if (!res.headersSent) {
        sendHtml(res, pages.errorPage({ status: 500, message: 'حدث خطأ غير متوقع. حاول مجددًا.' }), { status: 500 });
      }
    } finally {
      if (process.env.LOG_REQUESTS === '1') {
        console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });
}

// ——————————————————— التشغيل ———————————————————

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('◆ نظام دعم العملاء — MKSS');
  migrate();

  const adminCount = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")?.n || 0;
  if (!adminCount) {
    console.log('\n⚠ لا يوجد حساب أدمن. شغّل:  node seed.js\n');
  }

  const server = createApp();
  server.listen(PORT, HOST, () => {
    console.log(`▶ البوابة تعمل على ${BASE_URL}`);
    // MONITOR=0 يشغّل الويب وحده — مفيد لفصل العمليتين، أو لتشغيل نسخة ويب
    // إضافية خلف موازن حمل دون أن تتضاعف الفحوصات على مواقع العملاء.
    if (process.env.MONITOR === '0') console.log('• المراقب معطّل (MONITOR=0)');
    else monitor.start();
  });

  const shutdown = () => {
    console.log('\n◆ إيقاف...');
    monitor.stop();
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

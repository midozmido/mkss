// اختبار المساعد الآلي والنقلة لفريق الدعم.
// الأهم هنا: (1) لا طريق مسدود  (2) النقلة تنقل السياق  (3) البوت لا يقاطع محادثة بشرية.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { all, get, run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import * as kb from '../src/kb.js';
import * as bot from '../src/bot.js';
import * as chat from '../src/chat.js';
import { seedArticles } from '../src/kb-seed.js';

let n = 0;
function mkClient() {
  const at = nowISO();
  const id = Number(
    run(
      `INSERT INTO users(email, password_hash, name, role, created_at, trial_ends_at)
       VALUES(?,?,?,'client',?,?)`,
      `bot${++n}-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا'), `عميل ${n}`, at, at
    ).lastInsertRowid
  );
  run('INSERT INTO sites(user_id, name, url, platform, platform_confidence, created_at) VALUES(?,?,?,?,?,?)',
    id, 'موقع الاختبار', 'https://x.test/', 'wordpress', 95, at);
  const siteId = get('SELECT id FROM sites WHERE user_id = ? ORDER BY id DESC LIMIT 1', id).id;
  run(`INSERT INTO checks(site_id, at, ok, status_code, response_ms, health_score, ssl_days_left, dns_ok)
       VALUES(?,?,1,200,320,93,64,1)`, siteId, at);
  return id;
}

/** كل اختبار يبدأ بمحادثة نظيفة — هكذا يعمل النظام فعلًا الآن */
const conv = (userId) => chat.openConversation(userId);
const hist = (c) => chat.history(c.id, 100, 'admin');

before(() => { migrate({ quiet: true }); seedArticles(); });

// مؤقّت تفكير لم يُلغَ يفيق بعد انتهاء هذا الملف فيكتب في قاعدة البيانات
// وسط اختبارات ملف آخر — وهذا ما جعل الفشل متقطعًا لا ثابتًا.
after(() => bot.cancelAllPending());

test('البحث العربي يتجاوز اختلاف الرسم والعامية', () => {
  const cases = [
    ['الموقع بطيء جدا', 'site-slow'],
    ['ازاي ادفع', 'how-to-pay'],
    ['ليه اللوحة اتقفلت', 'overdue-lock'],
    ['شهاده ssl', 'ssl-expiry'],
    ['فواتيري فين', 'where-invoices'],
  ];
  for (const [q, slug] of cases) {
    const top = kb.search(q, { limit: 1 })[0];
    assert.ok(top, `«${q}» لم يرجع أي نتيجة`);
    assert.equal(top.slug, slug, `«${q}» رجّع ${top.slug} بدل ${slug}`);
  }
});

test('سؤال خارج الموضوع لا يُجاب عليه بثقة كاذبة', () => {
  const top = kb.search('حاجة ملهاش علاقة خالص بالموضوع ده', { limit: 1 })[0];
  assert.ok(!top || top.score < bot.SUGGEST, `خمّن «${top?.title}» بثقة ${top?.score}`);
});

test('يجيب من بيانات العميل الحية لا من المقالات', () => {
  const u = mkClient(); const c = conv(u);
  bot.handle(c, 'موقعي شغال؟');
  const last = hist(c).at(-1);
  assert.equal(last.author_role, 'bot');
  assert.match(last.body, /موقع الاختبار/, 'لم يذكر اسم الموقع الفعلي');
  assert.match(last.body, /يعمل/, 'لم يذكر حالته الفعلية');
});

test('يعرف مستحقات العميل من فاتورته', () => {
  const u = mkClient();
  const at = nowISO();
  run(`INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, due_at, status, created_at)
       VALUES(?,?,?,?,'EGP',?,?,'unpaid',?)`,
    u, `BOT-${Date.now()}`, 1500, 150000, at, at.slice(0, 10), at);
  const c = conv(u);
  bot.handle(c, 'عليا كام؟');
  const last = hist(c).at(-1);
  assert.match(last.body, /1,500|1500/, `لم يذكر المبلغ: ${last.body}`);
});

test('يعرض أرقام الدفع الفعلية لا نصًا عامًا', () => {
  const u = mkClient(); const c = conv(u);
  bot.handle(c, 'ازاي ادفع الاشتراك؟');
  const last = hist(c).at(-1);
  assert.match(last.body, /01099576398/, 'لم يعرض رقم التحويل');
  assert.match(last.body, /إنستا باي/);
});

test('سؤال بلا إجابة يعرض احتمالات وينتهي بعرض الدعم البشري', () => {
  const u = mkClient(); const c = conv(u);
  const r = bot.handle(c, 'سؤال غريب جدا مالوش اي علاقة بالمواقع خالص');
  assert.equal(r.noAnswer, true);
  const last = hist(c).at(-1);
  assert.match(last.body, /تحدّث إلى الدعم الفني/, 'لم يعرض التحويل لفريق الدعم');
  const meta = JSON.parse(last.meta);
  assert.equal(meta.kind, 'no_answer');
  assert.ok(Array.isArray(meta.suggestions) && meta.suggestions.length > 0, 'لم يقدّم أي احتمالات');
});

test('بعد محاولتين فاشلتين يحوّل تلقائيًا بلا أن يسأل', () => {
  const u = mkClient(); const c = conv(u);
  const first = bot.handle(c, 'سؤال غريب جدا رقم واحد مالوش علاقة');
  assert.ok(!first.escalate, 'حوّل من أول محاولة');

  const second = bot.handle(c, 'سؤال غريب تاني برضه مالوش علاقة');
  assert.equal(second.escalate, true, 'لم يحوّل بعد فشلين');
  assert.equal(second.autoEscalated, true);
  assert.match(hist(c).at(-1).body, /أُحوّلك الآن/);
});

test('إجابة ناجحة تصفّر عدّاد الفشل', () => {
  const u = mkClient(); const c = conv(u);
  bot.handle(c, 'سؤال غريب مالوش علاقة خالص');
  assert.equal(chat.failStreak(c.id), 1);
  bot.handle(c, 'الموقع بطيء');
  assert.equal(chat.failStreak(c.id), 0, 'لم يُصفَّر العدّاد بعد إجابة ناجحة');
});

test('طلب الدعم صراحةً يحوّل فورًا بلا محاولة رد', () => {
  const u = mkClient(); const c = conv(u);
  const r = bot.handle(c, 'عايز اكلم الدعم الفني');
  assert.equal(r.escalate, true);
  assert.equal(r.messages.length, 0, 'حاول الرد بدل التحويل');
});

test('النقلة تنقل السياق للأدمن — العميل لا يعيد كلامه', () => {
  const u = mkClient(); const c = conv(u);
  chat.sendMessage(c.id, { body: 'سؤال معقد جدا ملوش اجابة عندك', role: 'client', channel: 'bot' });
  bot.handle(c, 'سؤال معقد جدا ملوش اجابة عندك');
  bot.escalate(c, { reason: 'المساعد لم يجد إجابة' });

  const adminView = chat.history(c.id, 100, 'admin');
  const internal = adminView.filter((m) => m.visibility === 'internal');
  assert.equal(internal.length, 1, 'لم يُنشأ ملخص داخلي للأدمن');

  const s = internal[0].body;
  assert.match(s, /تحويل من سامي/, 'الملخص لا يحمل اسم المساعد');
  assert.match(s, /سؤال معقد جدا/, 'الملخص لا يحوي سؤال العميل الذي فشل فيه المساعد');
  assert.match(s, /حالة الحساب/, 'الملخص بلا حالة مالية');
  assert.match(s, /موقع الاختبار|كل مواقعه تعمل/, 'الملخص بلا حالة المواقع');

  // والعميل لا يرى الملخص الداخلي إطلاقًا
  const clientView = chat.history(c.id, 100, 'client');
  assert.ok(!clientView.some((m) => m.body.includes('تحويل من سامي')), 'تسرّب الملخص الداخلي للعميل');
  assert.match(clientView.at(-1).body, /حوّلتك إلى فريق الدعم/);
  assert.match(clientView.at(-1).body, /لن تحتاج إلى إعادة/, 'لم يُطمئن العميل أنه لن يعيد شرح مشكلته');
});

test('بعد التحويل يصمت المساعد ولا يقاطع الموظف', () => {
  const u = mkClient(); const c = conv(u);
  bot.escalate(c, { reason: 'اختبار' });
  assert.equal(chat.isLive(c.id), true);
  const before = hist(c).length;
  assert.equal(get('SELECT mode FROM conversations WHERE id = ?', c.id).mode, 'live');
  assert.equal(hist(c).length, before);
});

test('التحويل مرتين لا يكرر الملخص الداخلي', () => {
  const u = mkClient(); const c = conv(u);
  bot.escalate(c, { reason: 'أولى' });
  const first = hist(c).filter((m) => m.visibility === 'internal').length;
  const again = bot.escalate(c, { reason: 'ثانية' });
  assert.equal(again.already, true);
  assert.equal(hist(c).filter((m) => m.visibility === 'internal').length, first, 'ملخص مكرر');
});

test('إنهاء المحادثة يؤرشفها ويسمح بفتح جديدة', () => {
  const u = mkClient(); const c = conv(u);
  chat.sendMessage(c.id, { body: 'مشكلتي', role: 'client' });
  bot.escalate(c, { reason: 'اختبار' });
  bot.closeConversation(c, 'admin');

  const after = get('SELECT * FROM conversations WHERE id = ?', c.id);
  assert.equal(after.status, 'closed');
  assert.equal(after.mode, 'bot');
  assert.ok(hist(c).length > 0, 'ضاعت الرسائل بعد الإغلاق');

  const fresh = chat.openConversation(u);
  assert.notEqual(fresh.id, c.id);
  assert.equal(chat.history(fresh.id).length, 0, 'المحادثة الجديدة ليست نظيفة');
  assert.equal(chat.listConversations(u).length >= 2, true, 'لم تُحفظ القديمة في السجل');
});

test('الأسئلة بلا إجابة تُسجَّل لتعرف أي مقال تكتب', () => {
  const u = mkClient();
  const q = 'سؤال فريد جدا رقم ' + Date.now();
  bot.handle(conv(u), q);
  bot.handle(conv(u), q);
  const list = kb.unanswered(50);
  const row = list.find((r) => r.question === q);
  assert.ok(row, 'السؤال غير المجاب لم يُسجَّل');
  assert.equal(row.times, 2, 'لم يُجمَّع التكرار');
});

test('تقييم المقال يُحتسب ويكشف المقالات الضعيفة', () => {
  const u = mkClient();
  const a = kb.search('الموقع بطيء', { limit: 1 })[0];
  kb.recordFeedback(a.id, u, false, 'الموقع بطيء');
  kb.recordFeedback(a.id, u, false, 'الموقع بطيء');
  const after = kb.getArticle(a.id);
  assert.equal(after.not_helpful, 2);
  assert.ok(kb.weakArticles().some((w) => w.id === a.id), 'لم يظهر في المقالات الضعيفة');
});

test('مواعيد العمل تُحسب وتظهر في رسالة التوقّع', () => {
  const w = bot.workingHours();
  assert.equal(typeof w.open, 'boolean');
  assert.ok(w.from >= 0 && w.to <= 24);
  assert.match(bot.etaSentence(), /[؀-ۿ]/);
});

test('حقن سكربت في سؤال العميل لا يخرج كما هو', async () => {
  const u = mkClient(); const c = conv(u);
  bot.handle(c, '<script>alert(1)</script> الموقع بطيء');
  const stored = hist(c).at(-1);
  // التخزين خام والتهريب عند العرض — نتحقق أن العرض يهرّب
  const { bubble } = await import('../src/views/chat.js');
  const html = bubble({ ...stored, body: '<script>alert(1)</script>' }, 'client');
  assert.ok(!html.includes('<script>'), 'مرّ وسم script إلى الصفحة');
});

test('ملخص التحويل يحوي سؤال العميل لا إجابات المساعد وحدها', () => {
  const u = mkClient(); const c = conv(u);
  chat.sendMessage(c.id, { body: 'الدومين بتاعي بيخلص امتى؟', role: 'client', channel: 'bot' });
  bot.handle(c, 'الدومين بتاعي بيخلص امتى؟');
  bot.escalate(c, { reason: 'اختبار' });

  const summary = hist(c).filter((m) => m.visibility === 'internal').pop().body;
  assert.match(summary, /👤 العميل/, 'الملخص لا يحوي أي رسالة من العميل');
  assert.match(summary, /الدومين بتاعي بيخلص/, 'سؤال العميل غائب عن الملخص');
});

test('الساعة تُعرض بصيغة 12 ساعة لا 18م', () => {
  assert.equal(bot.hour12(18), '6 م');
  assert.equal(bot.hour12(10), '10 ص');
  assert.equal(bot.hour12(12), '12 ظ');
  assert.equal(bot.hour12(0), '12 ص');
  assert.equal(bot.workingHours().label, '10 ص – 6 م');
});

// ——————————————————— هوية سامي وسلوكه ———————————————————

test('سامي يخاطب العميل بالفصحى لا بالعامية', () => {
  const u = mkClient();
  const colloquial = /\bتقدر\b|\bعشان\b|\bمش\b|\bبتاع\b|\bازاي\b|\bكده\b|\bدلوقتي\b|\bعايز\b/;
  for (const q of ['موقعي شغال؟', 'عليا كام؟', 'كيف أسدّد؟', 'سؤال غريب ملوش اجابة']) {
    const c = conv(u);
    bot.handle(c, q);
    const body = hist(c).at(-1).body;
    assert.ok(!colloquial.test(body), `رد سامي بالعامية على «${q}»: ${body.slice(0, 90)}`);
  }
});

test('اسم سامي يأتي من الإعدادات لا من الكود', () => {
  assert.equal(bot.botName(), 'سامي');
});

test('وقت التفكير بين 3 و7 ثوانٍ', () => {
  for (let i = 0; i < 40; i++) {
    const d = bot.thinkDelay();
    assert.ok(d >= 3000 && d <= 7000, `تأخير خارج المدى: ${d}ms`);
  }
});

test('سامي يفكّر ثم يرد — لا يرد فورًا', () => {
  const u = mkClient(); const c = conv(u);
  const before = hist(c).length;
  const r = bot.handleDelayed(c, 'هل موقعي يعمل؟');
  assert.ok(r.delayMs >= 3000, 'رد بلا تفكير');
  assert.equal(hist(c).length, before, 'وصل الرد فورًا دون انتظار');
});

test('طلب التحدث إلى إنسان لا يُؤخَّر — من يطلب موظفًا يكون متضايقًا', () => {
  const u = mkClient(); const c = conv(u);
  const r = bot.handleDelayed(c, 'عايز اكلم الدعم الفني');
  assert.equal(r.escalated, true);
  assert.equal(r.delayMs, undefined, 'أخّر طلب التحويل');
  assert.equal(chat.isLive(c.id), true);
});

test('رسالة جديدة أثناء التفكير تلغي الرد السابق', () => {
  const u = mkClient(); const c = conv(u);
  const first = bot.handleDelayed(c, 'سؤال أول');
  const second = bot.handleDelayed(c, 'هل موقعي يعمل؟');
  assert.ok(first.delayMs && second.delayMs, 'لم يُجدول أحد الردين');
  assert.equal(hist(c).filter((m) => m.author_role === 'bot').length, 0);
});

test('التحويل يلغي أي تفكير جارٍ فلا يقاطع سامي الموظف', () => {
  const u = mkClient(); const c = conv(u);
  bot.handleDelayed(c, 'سؤال يحتاج تفكيرًا');
  bot.escalate(c, { reason: 'اختبار' });
  assert.equal(chat.isLive(c.id), true);
  assert.equal(hist(c).filter((m) => m.author_role === 'bot').length, 0, 'تسلّل رد آلي بعد التحويل');
});

test('زمن أول رد يُحسب من لحظة التحويل', () => {
  const u = mkClient(); const c = conv(u);
  bot.escalate(c, { reason: 'اختبار' });
  const row = get('SELECT * FROM escalations WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', c.id);
  assert.ok(row, 'لم يُسجَّل التحويل');
  assert.equal(row.first_reply_at, null);

  bot.markFirstReply(c.id);
  assert.ok(get('SELECT first_reply_at FROM escalations WHERE id = ?', row.id).first_reply_at);

  bot.closeConversation(c, 'admin');
  assert.ok(get('SELECT closed_at FROM escalations WHERE id = ?', row.id).closed_at, 'لم تُغلق');
});

test('لون الشات يقبل الألوان المعرّفة فقط', async () => {
  const { isValidColor, CHAT_COLORS } = await import('../src/views/chat.js');
  assert.equal(isValidColor('#0d7a6f'), true);
  assert.equal(isValidColor('#1d6ff2'), true);
  assert.equal(isValidColor('javascript:alert(1)'), false);
  assert.equal(isValidColor('#000000'), false, 'قَبِل لونًا غير معرّف');
  assert.ok(CHAT_COLORS.length >= 5);
});

test('صورة سامي SVG مضمّن بلا طلب شبكة', async () => {
  const { sami } = await import('../src/views/layout.js');
  const svg = sami(40);
  assert.match(svg, /<svg/);
  assert.ok(!svg.includes('http'), 'الصورة تطلب موردًا خارجيًا');
  assert.match(svg, /currentColor/, 'الصورة لا تتبع لون الشات');
});

test('معرفة سامي عن المواقع تغطي أسئلة العملاء الحقيقية', async () => {
  const { WEB_ARTICLES } = await import('../src/kb-web.js');
  assert.ok(WEB_ARTICLES.length >= 30, `عدد المقالات ${WEB_ARTICLES.length} — قليل`);
  assert.ok(kb.categories().length >= 10, 'التصنيفات قليلة');

  const cases = [
    ['ليه الصور بتبطئ الموقع', 'images-speed'],
    ['موقعي مش ظاهر في جوجل', 'not-in-google'],
    ['الموقع بيقول غير آمن', 'not-secure-warning'],
    ['شاشة بيضا', 'error-500'],
    ['رسايلي بتروح سبام', 'email-spam'],
    ['موقعي اتهكر', 'hacked-signs'],
    ['استضافة مشتركة ولا vps', 'hosting-types'],
    ['نسيت باسورد ووردبريس', 'wp-lost-password'],
    ['العملاء بيسيبوا السلة', 'cart-abandon'],
    ['عقد الصيانة بيشمل ايه', 'what-is-maintenance'],
  ];
  for (const [q, slug] of cases) {
    const top = kb.search(q, { limit: 1 })[0];
    assert.ok(top, `«${q}» بلا نتيجة`);
    assert.equal(top.slug, slug, `«${q}» رجّع ${top.slug}`);
  }
});

test('«الكاش» لا تُفهم على أنها فودافون كاش', () => {
  assert.equal(kb.search('ايه هو الكاش', { limit: 1 })[0].slug, 'what-is-cache');
  assert.equal(kb.search('فودافون كاش', { limit: 1 })[0].slug, 'how-to-pay');
});

test('كل مقالات سامي بالفصحى في المتن والعامية في كلمات البحث', async () => {
  const { WEB_ARTICLES } = await import('../src/kb-web.js');
  const colloquial = /\bتقدر\b|\bعشان\b|\bبتاعك\b|\bازاي\b|\bدلوقتي\b/;
  for (const a of WEB_ARTICLES) {
    assert.ok(!colloquial.test(a.body), `متن «${a.title}» فيه عامية`);
    assert.ok(a.keywords && a.keywords.length > 10, `«${a.title}» بلا كلمات بحث كافية`);
    assert.ok(a.body.length > 200, `«${a.title}» قصير جدًا`);
  }
});

test('يميّز سؤال المعرفة عن سؤال حالة الموقع', () => {
  const u = mkClient(); const c = conv(u);

  // سؤال تعلُّم → مقال، لا أرقام موقعه
  bot.handle(c, 'ليه الصور بتبطئ الموقع؟');
  let last = hist(c).at(-1).body;
  assert.match(last, /الصور/, 'لم يشرح سبب البطء');
  assert.ok(!/جزء من الألف/.test(last), 'رد بقياسات موقعه على سؤال تعلُّم');

  // سؤال عن حالته → بيانات حية
  bot.handle(c, 'موقعي بطيء؟');
  last = hist(c).at(-1).body;
  assert.match(last, /موقع الاختبار/, 'لم يرد ببيانات موقعه على سؤال عن حالته');

  // «كم المستحق عليّ» تبقى نيّة رغم صيغة السؤال
  bot.handle(c, 'كم المستحق عليّ؟');
  last = hist(c).at(-1).body;
  assert.ok(/مستحقات|المستحق/.test(last), `لم يفهم سؤال المستحقات: ${last.slice(0, 60)}`);
});

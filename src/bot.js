// المساعد الآلي — قواعد ونيّات، لا خدمة ذكاء اصطناعي خارجية.
//
// ما يميّزه عن أي بوت مقالات: يجيب من **بيانات العميل الحية**.
// «موقعي شغال؟» يقرأ آخر فحص فعلي، و«عليا كام؟» يقرأ فاتورته.
// هذا ما يعطي إحساس الذكاء بلا أي اعتماد خارجي.
//
// وقاعدة ملزمة: **لا طريق مسدود**. أي رد لا يعرف إجابته يعرض التحويل
// لفريق الدعم فورًا — البوت الذي يقول «لم أفهم» ويقف هو أسوأ من غيابه.
import { all, get, run, nowISO, setting } from './db.js';
import * as kb from './kb.js';
import * as chat from './chat.js';
import * as repo from './repo.js';
import * as billing from './billing.js';
import { money } from './repo.js';

const CONFIDENT = 0.45;   // فوقها نجيب مباشرة
const SUGGEST = 0.18;     // بينها وبين السابقة نقترح ولا نجزم

// ——————————————————— مواعيد العمل ———————————————————

export function workingHours() {
  const days = String(setting('work_days') || '0,1,2,3,4,6').split(',').map(Number);
  const from = Number(setting('work_from') || 10);
  const to = Number(setting('work_to') || 18);
  const tz = Number(setting('tz_offset') || 3);
  const now = new Date(Date.now() + tz * 3600_000);
  const open = days.includes(now.getUTCDay()) && now.getUTCHours() >= from && now.getUTCHours() < to;
  return {
    open, from, to, days,
    label: `${hour12(from)} – ${hour12(to)}`,
    eta: setting('reply_eta') || 'خلال وقت قصير',
  };
}

/** 18 ليست «18م» — العرض بصيغة 12 ساعة كما يقرؤها الناس */
export function hour12(h) {
  const n = Number(h);
  if (n === 0) return '12 ص';
  if (n === 12) return '12 ظ';
  return n < 12 ? `${n} ص` : `${n - 12} م`;
}

function etaSentence() {
  const w = workingHours();
  return w.open
    ? `فريق الدعم متاح الآن — الرد ${w.eta}.`
    : `نحن خارج مواعيد العمل حاليًا (${hour12(w.from)} – ${hour12(w.to)}). رسالتك مسجّلة وسنرد أول ما نفتح.`;
}

// ——————————————————— النيّات على البيانات الحية ———————————————————

const has = (t, ...words) => words.some((w) => t.includes(kb.normalize(w)));

const INTENTS = [
  {
    key: 'site_status',
    match: (t) => has(t, 'موقع', 'موقعي') && has(t, 'شغال', 'حاله', 'واقع', 'فاتح', 'يعمل', 'داون', 'متوقف'),
    answer(userId) {
      const sites = repo.listSites(userId);
      if (!sites.length) return 'لا توجد مواقع مسجّلة على حسابك بعد.';
      return sites
        .map((s) => {
          if (s.last_ok == null) return `• ${s.name}: لم نبدأ فحصه بعد.`;
          const streak = repo.currentStreak(userId, s.id);
          return s.last_ok
            ? `• ${s.name}: شغّال ✅${streak?.days >= 1 ? ` من ${streak.days} يوم بدون انقطاع` : ''} — درجة الصحة ${s.health_score ?? '—'}/100.`
            : `• ${s.name}: لا يفتح حاليًا ❌ وفريقنا يتابع.`;
        })
        .join('\n');
    },
  },
  {
    key: 'balance',
    match: (t) => has(t, 'عليا', 'مستحق', 'فلوس', 'حسابي', 'مديون') || (has(t, 'فاتوره', 'فواتير') && has(t, 'كام', 'قد ايه', 'مبلغ')),
    answer(userId) {
      const due = repo.outstanding(userId);
      if (!due.cents) return 'لا توجد مستحقات على حسابك — كل الفواتير مسدَّدة، شكرًا لك. 🙏';
      const st = billing.accountState(userId);
      let msg = `عليك ${money.format(due.cents)} على ${due.invoices} فاتورة.`;
      if (st.state === 'grace') msg += `\nباقي لك ${st.graceLeft} يوم قبل إيقاف المزايا مؤقتًا.`;
      if (st.state === 'restricted') msg += '\nالمزايا متوقفة حاليًا لحين السداد.';
      return `${msg}\nتقدر تدفع من صفحة «الاشتراك» — وأقدر أوريك طرق الدفع لو حابب.`;
    },
  },
  {
    key: 'payment_how',
    match: (t) => (has(t, 'ادفع', 'دفع', 'سداد', 'تحويل') && !has(t, 'مستحق')) || has(t, 'انستا', 'فودافون', 'محفظه'),
    answer() {
      const cfg = billing.paymentSettings();
      return `تقدر تحوّل بأي من الطريقتين على نفس الرقم:\n` +
        `• إنستا باي: ${cfg.instapay}\n` +
        `• فودافون كاش: ${cfg.vodafone}\n\n` +
        `واكتب الكود المرجعي بتاع فاتورتك في ملاحظات التحويل، وبعدها اضغط «أبلغت بالتحويل» من صفحة الاشتراك عشان نأكد السداد بسرعة.`;
    },
  },
  {
    key: 'ssl',
    match: (t) => has(t, 'شهاده', 'ssl', 'تشفير', 'https', 'قفل'),
    answer(userId) {
      const sites = repo.listSites(userId);
      const lines = sites.map((s) => {
        const c = repo.latestCheck(userId, s.id);
        if (!c) return `• ${s.name}: لم يُفحص بعد.`;
        if (c.ssl_days_left == null) return `• ${s.name}: يعمل على HTTP بدون شهادة تشفير.`;
        return `• ${s.name}: الشهادة سارية ${c.ssl_days_left} يوم${c.ssl_days_left <= 21 ? ' — قرّب موعد التجديد ⚠️' : ' ✅'}`;
      });
      return lines.length ? lines.join('\n') : 'لا توجد مواقع مسجّلة بعد.';
    },
  },
  {
    key: 'maintenance',
    match: (t) => has(t, 'صيانه', 'تحديث', 'باكب', 'نسخه احتياطيه'),
    answer(userId) {
      const sites = repo.listSites(userId);
      const lines = sites.map((s) => {
        const m = repo.siteMaintenance(userId, s.id, 1)[0];
        return m
          ? `• ${s.name}: آخر صيانة «${m.title}» بتاريخ ${String(m.at).slice(0, 10)}.`
          : `• ${s.name}: لم تُسجَّل صيانة بعد.`;
      });
      return lines.length ? lines.join('\n') : 'لا توجد مواقع مسجّلة بعد.';
    },
  },
  {
    key: 'speed',
    match: (t) => has(t, 'بطي', 'سرعه', 'تقيل', 'بيلود'),
    answer(userId) {
      const sites = repo.listSites(userId);
      const lines = sites.map((s) => {
        const c = repo.latestCheck(userId, s.id);
        if (!c?.response_ms) return `• ${s.name}: لا يوجد قياس بعد.`;
        const v = c.response_ms;
        const verdict = v < 800 ? 'سريع ✅' : v < 1500 ? 'مقبول' : v < 3000 ? 'بطيء ⚠️' : 'بطيء جدًا ❌';
        return `• ${s.name}: ${v} جزء من الألف من الثانية — ${verdict}`;
      });
      return `${lines.join('\n')}\n\nالقياس من سيرفر المراقبة لدينا، وقد يختلف عن تجربة زائر في بلد آخر.`;
    },
  },
  {
    key: 'platform',
    match: (t) => has(t, 'منصه', 'ووردبريس', 'شوبيفاي', 'سله', 'متعمل بايه', 'مبني على'),
    answer(userId) {
      const sites = repo.listSites(userId);
      const names = {
        wordpress: 'ووردبريس', shopify: 'شوبيفاي', salla: 'سلة', zid: 'زد',
        wix: 'ويكس', webflow: 'ويب فلو', drupal: 'دروبال', joomla: 'جوملا',
      };
      return sites
        .map((s) => `• ${s.name}: ${s.platform ? (names[s.platform] || s.platform) + (s.platform_version ? ` ${s.platform_version}` : '') : 'لم نتعرف على المنصة من الفحص الخارجي'}`)
        .join('\n') || 'لا توجد مواقع مسجّلة بعد.';
    },
  },
];

// ——————————————————— المعالجة ———————————————————

export const isLive = (userId) =>
  get('SELECT support_mode FROM users WHERE id = ?', userId)?.support_mode === 'live';

/**
 * يعالج رسالة العميل ويرد.
 * @returns {{handled:boolean, messages:object[]}}
 */
export function handle(userId, text) {
  const raw = String(text || '').trim();
  const t = kb.normalize(raw);
  const out = [];

  // طلب صريح للتحويل يسبق كل شيء
  if (has(t, 'كلم الدعم', 'الدعم الفني', 'موظف', 'انسان', 'حد حقيقي', 'محتاج حد', 'مش عايز بوت')) {
    return { handled: true, escalate: true, messages: [] };
  }

  // 1) نيّة على بيانات حية
  for (const intent of INTENTS) {
    if (!intent.match(t)) continue;
    let body;
    try {
      body = intent.answer(userId);
    } catch {
      body = null;
    }
    if (body) {
      kb.logEvent({ userId, question: raw, intent: intent.key, answered: 1 });
      out.push(chat.sendMessage(userId, { body, role: 'bot', channel: 'bot' }));
      return { handled: true, intent: intent.key, messages: out };
    }
  }

  // 2) بحث في قاعدة المعرفة
  const hits = kb.search(raw, { limit: 3 });
  const top = hits[0];

  if (top && top.score >= CONFIDENT) {
    kb.countView(top.id);
    kb.logEvent({ userId, question: raw, articleId: top.id, score: top.score, answered: 1 });
    out.push(
      chat.sendMessage(userId, {
        body: `**${top.title}**\n\n${top.body}`,
        role: 'bot',
        channel: 'bot',
        meta: { articleId: top.id, question: raw, kind: 'answer' },
      })
    );
    return { handled: true, articleId: top.id, messages: out };
  }

  if (top && top.score >= SUGGEST) {
    kb.logEvent({ userId, question: raw, articleId: top.id, score: top.score, answered: 0 });
    const list = hits.map((h) => `• ${h.title}`).join('\n');
    out.push(
      chat.sendMessage(userId, {
        body: `مش متأكد إني فهمت قصدك بالظبط. يمكن تقصد:\n\n${list}\n\nاختار واحد، أو اضغط «كلم الدعم الفني» وهوصّلك بفريقنا فورًا.`,
        role: 'bot',
        channel: 'bot',
        meta: { suggestions: hits.map((h) => ({ id: h.id, title: h.title })), kind: 'suggest' },
      })
    );
    return { handled: true, suggested: true, messages: out };
  }

  // 3) لا إجابة — لا طريق مسدود
  kb.logEvent({ userId, question: raw, answered: 0 });
  out.push(
    chat.sendMessage(userId, {
      body: `معنديش إجابة جاهزة للسؤال ده، وما حبّيتش أخمّن.\n\n${etaSentence()}\n\nاضغط «كلم الدعم الفني» وهحوّلك فورًا ومعاك كل اللي اتكلمنا فيه — مش هتحتاج تعيد كلامك.`,
      role: 'bot',
      channel: 'bot',
      meta: { kind: 'no_answer', question: raw },
    })
  );
  return { handled: true, noAnswer: true, messages: out };
}

/** يعرض مقالًا بعينه (عند الضغط على اقتراح) */
export function showArticle(userId, articleId) {
  const a = kb.getArticle(articleId);
  if (!a) return null;
  kb.countView(a.id);
  return chat.sendMessage(userId, {
    body: `**${a.title}**\n\n${a.body}`,
    role: 'bot',
    channel: 'bot',
    meta: { articleId: a.id, kind: 'answer' },
  });
}

// ——————————————————— التحويل الاحترافي ———————————————————

/**
 * النقلة من البوت إلى الدعم البشري.
 *
 * ما يجعلها احترافية ليس شكلها، بل أن **الدعم يرى كل ما دار مع البوت**،
 * فلا يُطلب من العميل أن يعيد شرح مشكلته من أول وأحدث. وهذا حرفيًا
 * الفرق الوحيد بين تحويل محترم وتحويل يُغضب العميل.
 */
export function escalate(userId, { reason = 'طلب العميل', question = null } = {}) {
  const already = isLive(userId);
  run("UPDATE users SET support_mode = 'live', escalated_at = ? WHERE id = ?", nowISO(), userId);

  if (already) return { already: true };

  // ملخص داخلي للأدمن: آخر ما دار مع البوت + ما عجز عنه
  // الطرفان معًا: سؤال العميل هو نصف القصة، وبدونه يقرأ الدعم إجابات بلا أسئلة
  const recent = all(
    `SELECT author_role, body, created_at FROM chat_messages
      WHERE user_id = ? AND channel = 'bot' AND visibility = 'all'
      ORDER BY id DESC LIMIT 10`,
    userId
  ).reverse();

  const failed = all(
    `SELECT question FROM bot_events WHERE user_id = ? AND answered = 0 ORDER BY id DESC LIMIT 3`,
    userId
  ).map((r) => r.question);

  const user = get('SELECT name FROM users WHERE id = ?', userId);
  const st = billing.accountState(userId);
  const sites = repo.listSites(userId);
  const down = sites.filter((s) => s.last_ok === 0).map((s) => s.name);

  const summary = [
    `🔺 تحويل من المساعد الآلي — ${user?.name || ''}`,
    `السبب: ${reason}`,
    failed.length ? `أسئلة لم يجب عنها المساعد:\n${failed.map((q) => `  • ${q}`).join('\n')}` : null,
    recent.length
      ? `آخر ما دار معه:\n${recent
          .map((m) => `  ${m.author_role === 'client' ? '👤 العميل' : '🤖 المساعد'}: ${String(m.body).replace(/\n/g, ' ').slice(0, 110)}`)
          .join('\n')}`
      : null,
    `حالة الحساب: ${{ trial: 'تجربة مجانية', ok: 'منتظم', due: 'عليه مستحقات', grace: 'في مهلة السداد', restricted: 'مزاياه مقفولة' }[st.state] || st.state}` +
      (st.dueCents ? ` — مستحق ${money.format(st.dueCents)}` : ''),
    down.length ? `⚠️ مواقع لا تفتح الآن: ${down.join('، ')}` : `كل مواقعه تعمل (${sites.length})`,
  ]
    .filter(Boolean)
    .join('\n');

  chat.sendMessage(userId, { body: summary, role: 'system', channel: 'live', visibility: 'internal' });

  // وللعميل: تأكيد واضح بتوقّع محدد
  const msg = chat.sendMessage(userId, {
    body: `تم تحويلك لفريق الدعم ✅\nنقلنا لهم كل اللي اتكلمنا فيه، فمش هتحتاج تعيد شرح المشكلة.\n\n${etaSentence()}`,
    role: 'system',
    channel: 'live',
  });

  chat.publish('admin', 'escalation', { user_id: userId, name: user?.name, reason, at: nowISO() });
  run('UPDATE bot_events SET escalated = 1 WHERE user_id = ? AND id IN (SELECT id FROM bot_events WHERE user_id = ? ORDER BY id DESC LIMIT 3)', userId, userId);

  return { already: false, message: msg };
}

/** إعادة العميل لوضع المساعد بعد انتهاء المحادثة */
export function backToBot(userId) {
  run("UPDATE users SET support_mode = 'bot', escalated_at = NULL WHERE id = ?", userId);
  return chat.sendMessage(userId, {
    body: 'انتهت المحادثة مع فريق الدعم. المساعد الآلي متاح لأي سؤال، وتقدر تطلب الدعم البشري في أي وقت.',
    role: 'system',
    channel: 'bot',
  });
}

/** المواضيع السريعة أعلى الشات — نقطة البداية لمن لا يعرف ماذا يسأل */
export function quickTopics() {
  const fromKb = all(
    `SELECT id, title FROM kb_articles WHERE active = 1 ORDER BY views DESC, sort_order LIMIT 4`
  );
  return [
    { key: 'site_status', label: 'موقعي شغّال؟' },
    { key: 'balance', label: 'عليّ كام؟' },
    { key: 'payment_how', label: 'إزاي أدفع؟' },
    ...fromKb.map((a) => ({ articleId: a.id, label: a.title })),
  ].slice(0, 6);
}

export { CONFIDENT, SUGGEST, etaSentence };

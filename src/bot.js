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
    ? `وفريق الدعم متاح الآن — الرد ${w.eta}.`
    : `ونحن خارج مواعيد العمل حاليًا (${hour12(w.from)} – ${hour12(w.to)})، لكن رسالتك محفوظة وسنرد عليك فور بدء اليوم.`;
}

// ——————————————————— النيّات على البيانات الحية ———————————————————

const has = (t, ...words) => words.some((w) => t.includes(kb.normalize(w)));

/**
 * يميّز سؤال المعرفة عن سؤال الحالة.
 * «ليه الصور بتبطئ المواقع؟» سؤال تعلُّم، بينما «موقعي بطيء؟» سؤال عن حالته.
 * بدون هذا التمييز يبتلع مطابِق النيّات كل سؤال فيه كلمة «بطيء» ويرد
 * بأرقام موقع العميل على سؤال لم يكن عن موقعه أصلًا.
 */
const ASKS_ABOUT_SELF = ['موقعي', 'موقعى', 'مواقعي', 'حسابي', 'عليا', 'علي', 'عندي', 'بتاعي', 'لوحتي'];
const LEARNING = ['ليه', 'لماذا', 'ما هو', 'ايه هو', 'ما هي', 'ايه هي', 'يعني ايه', 'ما الفرق', 'ايه الفرق', 'ازاي اختار', 'كيف اختار', 'ما معنى', 'يعني ٱيه'];

function isKnowledgeQuestion(t) {
  const aboutSelf = ASKS_ABOUT_SELF.some((w) => t.includes(kb.normalize(w)));
  const learning = LEARNING.some((w) => t.includes(kb.normalize(w)));
  return learning && !aboutSelf;
}

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
            ? `• ${s.name}: يعمل ✅${streak?.days >= 1 ? ` منذ ${streak.days} يومًا دون انقطاع` : ''} — درجة صحته ${s.health_score ?? '—'} من 100.`
            : `• ${s.name}: لا يفتح حاليًا ❌، وفريقنا يتابع الأمر.`;
        })
        .join('\n');
    },
  },
  {
    key: 'balance',
    match: (t) => has(t, 'عليا', 'مستحق', 'فلوس', 'حسابي', 'مديون') || (has(t, 'فاتوره', 'فواتير') && has(t, 'كام', 'قد ايه', 'مبلغ')),
    answer(userId) {
      const due = repo.outstanding(userId);
      if (!due.cents) return 'لا توجد مستحقات على حسابك — جميع الفواتير مسدَّدة، وشكرًا لك على الالتزام. 🙏';
      const st = billing.accountState(userId);
      let msg = `المستحق عليك ${money.format(due.cents)} على ${due.invoices} فاتورة.`;
      if (st.state === 'grace') msg += `\nأمامك ${st.graceLeft} أيام قبل إيقاف مزايا اللوحة مؤقتًا.`;
      if (st.state === 'restricted') msg += '\nالمزايا متوقفة حاليًا إلى حين السداد.';
      return `${msg}\nيمكنك السداد من صفحة «الاشتراك»، ويسعدني أن أعرض عليك طرق الدفع إن أردت.`;
    },
  },
  {
    key: 'payment_how',
    match: (t) => (has(t, 'ادفع', 'دفع', 'سداد', 'تحويل') && !has(t, 'مستحق')) || has(t, 'انستا', 'فودافون', 'محفظه'),
    answer() {
      const cfg = billing.paymentSettings();
      return `يمكنك التحويل بإحدى الطريقتين على الرقم نفسه:\n` +
        `• إنستا باي: ${cfg.instapay}\n` +
        `• فودافون كاش: ${cfg.vodafone}\n\n` +
        `ثم اكتب الرمز المرجعي لفاتورتك في ملاحظات التحويل، واضغط «أبلغت بالتحويل» من صفحة الاشتراك ليصلنا إشعارك ونؤكّد السداد سريعًا.`;
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
        if (c.ssl_days_left == null) return `• ${s.name}: يعمل على HTTP دون شهادة تشفير — وهذا يستدعي المعالجة.`;
        return `• ${s.name}: الشهادة سارية ${c.ssl_days_left} يومًا${c.ssl_days_left <= 21 ? ' — اقترب موعد التجديد ⚠️' : ' ✅'}`;
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
      return `${lines.join('\n')}\n\nوالقياس من خادم المراقبة لدينا، وقد يختلف قليلًا عن تجربة زائر في بلد آخر.`;
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
        .map((s) => `• ${s.name}: ${s.platform ? (names[s.platform] || s.platform) + (s.platform_version ? ` ${s.platform_version}` : '') : 'لم نتمكّن من تحديد المنصة عبر الفحص الخارجي'}`)
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

  // 1) نيّة على بيانات حية — ما لم يكن السؤال سؤال تعلُّم لا سؤال حالة
  const knowledge = isKnowledgeQuestion(t);
  for (const intent of INTENTS) {
    if (knowledge || !intent.match(t)) continue;
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
        body: `لستُ واثقًا أنني فهمت قصدك تمامًا. لعلّك تقصد أحد هذه:\n\n${list}\n\nاختر ما يناسبك، أو اضغط «تحدّث إلى الدعم الفني» وسأصلك بفريقنا فورًا.`,
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
      body: `لا أملك إجابة دقيقة عن هذا السؤال، ولم أشأ أن أخمّن.\n\n${etaSentence()}\n\nاضغط «تحدّث إلى الدعم الفني» وسأحوّلك فورًا، وأنقل معك كل ما دار بيننا — فلن تحتاج إلى إعادة الشرح.`,
      role: 'bot',
      channel: 'bot',
      meta: { kind: 'no_answer', question: raw },
    })
  );
  return { handled: true, noAnswer: true, messages: out };
}

// ——————————————————— وقت التفكير ———————————————————
// رد فوري تمامًا يكشف أنه آلي ويبدو غير مبالٍ. تأخير 3–7 ثوانٍ مع مؤشر
// «يكتب…» يجعل الحوار طبيعيًا، ويمنح العميل إحساسًا بأن سؤاله قُرئ.
// استثناء واحد مقصود: طلب التحويل الصريح لا يُؤخَّر — من يطلب إنسانًا
// يكون غالبًا متضايقًا، وإبقاؤه ينتظر يزيد الأمر سوءًا.

const pending = new Map(); // userId → مؤقّت، يمنع تراكم ردود على رسائل متتابعة

export function thinkDelay() {
  const min = Number(setting('bot_think_min') || 3) * 1000;
  const max = Number(setting('bot_think_max') || 7) * 1000;
  return min + Math.random() * Math.max(0, max - min);
}

export function setTyping(userId, on) {
  chat.publish(`u:${userId}`, 'typing', { on: Boolean(on), name: setting('bot_name') || 'سامي' });
}

/**
 * يرد بعد تفكير. يُرجع فورًا ولا يحجب الطلب.
 * @returns {{immediate?:object, delayMs?:number, escalated?:boolean}}
 */
export function handleDelayed(userId, text) {
  const t = kb.normalize(text);
  // التحويل الصريح: فورًا بلا انتظار
  if (has(t, 'كلم الدعم', 'الدعم الفني', 'موظف', 'انسان', 'حد حقيقي', 'محتاج حد', 'مش عايز بوت', 'تحدث الى الدعم')) {
    escalate(userId, { reason: 'طلب العميل التحدث إلى الفريق' });
    return { escalated: true };
  }

  // رسالة جديدة أثناء التفكير تلغي الرد السابق: نرد على آخر ما قاله لا على
  // كل رسالة على حدة، تمامًا كما يفعل إنسان يقرأ رسالتين متتاليتين.
  const prev = pending.get(userId);
  if (prev) clearTimeout(prev);

  setTyping(userId, true);
  const delayMs = thinkDelay();
  const timer = setTimeout(() => {
    pending.delete(userId);
    try {
      setTyping(userId, false);
      if (!isLive(userId)) handle(userId, text);
    } catch { /* العميل قد يكون خرج */ }
  }, delayMs);
  if (timer.unref) timer.unref();
  pending.set(userId, timer);

  return { delayMs: Math.round(delayMs) };
}

/** يلغي أي رد معلّق — يُستدعى عند التحويل حتى لا يقاطع سامي الموظف */
export function cancelPending(userId) {
  const t = pending.get(userId);
  if (t) {
    clearTimeout(t);
    pending.delete(userId);
    setTyping(userId, false);
  }
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
  cancelPending(userId); // لا يجوز أن يصل رد آلي بعد وصول الموظف
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
    body: `حوّلتك إلى فريق الدعم ✅\nنقلتُ إليهم كل ما دار بيننا، فلن تحتاج إلى إعادة شرح المشكلة.\n\n${etaSentence()}`,
    role: 'system',
    channel: 'live',
  });

  run('INSERT INTO escalations(user_id, started_at, reason) VALUES(?,?,?)', userId, nowISO(), String(reason).slice(0, 120));
  chat.publish('admin', 'escalation', { user_id: userId, name: user?.name, reason, at: nowISO() });
  run('UPDATE bot_events SET escalated = 1 WHERE user_id = ? AND id IN (SELECT id FROM bot_events WHERE user_id = ? ORDER BY id DESC LIMIT 3)', userId, userId);

  return { already: false, message: msg };
}

/** إعادة العميل لوضع المساعد بعد انتهاء المحادثة */
export function backToBot(userId) {
  run("UPDATE users SET support_mode = 'bot', escalated_at = NULL WHERE id = ?", userId);
  run(
    'UPDATE escalations SET closed_at = ? WHERE user_id = ? AND closed_at IS NULL',
    nowISO(), userId
  );
  return chat.sendMessage(userId, {
    body: 'انتهت محادثتك مع فريق الدعم. أنا سامي، وسأكون هنا لأي سؤال، ويمكنك طلب زميل من الفريق متى شئت.',
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
    { key: 'site_status', label: 'هل موقعي يعمل؟' },
    { key: 'balance', label: 'كم المستحق عليّ؟' },
    { key: 'payment_how', label: 'كيف أسدّد؟' },
    ...fromKb.map((a) => ({ articleId: a.id, label: a.title })),
  ].slice(0, 6);
}

/** يسجّل أول رد بشري — منه يُحسب متوسط زمن الاستجابة المعروض للعميل */
export function markFirstReply(userId) {
  run(
    `UPDATE escalations SET first_reply_at = ?
      WHERE id = (SELECT id FROM escalations WHERE user_id = ? AND first_reply_at IS NULL
                   ORDER BY started_at DESC LIMIT 1)`,
    nowISO(), userId
  );
}

/** متوسط زمن أول رد خلال آخر 30 يومًا، بالدقائق */
export function avgFirstReplyMinutes() {
  const row = get(
    `SELECT AVG((julianday(first_reply_at) - julianday(started_at)) * 1440) AS m
       FROM escalations
      WHERE first_reply_at IS NOT NULL AND started_at >= datetime('now', '-30 days')`
  );
  return row?.m ? Math.round(row.m) : null;
}

/** اسم المساعد — قابل للتغيير من الإعدادات */
export function botName() {
  return setting('bot_name') || 'سامي';
}

export { CONFIDENT, SUGGEST, etaSentence };

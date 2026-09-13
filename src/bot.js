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
const AUTO_ESCALATE_AFTER = 2; // محاولتان فاشلتان ثم تحويل تلقائي بلا سؤال

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

// ——————————————————— حدّ المعرفة ———————————————————

/**
 * بوابة النطاق: هل السؤال يخصّ المواقع والمتاجر وما يتصل بها؟
 *
 * القاعدة الحاكمة هنا **رصانة لا طموح**: إخراج سؤال مشروع من النطاق أسوأ
 * بكثير من إدخال سؤال غريب. الأول يقول لعميل يسأل في صميم خدمته إن سؤاله
 * ليس من تخصّصنا — إهانة صغيرة تُفقد الثقة كلها. والثاني يكلّف ردًّا ضائعًا.
 * لذلك البوابة **لا تُخرج شيئًا إلا بدليل**: كلمة خارج النطاق صريحة،
 * وغياب تام لأي صلة بالمجال، وعجز البحث في القاعدة عن أي تشابه يُذكر.
 */

// المعجم داخل النطاق يُبنى من قاعدة المعرفة نفسها: هي حدود ما نعرفه فعلًا،
// وتتوسّع تلقائيًّا مع كل مقال يكتبه الأدمن بلا تعديل هنا.
let domainWords = null;
let domainStamp = 0;

/** بذور يدوية لما قد لا يرد في نصّ أي مقال بعد */
const DOMAIN_SEED = [
  'موقع', 'مواقع', 'متجر', 'متاجر', 'دومين', 'نطاق', 'استضافه', 'سيرفر', 'خادم',
  'شهاده', 'ssl', 'امان', 'اختراق', 'فيروس', 'نسخه', 'باك اب', 'صيانه',
  'سرعه', 'بطيء', 'يبطئ', 'لودينج', 'استجابه', 'داون', 'انقطاع', 'عطل', 'يفتح',
  'ووردبريس', 'شوبيفاي', 'سله', 'زد', 'ووكومرس', 'ويكس', 'منصه', 'قالب', 'اضافه',
  'صفحه', 'رابط', 'روابط', 'سيو', 'زيارات', 'جوجل', 'ارشفه',
  'ايميل', 'بريد', 'اشتراك', 'فاتوره', 'فواتير', 'دفع', 'سداد', 'تحويل',
  'مستحق', 'حساب', 'كلمه السر', 'دخول', 'لوحه', 'تقرير', 'فحص', 'مراقبه',
  'تجديد', 'باقه', 'دعم', 'هوست', 'كاش', 'داتابيز', 'قاعده بيانات', 'اوردر',
];

/**
 * كلمات **قاطعة** في مجالنا. وجود واحدة منها يُبقي السؤال داخل النطاق مهما
 * بدا غريبًا — لأن «الموقع» و«الفاتورة» لا تُقالان عرضًا في سؤال عن الطبخ.
 * منفصلة عن المعجم المبني آليًّا لأن ذاك يلتقط كلمات عامة («سعر»، «ايه»،
 * «ازاي») من الكلمات المفتاحية العامية، وهي لا تصلح دليلًا على شيء.
 */
const DOMAIN_STRONG = [
  'موقع', 'مواقع', 'متجر', 'متاجر', 'دومين', 'استضافه', 'هوست', 'سيرفر', 'خادم',
  'شهاده', 'ssl', 'ووردبريس', 'شوبيفاي', 'سله', 'ووكومرس', 'ويكس', 'منصه',
  'اشتراك', 'فاتوره', 'فواتير', 'مستحق', 'سداد', 'صيانه', 'دومينات',
  'ايميل', 'بريد', 'سيو', 'ارشفه', 'لينك', 'صفحه', 'قالب', 'اضافه', 'باقه',
  'داتابيز', 'كاش', 'بلجن', 'ثيم', 'اوردر', 'اوردرات', 'سامي',
];

// ما لا علاقة له بمجالنا. لا نطمح للحصر — هذه أكثر ما يُسأل في غير محلّه،
// ووجودها **بلا كلمة قاطعة من المجال** هو ما يُخرج السؤال.
const OFF_DOMAIN = [
  'طبخ', 'وصفه', 'اكل', 'سمك', 'لحمه', 'مطعم', 'حلويات', 'شوي',
  'كوره', 'ماتش', 'مباراه', 'لاعب', 'الاهلي', 'الزمالك', 'رياضه',
  'طيران', 'تذكره', 'تذاكر', 'سفر', 'فندق', 'فيزا', 'سياحه', 'رحله',
  'دواء', 'مرض', 'طبيب', 'اعراض', 'علاج', 'مستشفى', 'حراره', 'برد', 'صداع',
  'صلاه', 'دعاء', 'قران', 'حديث', 'فتوى',
  'امتحان', 'امتحانات', 'ثانويه', 'كليه', 'جامعه', 'مذاكره', 'درجات', 'مدرسه',
  'فيلم', 'مسلسل', 'اغنيه', 'ممثل', 'مطرب', 'قصيده', 'شعر', 'روايه',
  'عقار', 'شقه', 'ايجار', 'عماره', 'عربيه', 'سياره', 'موتور', 'بنزين',
  'طقس', 'الجو', 'مطر', 'دولار', 'ذهب', 'بورصه', 'عمله', 'وظيفه', 'زواج',
];

/** ردود قصيرة ومجاملات — ليست أسئلة أصلًا، فلا تُقاس بمقياس النطاق */
const SMALL_TALK = [
  'تمام', 'شكرا', 'شكر', 'اوك', 'ok', 'ايوه', 'ايوة', 'نعم', 'لا', 'ماشي',
  'الحمد لله', 'السلام عليكم', 'صباح الخير', 'مساء الخير', 'اهلا', 'مرحبا',
  'حاضر', 'تسلم', 'ربنا يكرمك', 'جميل', 'عظيم', 'مفهوم', 'فهمت', 'سلام',
];

function domainVocabulary() {
  // نعيد البناء كل خمس دقائق: المقالات تتغيّر من لوحة الأدمن، ومعجم
  // مجمَّد عند الإقلاع يجعل مقالًا جديدًا كأنه لم يُكتب.
  if (domainWords && Date.now() - domainStamp < 300_000) return domainWords;
  const set = new Set(DOMAIN_SEED.flatMap((w) => kb.tokens(w)));
  try {
    for (const a of all('SELECT title, keywords, category FROM kb_articles WHERE active = 1')) {
      for (const w of kb.tokens(`${a.title} ${a.keywords || ''} ${a.category || ''}`)) set.add(w);
    }
  } catch { /* قاعدة لم تُهيَّأ بعد — البذور وحدها تكفي */ }
  domainWords = set;
  domainStamp = Date.now();
  return set;
}

/** يُستدعى بعد تعديل المقالات حتى لا ينتظر الأدمن خمس دقائق ليرى الأثر */
export const resetDomainVocabulary = () => { domainWords = null; };

/**
 * @returns {boolean} true إن كان السؤال داخل النطاق (أو لم نستطع الجزم)
 */
export function inScope(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;

  const norm = kb.normalize(raw);
  // مجاملة أو ردّ قصير: إخراجه يعني تحويل كل من يشكرنا إلى موظف
  if (SMALL_TALK.some((w) => norm === kb.normalize(w) || norm.startsWith(kb.normalize(w) + ' '))) return true;

  const words = kb.tokens(raw);
  if (words.length < 2) return true;

  const strongSet = new Set(DOMAIN_STRONG.flatMap((w) => kb.tokens(w)));
  const strong = words.some((w) => strongSet.has(w))
    || DOMAIN_STRONG.some((w) => norm.includes(kb.normalize(w)));

  // الترتيب مقصود: الكلمة الخارجة الصريحة تُرجَّح على المعجم المبني آليًّا،
  // لأن ذاك يلتقط كلمات عامة من الكلمات المفتاحية فيُدخل كل شيء.
  // ولا تُرجَّح على الكلمة القاطعة: «الدفع في متجري مش شغال» فيه «دفع»
  // و«متجر» معًا، وهو سؤالنا لا سؤال بنك.
  if (!strong && OFF_DOMAIN.some((w) => norm.includes(kb.normalize(w)))) return false;
  if (strong) return true;

  const vocab = domainVocabulary();
  if (words.some((w) => vocab.has(w))) return true;

  // لا دليل في الاتجاهين: نسأل القاعدة نفسها. أي تشابه يُذكر يعني أن
  // للسؤال صلة لم يلتقطها المعجم، فنُبقيه داخل النطاق — الشك لصالح العميل.
  let best = 0;
  try { best = kb.search(raw, { limit: 1 })[0]?.score || 0; } catch { best = 0; }
  return best >= 0.12;
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

export const isLive = (conversationId) => chat.isLive(conversationId);

/**
 * يعالج رسالة العميل ويرد.
 * @returns {{handled:boolean, messages:object[]}}
 */
/**
 * يعالج رسالة العميل داخل محادثة بعينها.
 * @param {object} conv صف المحادثة (يحمل id و user_id)
 */
export function handle(conv, text) {
  const userId = conv.user_id;
  const cid = conv.id;
  const raw = String(text || '').trim();
  const t = kb.normalize(raw);
  const out = [];

  if (wantsHuman(t)) return { handled: true, escalate: true, messages: [] };

  // 0) حدّ المعرفة — قبل أي محاولة إجابة.
  // سؤال خارج مجال المواقع والمتاجر لا يُخمَّن فيه ولا تُعرض عليه احتمالات:
  // نقول إن الإجابة ليست عندنا، ونصله بموظف. والاحتمالات هنا إهانة مضاعفة —
  // من يسأل عن أمر آخر تمامًا لا ينفعه أن نعرض عليه أبواب قاعدة المعرفة.
  // لا نزيد عدّاد الإخفاق: هذا حدٌّ معروف لا عجزٌ عن الفهم.
  const intentMatches = INTENTS.some((i) => i.match(t));
  if (!intentMatches && !inScope(raw)) {
    kb.logEvent({ userId, question: raw, intent: 'out_of_scope', answered: 0, escalated: 1 });
    out.push(chat.sendMessage(cid, {
      body: 'هذا السؤال خارج ما أعرفه — فتخصّصي المواقع والمتاجر الإلكترونية '
        + 'وما يتصل بها: الاستضافة والدومين والأمان والسرعة والأعطال والاشتراك.\n'
        + 'لا أحب أن أخمّن لك إجابة، فأصلك الآن بفريق الدعم مباشرة.',
      role: 'bot', channel: 'bot', meta: { kind: 'out_of_scope', question: raw },
    }));
    return {
      handled: true, escalate: true, outOfScope: true,
      reason: 'سؤال خارج نطاق المواقع والمتاجر',
      messages: out,
    };
  }

  // 1) نيّة على بيانات حية — ما لم يكن سؤال تعلُّم لا سؤال حالة
  const knowledge = isKnowledgeQuestion(t);
  for (const intent of INTENTS) {
    if (knowledge || !intent.match(t)) continue;
    let body;
    try { body = intent.answer(userId); } catch { body = null; }
    if (body) {
      chat.bumpFailStreak(cid, true);
      kb.logEvent({ userId, question: raw, intent: intent.key, answered: 1 });
      out.push(chat.sendMessage(cid, { body, role: 'bot', channel: 'bot' }));
      return { handled: true, intent: intent.key, messages: out };
    }
  }

  // 2) بحث في قاعدة المعرفة
  const hits = kb.search(raw, { limit: 3 });
  const top = hits[0];

  if (top && top.score >= CONFIDENT) {
    chat.bumpFailStreak(cid, true);
    kb.countView(top.id);
    kb.logEvent({ userId, question: raw, articleId: top.id, score: top.score, answered: 1 });
    out.push(chat.sendMessage(cid, {
      body: `**${top.title}**\n\n${top.body}`,
      role: 'bot', channel: 'bot',
      meta: { articleId: top.id, question: raw, kind: 'answer' },
    }));
    return { handled: true, articleId: top.id, messages: out };
  }

  // 3) لم يفهم — يقدّم احتمالات ولا يترك العميل في طريق مسدود
  chat.bumpFailStreak(cid);
  const streak = chat.failStreak(cid);

  // بعد محاولتين فاشلتين متتاليتين نحوّل تلقائيًا بلا سؤال:
  // إعادة عرض الاحتمالات على من لم تنفعه مرتين إصرارٌ لا مساعدة.
  if (streak >= AUTO_ESCALATE_AFTER) {
    kb.logEvent({ userId, question: raw, answered: 0, escalated: 1 });
    out.push(chat.sendMessage(cid, {
      body: `لم أوفّق في فهم ما تحتاجه مرتين، ولن أُضيع وقتك أكثر.\nأُحوّلك الآن إلى زميل من فريق الدعم ومعه كل ما دار بيننا.`,
      role: 'bot', channel: 'bot', meta: { kind: 'auto_escalate' },
    }));
    return { handled: true, escalate: true, autoEscalated: true, messages: out };
  }

  kb.logEvent({ userId, question: raw, articleId: top?.id || null, score: top?.score || null, answered: 0 });

  // الاحتمالات: أقرب المقالات إن وُجدت، وإلا أبواب قاعدة المعرفة نفسها
  const suggestions = hits.filter((h) => h.score >= SUGGEST).map((h) => ({ id: h.id, title: h.title }));
  const topics = suggestions.length ? [] : suggestedTopics();

  const intro = suggestions.length
    ? 'لستُ واثقًا أنني فهمت قصدك تمامًا. لعلّك تقصد أحد هذه:'
    : 'لم أجد إجابة دقيقة، ولم أشأ أن أخمّن. هل يتعلق سؤالك بأحد هذه؟';

  out.push(chat.sendMessage(cid, {
    body: `${intro}\n\n${(suggestions.length ? suggestions : topics).map((x) => `• ${x.title}`).join('\n')}\n\nوإن لم يكن أيٌّ منها، فاضغط «تحدّث إلى الدعم الفني» وسأصلك بزميل فورًا.`,
    role: 'bot', channel: 'bot',
    meta: {
      kind: suggestions.length ? 'suggest' : 'no_answer',
      question: raw,
      suggestions: suggestions.length ? suggestions : topics,
    },
  }));
  return { handled: true, suggested: Boolean(suggestions.length), noAnswer: !suggestions.length, messages: out };
}

/** طلب صريح للتحدث إلى إنسان */
function wantsHuman(t) {
  return has(t, 'كلم الدعم', 'الدعم الفني', 'موظف', 'انسان', 'حد حقيقي', 'محتاج حد',
    'مش عايز بوت', 'تحدث الى الدعم', 'عايز اتكلم مع', 'حد من الفريق');
}

/** أبواب قاعدة المعرفة كاحتمالات حين لا يوجد اقتراح قريب */
function suggestedTopics() {
  return all(
    `SELECT category AS title, MIN(id) AS id FROM kb_articles
      WHERE active = 1 GROUP BY category ORDER BY SUM(views) DESC LIMIT 5`
  );
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
export function handleDelayed(conv, text) {
  const userId = conv.user_id;
  const t = kb.normalize(text);
  // التحويل الصريح: فورًا بلا انتظار
  if (wantsHuman(t)) {
    escalate(conv, { reason: 'طلب العميل التحدث إلى الفريق' });
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
      if (chat.isLive(conv.id)) return;
      const r = handle(conv, text);
      // سبب التحويل يصل الأدمن في الملخّص، فيعرف فورًا لمَ وصلته المحادثة:
      // سؤال خارج النطاق يُعامَل غير عجزٍ متكرر عن الفهم.
      if (r.escalate) {
        escalate(conv, {
          reason: r.reason || (r.autoEscalated ? 'المساعد عجز مرتين' : 'طلب العميل'),
        });
      }
    } catch { /* العميل قد يكون خرج */ }
  }, delayMs);
  if (timer.unref) timer.unref();
  pending.set(userId, timer);

  return { delayMs: Math.round(delayMs) };
}

/**
 * يلغي كل الردود المعلّقة.
 * ضروري عند الإغلاق النظيف وفي الاختبارات: مؤقّت تفكير لم يُلغَ يظل يكتب
 * في قاعدة البيانات بعد انتهاء ما استدعاه، فيفسد ما بعده بصمت.
 */
export function cancelAllPending() {
  for (const [userId, t] of pending) {
    clearTimeout(t);
    try { setTyping(userId, false); } catch { /* لا مشتركين */ }
  }
  pending.clear();
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
export function showArticle(conv, articleId) {
  const a = kb.getArticle(articleId);
  if (!a) return null;
  kb.countView(a.id);
  chat.bumpFailStreak(conv.id, true);
  return chat.sendMessage(conv.id, {
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
export function escalate(conv, { reason = 'طلب العميل' } = {}) {
  const userId = conv.user_id;
  const cid = conv.id;
  cancelPending(userId); // لا يجوز أن يصل رد آلي بعد وصول الموظف

  const already = chat.isLive(cid);
  chat.setMode(cid, 'live');
  chat.bumpFailStreak(cid, true);
  if (already) return { already: true };

  // ملخص داخلي للأدمن: ما دار مع المساعد وما عجز عنه
  const recent = all(
    `SELECT author_role, body, created_at FROM chat_messages
      WHERE conversation_id = ? AND visibility = 'all' ORDER BY id DESC LIMIT 10`,
    cid
  ).reverse();

  const failed = all(
    'SELECT question FROM bot_events WHERE user_id = ? AND answered = 0 ORDER BY id DESC LIMIT 3',
    userId
  ).map((r) => r.question);

  const user = get('SELECT name FROM users WHERE id = ?', userId);
  const st = billing.accountState(userId);
  const sites = repo.listSites(userId);
  const down = sites.filter((s) => s.last_ok === 0).map((s) => s.name);

  const summary = [
    `🔺 تحويل من ${botName()} — ${user?.name || ''}`,
    `السبب: ${reason}`,
    failed.length ? `أسئلة لم يجب عنها المساعد:\n${failed.map((q) => `  • ${q}`).join('\n')}` : null,
    recent.length
      ? `آخر ما دار معه:\n${recent
          .map((m) => `  ${m.author_role === 'client' ? '👤 العميل' : '🤖 ' + botName()}: ${String(m.body).replace(/\n/g, ' ').slice(0, 110)}`)
          .join('\n')}`
      : null,
    `حالة الحساب: ${{ trial: 'تجربة مجانية', ok: 'منتظم', due: 'عليه مستحقات', grace: 'في مهلة السداد', restricted: 'مزاياه مقفولة' }[st.state] || st.state}` +
      (st.dueCents ? ` — مستحق ${money.format(st.dueCents)}` : ''),
    down.length ? `⚠️ مواقع لا تفتح الآن: ${down.join('، ')}` : `كل مواقعه تعمل (${sites.length})`,
  ].filter(Boolean).join('\n');

  chat.sendMessage(cid, { body: summary, role: 'system', channel: 'live', visibility: 'internal' });

  const msg = chat.sendMessage(cid, {
    body: `حوّلتك إلى فريق الدعم ✅\nنقلتُ إليهم كل ما دار بيننا، فلن تحتاج إلى إعادة شرح المشكلة.\n\n${etaSentence()}`,
    role: 'system', channel: 'live',
  });

  run('INSERT INTO escalations(user_id, conversation_id, started_at, reason) VALUES(?,?,?,?)',
    userId, cid, nowISO(), String(reason).slice(0, 120));
  chat.publish('admin', 'escalation', { conversation_id: cid, user_id: userId, name: user?.name, reason, at: nowISO() });
  run('UPDATE bot_events SET escalated = 1 WHERE id IN (SELECT id FROM bot_events WHERE user_id = ? ORDER BY id DESC LIMIT 3)', userId);

  return { already: false, message: msg };
}

/** إعادة العميل لوضع المساعد بعد انتهاء المحادثة */
/** إنهاء المحادثة وأرشفتها — والعميل يفتح جديدة متى شاء */
export function closeConversation(conv, by = 'admin') {
  chat.sendMessage(conv.id, {
    body: by === 'admin'
      ? 'أنهى فريق الدعم هذه المحادثة. تجدها محفوظة في سجلك، ويمكنك فتح محادثة جديدة متى احتجت.'
      : 'أُغلقت هذه المحادثة وحُفظت في سجلك. افتح محادثة جديدة متى شئت.',
    role: 'system', channel: 'bot',
  });
  return chat.closeConversation(conv.id, by);
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
export function markFirstReply(conversationId) {
  run(
    `UPDATE escalations SET first_reply_at = ?
      WHERE id = (SELECT id FROM escalations WHERE conversation_id = ? AND first_reply_at IS NULL
                   ORDER BY started_at DESC LIMIT 1)`,
    nowISO(), conversationId
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

export { CONFIDENT, SUGGEST, AUTO_ESCALATE_AFTER, etaSentence };

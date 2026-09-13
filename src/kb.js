// قاعدة المعرفة — تخزين وبحث عربي. FTS5 مدمج في SQLite، بلا أي مكتبة.
//
// FTS5 وحده لا يكفي للعربية: يزيل التشكيل لكنه لا يوحّد اختلاف رسم الحروف،
// فـ«الموقع بطيء» لا تطابق «الموقع بطئ»، و«صيانه» لا تطابق «صيانة».
// لذلك نطبّع النص قبل الفهرسة وقبل البحث معًا.
import { all, get, run, nowISO } from './db.js';

// ——————————————————— التطبيع العربي ———————————————————

const DIACRITICS = /[ً-ٰٕۖ-ۭـ]/g; // تشكيل + تطويل
const AR_DIGITS = /[٠-٩]/g;

export function normalize(text) {
  return String(text || '')
    .replace(DIACRITICS, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ى/g, 'ي')                      // ى → ي
    .replace(/ة/g, 'ه')                      // ة → ه
    .replace(/ؤ/g, 'و')                      // ؤ → و
    .replace(/ئ/g, 'ي')                      // ئ → ي
    .replace(/ء/g, '')                            // ء منفردة تُهمل
    // دمج الحروف المكررة الناتجة عن التوحيد: «بطيئة» تصير «بطييه» فلا تطابق
    // «بطيء». والعربية لا تكتب حرفًا مكررًا أصلًا — الشدّة هي ما يؤدي ذلك.
    .replace(/([ء-ي])\1+/g, '$1')
    .replace(AR_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * تجذير عربي خفيف — يقشّر السوابق واللواحق الشائعة.
 * بدونه «الفاتورة» و«فواتيري» و«فاتورة» ثلاث كلمات مختلفة عند البحث،
 * والعميل لا يكتب الصيغة التي كتبتَ بها المقال أبدًا.
 * محافظ عمدًا: لا يقشّر إن نزل الجذر عن ثلاثة أحرف.
 */
// السوابق أحادية الحرف (و ف ب ك ل) مستبعدة عمدًا: أكثر ضررًا من نفعها،
// فهي تقشّر «بطيء» إلى «طيء» و«فاتورة» إلى «اتورة». نكتفي بصيغ «ال».
const PREFIXES = ['وال', 'فال', 'بال', 'كال', 'لل', 'ال'];
const SUFFIXES = ['اتهم', 'اتها', 'هم', 'هن', 'كم', 'كن', 'نا', 'ني', 'ات', 'ون', 'ين', 'ه', 'ي'];

export function stem(word) {
  let w = word;
  for (const p of PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 3) { w = w.slice(p.length); break; }
  }
  for (const sfx of SUFFIXES) {
    if (w.endsWith(sfx) && w.length - sfx.length >= 3) { w = w.slice(0, -sfx.length); break; }
  }
  return w;
}

/** كلمات شائعة لا تفيد في الترجيح */
const STOP = new Set([
  'في', 'من', 'على', 'الى', 'عن', 'مع', 'هل', 'ما', 'ماذا', 'كيف', 'ازاي', 'ازى',
  'ليه', 'لماذا', 'انا', 'انت', 'هو', 'هي', 'ده', 'دي', 'ذلك', 'هذا', 'هذه',
  'يا', 'لو', 'او', 'و', 'ال', 'عايز', 'عاوز', 'اريد', 'ممكن', 'لكن', 'كل',
  'the', 'a', 'is', 'to', 'of', 'and', 'how', 'what', 'why',
]);

export function tokens(text, { stemmed = true } = {}) {
  const list = normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w));
  return stemmed ? [...new Set(list.map(stem))] : list;
}

/** مرادفات شائعة في سوقنا — تُوسّع الاستعلام فيلتقط ما لم يُكتب حرفيًا */
// الجمع المكسّر في العربية لا يُشتق بالتقشير (موقع ← مواقع)، فنصرّح بالشائع
// في مجالنا بدل تعقيد المُجذِّر وكسر كلمات سليمة.
const PLURALS = {
  موقع: ['مواقع'], فاتوره: ['فواتير'], شهاده: ['شهادات'], خدمه: ['خدمات'],
  صفحه: ['صفحات'], مشكله: ['مشاكل'], حساب: ['حسابات'], تقرير: ['تقارير'],
  اضافه: ['اضافات'], عطل: ['اعطال'], رابط: ['روابط'], صوره: ['صور'],
};

const SYNONYMS = {
  بطيء: ['بطي', 'تقيل', 'سرعه', 'لودينج', 'تبطي', 'بتبطي'],
  واقع: ['مقفول', 'مش شغال', 'مش فاتح', 'داون', 'توقف'],
  شهاده: ['ssl', 'اس اس ال', 'تشفير', 'قفل', 'https'],
  فاتوره: ['فلوس', 'مستحق', 'دفع', 'حساب', 'اشتراك'],
  دفع: ['تحويل', 'انستا', 'فودافون', 'سداد', 'محفظه'],
  صيانه: ['تحديث', 'باكب', 'نسخه'],
  دومين: ['نطاق', 'اسم الموقع', 'رابط'],
  استضافه: ['هوستنج', 'سيرفر', 'خادم'],
};

function expand(list) {
  const out = new Set(list);
  const addGroup = (map) => {
    for (const w of [...out]) {
      for (const [key, alts] of Object.entries(map)) {
        const kStem = stem(normalize(key));
        const hit = w === key || w === kStem || alts.some((a) => w === a || w === stem(normalize(a)));
        if (hit) {
          out.add(kStem);
          alts.forEach((a) => out.add(stem(normalize(a))));
        }
      }
    }
  };
  addGroup(SYNONYMS);
  addGroup(PLURALS);

  // التاء المربوطة تنقلب مفتوحة عند اتصال الضمير: لوحة ← لوحتي، فاتورة ← فاتورتك.
  // بعد التجذير يتبقى «لوحه» مقابل «لوحت» فلا يتطابقان. نضيف الصيغتين للاستعلام
  // بدل العبث بالفهرس نفسه — أقل خطرًا وأدق نتيجة.
  for (const w of [...out]) {
    if (w.length >= 4 && w.endsWith('ت')) out.add(w.slice(0, -1) + 'ه');
    if (w.length >= 4 && w.endsWith('ه')) out.add(w.slice(0, -1) + 'ت');
  }
  return [...out].filter(Boolean);
}

// ——————————————————— البحث ———————————————————

/**
 * يرجع المقالات مرتبة بالصلة، مع درجة ثقة 0..1.
 * الثقة هي ما يقرر: أجيب مباشرة، أم أقترح، أم أحوّل للدعم البشري.
 */
export function search(query, { limit = 5 } = {}) {
  const words = tokens(query);
  if (!words.length) return [];

  const expanded = expand(words);
  // نبني استعلام FTS آمنًا: كل كلمة بين علامتي اقتباس ومعها OR
  // البادئة (*) تلتقط تصريفات لم يصل إليها المُجذِّر: فاتور* ← فاتورة، فاتورتك
  const ftsQuery = expanded
    .map((w) => w.replace(/["*]/g, ''))
    .filter((w) => w.length > 1)
    .map((w) => (w.length >= 4 ? `"${w}"*` : `"${w}"`))
    .join(' OR ');

  let rows = [];
  try {
    rows = all(
      `SELECT a.*, bm25(kb_search, 10.0, 1.0, 6.0) AS rank
         FROM kb_search
         JOIN kb_articles a ON a.id = kb_search.rowid
        WHERE kb_search MATCH ? AND a.active = 1
        ORDER BY rank
        LIMIT ?`,
      ftsQuery,
      limit * 3
    );
  } catch {
    rows = []; // استعلام غير صالح — نسقط على الترجيح اليدوي
  }

  if (!rows.length) {
    // بديل: مطابقة جزئية على النص المُطبَّع
    const like = `%${normalize(query).slice(0, 60)}%`;
    rows = all(
      'SELECT *, 0 AS rank FROM kb_articles WHERE active = 1 AND search_text LIKE ? LIMIT ?',
      like,
      limit * 2
    );
  }

  const scored = rows.map((r) => {
    const titleWords = new Set(tokens(r.title));
    const titleBoost = words.filter((w) => titleWords.has(w)).length / Math.max(1, words.length);

    // التغطية: كم كلمة من سؤال العميل وردت فعلًا في المقال.
    // بدونها يكفي تطابق كلمة واحدة من ثمانٍ ليتجاوز عتبة الثقة، فيجيب سامي
    // عن سؤال لم يفهمه. ظهرت هذه المشكلة فور اتساع قاعدة المعرفة:
    // كلما زادت المقالات زاد احتمال التطابق العابر.
    const artWords = new Set([
      ...titleWords,
      ...tokens(r.keywords || ''),
      ...tokens(String(r.body).slice(0, 1500)),
    ]);
    const coverage = words.filter((w) => artWords.has(w)).length / Math.max(1, words.length);

    // bm25 سالب والأقرب للصفر أفضل — نحوّله إلى 0..1
    const base = r.rank ? Math.min(1, Math.abs(r.rank) / 12) : 0.35;
    const raw = base * 0.6 + titleBoost * 0.4;
    const score = Math.min(1, raw * (0.3 + 0.7 * coverage));
    return { ...r, score: Number(score.toFixed(3)), coverage: Number(coverage.toFixed(2)) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ——————————————————— القراءة والكتابة ———————————————————

export const getArticle = (idOrSlug) =>
  get('SELECT * FROM kb_articles WHERE id = ? OR slug = ?', Number(idOrSlug) || -1, String(idOrSlug));

export const listArticles = ({ activeOnly = true } = {}) =>
  all(
    `SELECT * FROM kb_articles ${activeOnly ? 'WHERE active = 1' : ''}
      ORDER BY category, sort_order, title`
  );

/** الأكثر قراءة — نقطة بداية لمن لا يعرف بمَ يبدأ */
export const popular = (limit = 4) =>
  all('SELECT id, slug, title FROM kb_articles WHERE active = 1 ORDER BY views DESC, sort_order LIMIT ?', limit);

export const categories = () =>
  all(
    `SELECT category, COUNT(*) AS n FROM kb_articles WHERE active = 1
      GROUP BY category ORDER BY MIN(sort_order)`
  );

export function saveArticle({ id, slug, title, body, keywords, category, sort_order, active }) {
  const at = nowISO();
  // نخزّن الصيغتين: المُطبَّعة للمطابقة الجزئية، والمجذّرة لمطابقة FTS
  const plain = normalize(`${title} ${keywords || ''} ${body}`);
  const searchText = `${plain} ${tokens(`${title} ${keywords || ''} ${body}`).join(' ')}`;
  const safeSlug = (slug || normalize(title).replace(/\s+/g, '-')).slice(0, 80) || `a-${Date.now()}`;

  if (id) {
    run(
      `UPDATE kb_articles SET slug=?, title=?, body=?, keywords=?, category=?,
              search_text=?, sort_order=?, active=?, updated_at=? WHERE id=?`,
      safeSlug, title, body, keywords || null, category || 'عام',
      searchText, Number(sort_order) || 100, active ? 1 : 0, at, id
    );
    return id;
  }
  const r = run(
    `INSERT INTO kb_articles(slug, title, body, keywords, category, search_text, sort_order, active, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    safeSlug, title, body, keywords || null, category || 'عام',
    searchText, Number(sort_order) || 100, active === 0 ? 0 : 1, at, at
  );
  return Number(r.lastInsertRowid);
}

export const deleteArticle = (id) => run('DELETE FROM kb_articles WHERE id = ?', id);
export const countView = (id) => run('UPDATE kb_articles SET views = views + 1 WHERE id = ?', id);

export function recordFeedback(articleId, userId, helpful, question) {
  run(
    'INSERT INTO kb_feedback(article_id, user_id, helpful, question, at) VALUES(?,?,?,?,?)',
    articleId, userId, helpful ? 1 : 0, question || null, nowISO()
  );
  run(
    `UPDATE kb_articles SET ${helpful ? 'helpful = helpful + 1' : 'not_helpful = not_helpful + 1'} WHERE id = ?`,
    articleId
  );
}

// ——————————————————— رؤى للأدمن ———————————————————

/** أسئلة لم يجد لها المساعد إجابة — قائمة المقالات التي يجب أن تكتبها */
export const unanswered = (limit = 30) =>
  all(
    `SELECT question, COUNT(*) AS times, MAX(at) AS last_at
       FROM bot_events WHERE answered = 0
      GROUP BY LOWER(question) ORDER BY times DESC, last_at DESC LIMIT ?`,
    limit
  );

/** مقالات يقرؤها الناس ثم يقولون إنها لم تفد — تحتاج إعادة كتابة */
export const weakArticles = () =>
  all(
    `SELECT * FROM kb_articles
      WHERE not_helpful > 0 AND not_helpful >= helpful
      ORDER BY not_helpful DESC LIMIT 20`
  );

export function logEvent({ userId, question, intent = null, articleId = null, score = null, answered, escalated = 0 }) {
  const r = run(
    `INSERT INTO bot_events(user_id, at, question, intent, article_id, score, answered, escalated)
     VALUES(?,?,?,?,?,?,?,?)`,
    userId, nowISO(), String(question).slice(0, 500), intent, articleId, score, answered ? 1 : 0, escalated ? 1 : 0
  );
  return Number(r.lastInsertRowid);
}

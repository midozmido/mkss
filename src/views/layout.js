// مكوّنات الواجهة — HTML مولّد من السيرفر، بلا مكتبة ولا خطوة بناء.
// كل قيمة تمر على esc() قبل العرض.
import { esc, safeUrl } from '../http-util.js';

// ——————————————————— الأيقونات ———————————————————
// SVG مضمّن — لا مكتبة أيقونات ولا خط أيقونات.
// كل حالة لها أيقونة إلى جانب اللون، فلا يعتمد الفهم على اللون وحده.
const ICONS = {
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 01-5 5L4 17v3h3l5.7-5.7a4 4 0 015-5l-2.5-2.5 2-2 2.5 2.5z"/>',
  receipt: '<path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3H5zM9 8h6M9 12h6"/>',
  chat: '<path d="M21 12a8 8 0 01-11.4 7.2L3 21l1.8-6.6A8 8 0 1121 12z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  arrow: '<path d="M11 5l-7 7 7 7M4 12h16"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6"/>',
  logout: '<path d="M9 21H5a1 1 0 01-1-1V4a1 1 0 011-1h4M16 17l5-5-5-5M21 12H9"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  inbox: '<path d="M3 12h5l2 3h4l2-3h5M4 4h16l1 8v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-7z"/>',
  book: '<path d="M4 5a2 2 0 012-2h13v18H6a2 2 0 01-2-2V5zM19 17H6a2 2 0 00-2 2M9 7h7M9 11h7"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  users: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.9"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  crown: '<path d="M3 18h18M4 7l4 4 4-7 4 7 4-4-1.5 9h-13z"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  send: '<path d="M4 20l16-8L4 4v6l10 2-10 2z"/>',
  eye: '<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c7 0 10.5 6 10.5 6a18 18 0 0 1-3.3 4M6.4 7.9A18 18 0 0 0 1.5 12S5 18 12 18a9.8 9.8 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/>',
};

/**
 * صورة سامي — شبح ودود على طراز كاسبر، بلون الهوية لا بالأبيض.
 * مرسوم كـ SVG مضمّن: لا ملف صورة ولا خط أيقونات ولا طلب شبكة.
 * currentColor يجعله يتبع لون الشات الذي يختاره العميل تلقائيًا.
 */
export function sami(size = 40, { floating = true } = {}) {
  return `<span class="sami ${floating ? 'sami-float' : ''}" style="inline-size:${size}px;block-size:${size}px" aria-hidden="true">
  <svg viewBox="0 0 64 72" width="${size}" height="${size}">
    <path fill="currentColor" d="M32 5C18.7 5 8 15.7 8 29v29.6c0 2.6 3 4.1 5.1 2.5l3.7-2.8a3 3 0 0 1 3.6 0l3 2.3a3 3 0 0 0 3.6 0l3-2.3a3 3 0 0 1 3.6 0l3 2.3a3 3 0 0 0 3.6 0l3-2.3a3 3 0 0 1 3.6 0l3.7 2.8c2.1 1.6 5.1.1 5.1-2.5V29C56 15.7 45.3 5 32 5z"/>
    <ellipse cx="23.5" cy="30" rx="4.2" ry="5.4" fill="#fff"/>
    <ellipse cx="40.5" cy="30" rx="4.2" ry="5.4" fill="#fff"/>
    <circle cx="24.6" cy="31.4" r="1.9" fill="#10151c"/>
    <circle cx="41.6" cy="31.4" r="1.9" fill="#10151c"/>
    <path d="M26 42.5c1.9 3.2 10.1 3.2 12 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="17.5" cy="39" rx="3" ry="2" fill="#fff" opacity=".35"/>
    <ellipse cx="46.5" cy="39" rx="3" ry="2" fill="#fff" opacity=".35"/>
  </svg>
</span>`;
}

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.globe;
  return `<svg class="${esc(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    width="16" height="16">${body}</svg>`;
}

/**
 * يعزل المقاطع اللاتينية داخل النص العربي بـ <bdi>.
 * بدونه يتبعثر سطر مثل: أضف: Permissions-Policy: geolocation=()
 * فيظهر الأقواس والنقطتين في غير مواضعها — خطأ يلاحظه أي قارئ عربي.
 */
export function bidi(text) {
  return String(text ?? '')
    .split(/([A-Za-z][A-Za-z0-9\-_./:=(),;'"*\s]*[A-Za-z0-9)(\-_.]|[A-Za-z])/g)
    .map((part, i) => (i % 2 ? `<bdi>${esc(part)}</bdi>` : esc(part)))
    .join('');
}

// ——————————————————— أدوات العرض ———————————————————

const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

/** تاريخ بالعربي — الأرقام غربية (1234) لأنها المعتاد في السياق المهني المصري */
export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const base = `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!withTime) return base;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${base} — ${hh}:${mm}`;
}

/** صيغ العدد العربية: مفرد · مثنى · جمع قلة (3-10) · جمع كثرة (11+) */
export function plural(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * مدّة مقروءة من عدد دقائق. «لم نكن نراقب لمدة 2413 دقيقة» رقمٌ لا يقرؤه
 * إنسان: عليه أن يقسمه على ستين ثم على أربع وعشرين ليعرف أنها يومان.
 */
export function humanMinutes(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (m < 60) return plural(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
  const h = Math.round(m / 60);
  if (h < 24) return plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  const d = Math.round(h / 24);
  if (d < 30) return plural(d, 'يوم', 'يومين', 'أيام', 'يومًا');
  return plural(Math.round(d / 30), 'شهر', 'شهرين', 'شهور', 'شهرًا');
}

/** «منذ ٣ أيام» — أقرب للفهم من تاريخ مطلق */
export function ago(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'الآن';
  // العربية فيها مثنى وجمع قلة وجمع كثرة — «2 دقيقة» خطأ يلاحظه أي قارئ عربي
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'الآن';
  // «منذ» لا «من»: الثانية حرف ابتداء مكان، والأولى ظرف زمن — و«آخر فحص من
  // أربع دقائق» جملة مكسورة في الفصحى يقرؤها العميل في كل بطاقة وكل جدول.
  if (m < 60) return `منذ ${plural(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const d = Math.floor(h / 24);
  if (d < 30) return `منذ ${plural(d, 'يوم', 'يومين', 'أيام', 'يوم')}`;
  const mo = Math.floor(d / 30);
  return `منذ ${plural(mo, 'شهر', 'شهرين', 'شهور', 'شهرًا')}`;
}

// ——————————————————— مكوّنات الحالة ———————————————————

const GRADES = {
  excellent: { cls: 'ok', icon: 'check', label: 'ممتاز' },
  good: { cls: 'ok', icon: 'check', label: 'جيد' },
  attention: { cls: 'warn', icon: 'alert', label: 'يحتاج انتباه' },
  problems: { cls: 'danger', icon: 'alert', label: 'فيه مشاكل' },
  critical: { cls: 'danger', icon: 'x', label: 'حرج' },
  unknown: { cls: '', icon: 'clock', label: 'لم يُفحص بعد' },
};

export function gradeOf(score) {
  if (score == null) return 'unknown';
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'attention';
  if (score >= 40) return 'problems';
  return 'critical';
}

/**
 * اسم عربي لنوع العطل.
 * كان الجدول يطبع قيمة العمود كما هي: ‎down‎ و‎ssl‎ و‎server_error‎ — كلمات
 * إنجليزية داخل جدول عربي، بجانب عمودٍ يقول «لا يفتح» بالعربية. وتظهر عند
 * العميل أيضًا في صفحة موقعه حين يكون التفصيل فارغًا.
 */
const INCIDENT_LABELS = {
  down: 'لا يفتح',
  server_error: 'خطأ في الخادم',
  blocked: 'محجوب عنّا',
  ssl: 'شهادة الأمان',
  slow: 'بطء شديد',
};
export const incidentLabel = (kind) => INCIDENT_LABELS[kind] || kind || '—';

/** شارة الحالة — أيقونة + نص + لون، لا لون وحده */
export function statusBadge(site) {
  if (site.last_ok == null) {
    return `<span class="badge">${icon('clock')} لم يُفحص بعد</span>`;
  }
  return site.last_ok
    ? `<span class="badge badge-ok">${icon('check')} شغّال</span>`
    : `<span class="badge badge-danger">${icon('x')} لا يفتح</span>`;
}

export function gradeBadge(score) {
  const g = GRADES[gradeOf(score)];
  const cls = g.cls ? `badge-${g.cls}` : '';
  return `<span class="badge ${cls}">${icon(g.icon)} ${esc(g.label)}</span>`;
}

const PLATFORM_LABELS = {
  wordpress: 'ووردبريس', shopify: 'شوبيفاي', salla: 'سلة', zid: 'زد',
  woocommerce: 'ووكومرس', wix: 'ويكس', squarespace: 'سكوير سبيس',
  webflow: 'ويب فلو', magento: 'ماجنتو', opencart: 'أوبن كارت',
  prestashop: 'بريستاشوب', joomla: 'جوملا', drupal: 'دروبال', ghost: 'جوست',
  bigcommerce: 'بيج كوميرس', framer: 'فريمر', duda: 'دودا', weebly: 'ويبلي',
  blogger: 'بلوجر', hubspot: 'هبسبوت', nextjs: 'Next.js', nuxt: 'Nuxt',
  laravel: 'Laravel', django: 'Django', rails: 'Rails', aspnet: 'ASP.NET',
};

export function platformBadge(site) {
  if (!site.platform) {
    return `<span class="badge" title="لم نتعرف على المنصة من الفحص الخارجي">${icon('globe')} منصة غير محددة</span>`;
  }
  const label = PLATFORM_LABELS[site.platform] || site.platform;
  const v = site.platform_version ? ` ${site.platform_version}` : '';
  const conf = site.platform_confidence ? ` — ثقة ${site.platform_confidence}%` : '';
  return `<span class="badge badge-brand" title="اكتُشفت من الفحص الخارجي${esc(conf)}">${icon('grid')} ${esc(label + v)}</span>`;
}

/**
 * ما اكتُشف **فوق** المنصّة: إضافة متجر، بانٍ صفحات، شبكة توزيع، خادم.
 *
 * كان الفحص يكتشف هذا كلّه ويخزّنه في ‎sites.platform_extras‎ ثم **لا يقرؤه
 * أحد**: عميلٌ على ووكومرس يرى «ووردبريس ٦٫٤» ولا يرى أننا عرفنا أن عنده
 * متجرًا أصلًا. عملٌ يُدفع ثمنه ولا يُعرَض.
 *
 * والثقة تظهر نصًّا لا في ‎title‎ وحده: التلميحة لا تُفتح بالإصبع، ومقال
 * «كيف عرفتم منصة موقعي؟» يَعِد العميل بأننا نعرض له النسبة.
 */
export function platformExtras(site) {
  let data = null;
  try { data = JSON.parse(site.platform_extras || 'null'); } catch { /* صفٌّ قديم أو تالف */ }
  if (!data) return '';

  const chips = [];
  for (const a of data.addons || []) {
    const v = a.version ? ` ${a.version}` : '';
    chips.push(`<span class="badge badge-brand">${icon('grid')} ${esc((a.label || a.en || a.key) + v)}</span>`);
  }
  for (const e of data.extras || []) chips.push(`<span class="badge">${esc(e.label || e.key)}</span>`);
  if (data.cdn) chips.push(`<span class="badge">${icon('globe')} ${esc(data.cdn)}</span>`);
  if (data.server) chips.push(`<span class="badge">${esc(data.server)}</span>`);
  if (!chips.length) return '';

  return `<div class="row" style="margin-block-start:var(--s-3)">
    <span class="faint small">اكتُشف أيضًا${site.platform_confidence ? ` — ثقة ${esc(site.platform_confidence)}%` : ''}:</span>
    ${chips.join('')}
  </div>`;
}

/** حلقة درجة الصحة — SVG، بلا مكتبة */
export function healthRing(score, size = 64) {
  const g = GRADES[gradeOf(score)];
  const color = g.cls ? `var(--${g.cls})` : 'var(--neutral)';
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const offset = c - (pct / 100) * c;
  return `<div class="ring" style="inline-size:${size}px;block-size:${size}px"
    role="img" aria-label="درجة الصحة ${score == null ? 'غير متاحة' : score + ' من 100'}">
    <svg width="${size}" height="${size}" aria-hidden="true">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="5"/>
      <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="5"
        stroke="${color}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
    </svg>
    <span class="ring-value" style="color:${color}">${score == null ? '—' : score}</span>
  </div>`;
}

/** شريط التشغيل — كل عمود فحص. الفجوات مخطّطة لا خضراء: لا نزعم مراقبة لم تحدث */
export function uptimeBar(checks, max = 40) {
  const slice = checks.slice(-max);
  const pad = Math.max(0, max - slice.length);
  const cells = [
    ...Array(pad).fill('<span class="up-none" title="لا بيانات"></span>'),
    ...slice.map((c) => {
      const t = `${fmtDate(c.at, true)} — ${c.ok ? 'شغّال' : 'لا يستجيب'}`;
      return `<span class="${c.ok ? 'up-ok' : 'up-bad'}" title="${esc(t)}"></span>`;
    }),
  ];
  return `<div class="uptime-bar" role="img" aria-label="سجل آخر ${slice.length} فحص">${cells.join('')}</div>
  <div class="row-between faint small" style="margin-block-start:var(--s-2)"><span>الأقدم</span><span>الأحدث</span></div>`;
}

/** منحنى زمن الاستجابة — SVG مولّد، بلا Chart.js */
export function sparkline(checks, { width = 640, height = 120 } = {}) {
  // الفحص الفاشل يسجّل زمنًا ضئيلًا لأن الاتصال يُرفض فورًا، فإدخاله في
  // منحنى الأداء يرسم هبوطًا يبدو تحسّنًا — وهو في الحقيقة انقطاع.
  const pts = checks.filter((c) => c.response_ms != null && c.ok !== 0 && c.ok !== false);
  if (pts.length < 2) {
    return `<p class="faint center">لا توجد قياسات كافية لرسم المنحنى بعد.</p>`;
  }
  const vals = pts.map((p) => p.response_ms);
  const max = Math.max(...vals) * 1.15;
  const min = 0;
  const pad = { top: 10, bottom: 22, side: 4 };
  const w = width - pad.side * 2;
  const h = height - pad.top - pad.bottom;

  // المحور الزمني من اليمين لليسار ليتبع اتجاه القراءة العربية:
  // أحدث قياس عند اليمين حيث تبدأ العين.
  const x = (i) => pad.side + w - (i / (pts.length - 1)) * w;
  const y = (v) => pad.top + h - ((v - min) / (max - min)) * h;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.response_ms).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${(pad.top + h).toFixed(1)}L${x(0).toFixed(1)},${(pad.top + h).toFixed(1)}Z`;
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  // التسميات خارج الـ SVG: نص داخل SVG مُحجَّم يُقص أو يتشوّه على العروض المختلفة
  return `<figure style="margin:0">
    <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
        role="img" aria-label="منحنى زمن الاستجابة — المتوسط ${avg} جزء من الألف من الثانية">
      <line class="chart-grid" x1="${pad.side}" y1="${(pad.top + h).toFixed(1)}" x2="${width - pad.side}" y2="${(pad.top + h).toFixed(1)}"/>
      <path class="chart-area" d="${area}"/>
      <path class="chart-line" d="${line}"/>
    </svg>
    <!-- الترتيب هنا ترتيبُ ما يراه المستخدم لا ترتيب الكتابة: ‎.row-between‎
         حاوية ‎flex‎ داخل صفحة ‎RTL‎، فأول ابن يظهر على **اليمين**. وكانت
         «الأحدث» أولًا فتُرسم يمينًا بينما أحدث نقطة في المنحنى على اليسار —
         تسميةٌ تكذّب الرسم الذي تحتها. والأسهم حُذفت: سهمٌ في سياق ‎RTL‎
         يحتمل القراءتين، والكلمة في مكانها الصحيح لا تحتمل إلا واحدة. -->
    <figcaption class="row-between faint" style="margin-block-start:var(--s-2)">
      <span>الأقدم</span>
      <span>المتوسط <b class="num">${avg}ms</b></span>
      <span>الأحدث</span>
    </figcaption>
  </figure>`;
}

// ——————————————————— هوية النظام ———————————————————

export const APP_NAME = 'Support VIP System';

/** العلامة — الاسم بالإنجليزية كما طُلب، والوصف بالعربية تحته */
export function wordmark({ compact = false } = {}) {
  return `<span class="brand-mark" aria-hidden="true">V</span>
  <span class="brand-name">
    <b>Support <span class="vip">VIP</span></b>
    ${compact ? '' : '<small>System</small>'}
  </span>`;
}

// ——————————————————— الشريط الجانبي ———————————————————

/**
 * عناصر التنقل — **مفصولة بالدور فصلًا تامًّا**.
 * لا عنصر مشترك بين اللوحتين: العميل لا يرى مسارًا إداريًّا، والأدمن لا يرى
 * سامي ولا لوحة عميل. هذا هو الفصل الذي طُلب، ومكانه هنا لا في القوالب.
 */
export function navGroups(user) {
  if (!user) return [];
  const n = (href, label, ic, badge = 0) => ({ href, label, ic, badge });
  if (user.role === 'admin') {
    return [
      { label: 'التشغيل', items: [
        n('/admin', 'اللوحة', 'grid'),
        n('/admin/clients', 'العملاء', 'users'),
      ] },
      { label: 'الدعم المباشر', items: [
        n('/admin/chat', 'محادثات العملاء', 'chat', user.unreadChat || 0),
        n('/admin/kb', 'قاعدة المعرفة', 'book'),
        n('/admin/replies', 'الردود المحفوظة', 'send'),
      ] },
      { label: 'التحصيل', items: [
        n('/admin/payments', 'المدفوعات', 'receipt', user.pendingClaims || 0),
        n('/admin/requests', 'الطلبات', 'inbox', user.pendingResets || 0),
      ] },
      { label: 'النظام', items: [
        n('/admin/guide', 'دليل الإدارة', 'sparkle'),
        n('/admin/settings', 'الإعدادات', 'cog'),
      ] },
    ];
  }
  return [
    { label: 'المتابعة', items: [
      n('/', 'مواقعي', 'grid'),
    ] },
    { label: 'المساعدة', items: [
      n('/chat', 'الدعم والمحادثة', 'chat', user.unreadChat || 0),
      n('/help', 'مكتبة المساعدة', 'book'),
      n('/guide', 'دليل الاستخدام', 'sparkle'),
    ] },
    { label: 'حسابك', items: [
      n('/invoices', 'الفواتير', 'receipt'),
      n('/billing', 'الاشتراك', 'shield'),
    ] },
  ];
}

/** المسار الفعّال: تطابق تام، أو بادئة لصفحة داخلية (‏/chat/12 ⇒ /chat) */
function isActive(active, href) {
  if (active === href) return true;
  if (href === '/' || href === '/admin') return false;
  return typeof active === 'string' && active.startsWith(href + '/');
}

function sidenav(user, active) {
  const groups = navGroups(user)
    .map((g) => `<div class="nav-group">
      <span class="nav-group-label">${esc(g.label)}</span>
      ${g.items.map((it) => `<a class="nav-item${isActive(active, it.href) ? ' is-active' : ''}" href="${it.href}">
        <span class="nav-ico">${icon(it.ic)}</span>
        <span class="nav-label">${esc(it.label)}</span>
        ${it.badge > 0 ? `<span class="pill">${it.badge > 99 ? '99+' : it.badge}</span>` : ''}
      </a>`).join('')}
    </div>`).join('');

  const initial = esc(String(user.name || user.email || '؟').trim().charAt(0));
  return `<aside class="sidenav" id="sidenav" aria-label="التنقل الرئيسي">
  <div class="sidenav-head">
    <a class="brand" href="${user.role === 'admin' ? '/admin' : '/'}">${wordmark()}</a>
    <button class="icon-btn sidenav-close" type="button" data-nav-close aria-label="إغلاق القائمة">${icon('x')}</button>
  </div>
  <nav class="sidenav-nav">${groups}</nav>
  <div class="sidenav-foot">
    <div class="who">
      <span class="who-ava" aria-hidden="true">${initial}</span>
      <span class="who-text">
        <b>${esc(user.name || 'مستخدم')}</b>
        <small dir="ltr">${esc(user.email || '')}</small>
      </span>
    </div>
    <form method="POST" action="/logout">
      <input type="hidden" name="_csrf" value="${esc(user.csrf || '')}">
      <button class="btn btn-ghost btn-block btn-sm" type="submit">${icon('logout')} خروج</button>
    </form>
  </div>
</aside>`;
}

// ——————————————————— القالب العام ———————————————————

const HEAD = (title) => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — ${APP_NAME}</title>
<link rel="stylesheet" href="/app.css">
<!-- الوزنان اللذان تبدأ بهما كل صفحة. بلا التحميل المسبق يُرسم النص بخط
     احتياطي ثم يقفز إلى Tajawal بعد وصول الملف — وميض يراه العميل كل زيارة. -->
<link rel="preload" href="/fonts/tajawal-400-ar.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/tajawal-700-ar.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230d7a6f'/><text x='16' y='23' font-size='17' font-family='Georgia,serif' font-weight='bold' fill='white' text-anchor='middle'>V</text></svg>">
</head>`;

/** القالب الكامل: شريط جانبي ثابت، ومحتوى بجانبه. */
export function layout({ title, user, active = '', body, flash = null, nonce = '' }) {
  // بلا جلسة لا شريط ولا تنقّل — لكن ليست صفحة دخول أيضًا. صفحات الخطأ تمر
  // من هنا، وعرضها داخل لوحة تسويق الدخول يربك من وصل إلى رابط منتهٍ.
  if (!user) return bareLayout({ title, body, nonce });
  return `${HEAD(title)}
<body class="has-shell" data-role="${esc(user.role || 'client')}">
<a class="skip-link" href="#main">تخطَّ إلى المحتوى</a>
<div class="nav-progress" id="nav-progress" hidden><span></span></div>
<div class="app">
  <header class="appbar">
    <button class="icon-btn" type="button" data-nav-open aria-controls="sidenav" aria-expanded="false" aria-label="فتح القائمة">${icon('menu')}</button>
    <a class="brand brand-compact" href="${user.role === 'admin' ? '/admin' : '/'}">${wordmark({ compact: true })}</a>
    <span class="grow"></span>
    <button class="icon-btn" id="theme-toggle" type="button" aria-label="تبديل الوضع الليلي">${icon('moon')}</button>
  </header>
  ${sidenav(user, active)}
  <div class="scrim" data-nav-close hidden></div>
  <main id="main" class="app-main">
    <div class="page">
      ${flash ? `<div class="alert alert-${esc(flash.kind || 'info')}" role="status">${icon(flash.kind === 'danger' ? 'alert' : 'check')}<div>${esc(flash.text)}</div></div>` : ''}
      ${body}
    </div>
  </main>
</div>
<script src="/app.js"${nonce ? ` nonce="${esc(nonce)}"` : ''} defer></script>
</body>
</html>`;
}

/** قالب بسيط لمن لا جلسة له: العلامة وحدها فوق محتوى في الوسط */
export function bareLayout({ title, body, nonce = '' }) {
  return `${HEAD(title)}
<body class="is-bare">
<div class="bare-shell">
  <a class="brand bare-brand" href="/login">${wordmark()}</a>
  <div class="bare-body">${body}</div>
</div>
<script src="/app.js"${nonce ? ` nonce="${esc(nonce)}"` : ''} defer></script>
</body>
</html>`;
}
/**
 * الخاتَم — الشبكة التي تُبنى عليها صفحة الدخول.
 *
 * «خاتم سليماني»: نجمة ثمانية على شبكة مربّعة، وهي زخرفة المنابر والمشربيات
 * في القاهرة المملوكية. اختيارها ليس تزيينًا ولا استعارة ثقافية:
 *
 *   • «خاتَم» في العربية هو الخَتْم — وهذه صفحة خَتْم: من يعرف الكلمة يدخل.
 *   • والتغطية (tessellation) وعدٌ بلا فجوة: الشكل يملأ المستوى بلا فراغ
 *     واحد. وهذا بالضبط ما نبيعه — مراقبة بلا انقطاع.
 *   • وهي المقابل المصري المباشر لشبكة النقاط السيليكونية التي تُزيَّن بها
 *     كل صفحة دخول في العالم.
 *
 * ولها فائدة هندسية تتجاوز الشكل: النقاط المضيئة في الطبقة العلوية تسير على
 * **خطوط هذه الشبكة نفسها** لا في فراغ. الخطوط المحورية المرسومة هنا — من
 * مركز كل نجمة إلى مراكز جاراتها — هي مسار الجسيمات حرفًا بحرف، وهو ما
 * يمنع أن تصير «نقاطًا عائمة تربطها خطوط» كأي قالب.
 *
 * تُرسم بـ‎<pattern>‎ واحد يتكرّر، و‎currentColor‎ يجعلها تتبع لون البوابة
 * (أخضر للعميل، نيلي للإدارة) وتنقلب مع الوضع الليلي بلا نسخة ثانية.
 *
 * @param {number} S ضلع الخلية بالبكسل — ومقاس الشبكة كلها يتبعه
 */
export function khatam(S = 112) {
  const c = S / 2;
  const R = S * 0.34;          // نصف قطر رؤوس النجمة
  const r = R * 0.7654;        // رؤوس الوديان — نسبة مربّعين متراكبين
  const inner = R * 0.34;      // المثمّن الداخلي
  const diam = S * 0.115;      // معيّن الزاوية (الصليب بين النجوم)
  const fix = (n) => Math.round(n * 100) / 100;

  // نجمة ‎{8/2}‎: ستة عشر رأسًا تتناوب بين نصفَي القطر كل ‎22.5°‎
  const star = Array.from({ length: 16 }, (_, i) => {
    const a = (Math.PI / 8) * i;
    const rad = i % 2 === 0 ? R : r;
    return `${fix(c + rad * Math.cos(a))},${fix(c + rad * Math.sin(a))}`;
  }).join(' ');

  // المثمّن الداخلي — ورَسْمُه يجعل مركز النجمة عقدةً حقيقية لا فراغًا
  const oct = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i;
    return `${fix(c + inner * Math.cos(a))},${fix(c + inner * Math.sin(a))}`;
  }).join(' ');

  // الأشرطة المحورية: من رأس النجمة إلى رأس جارتها، ومن المثمّن إلى الرأس.
  // بها يصير الخط الأفقي (والرأسي) المارّ بمراكز صفٍّ كامل مرسومًا بلا قطع —
  // وعليه تحديدًا تسير النقاط.
  const straps = [
    `M${fix(c + inner)},${c} H${fix(c + R)}`,
    `M${fix(c - inner)},${c} H${fix(c - R)}`,
    `M${c},${fix(c + inner)} V${fix(c + R)}`,
    `M${c},${fix(c - inner)} V${fix(c - R)}`,
    `M${fix(c + R)},${c} H${S}`,
    `M0,${c} H${fix(c - R)}`,
    `M${c},${fix(c + R)} V${S}`,
    `M${c},0 V${fix(c - R)}`,
  ].join(' ');

  // معيّن على كل ركن — أربعة أرباع تُكمِل بعضها عند التكرار
  const dm = (x, y) => `M${fix(x)},${fix(y - diam)} L${fix(x + diam)},${fix(y)} L${fix(x)},${fix(y + diam)} L${fix(x - diam)},${fix(y)} Z`;
  const diamonds = [dm(0, 0), dm(S, 0), dm(0, S), dm(S, S)].join(' ');

  return `<svg class="khatam" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="khatam" width="${S}" height="${S}" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round">
        <polygon points="${star}"/>
        <polygon points="${oct}"/>
        <path d="${straps}"/>
        <path d="${diamonds}"/>
      </g>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#khatam)"/>
</svg>`;
}

/**
 * قالب الدخول — مستوًى واحد منقوش، والبطاقة عليه كالكوّة المضاءة.
 *
 * لماذا لا عمودان: الانقسام الأبيض/الملوّن هو التخطيط الذي يجعل أي صفحة دخول
 * تُقرأ قالبًا. هنا مستوًى واحد متّصل من الحافة إلى الحافة، والبطاقة في
 * وسطه، والضوء خلفها هو ما يرفعها — لا حدّ ولا عمود ثانٍ.
 *
 * والترتيب مقصود: العلامة، ثم جملة واحدة تقول ما هذا النظام (من يهبط هنا
 * غريبًا يجب أن يفهم في خمس ثوانٍ)، ثم البطاقة، ثم ثلاث حقائق قصيرة لا
 * وعود. لا رقائق مزخرفة ولا جدار بيانات مُدَّعى.
 *
 * @param {'client'|'admin'} variant يعيد توجيه ‎--brand‎ نفسه، فيتلوّن الزرّ
 *   والعلامة وحلقة التركيز والنقش والنقاط بلون البوابة معًا — لا خلفية
 *   مصبوغة فوق واجهة واحدة.
 */
export function authLayout({ title, body, variant = 'client', nonce = '' }) {
  const isAdmin = variant === 'admin';
  const facts = isAdmin
    ? [['كل 5 دقائق', 'دورة فحص'], ['بوابة منفصلة', 'لا تُفتح بحساب عميل'], ['سجل كامل', 'لكل إجراء إداري']]
    : [['كل 5 دقائق', 'نفحص موقعك'], ['6 أشهر', 'مجانية بالكامل'], ['فور التوقّف', 'يصلك إشعار']];

  return `${HEAD(title)}
<body class="is-auth" data-portal="${esc(variant)}">
<div class="auth-bg" aria-hidden="true">
  ${khatam()}
  <canvas class="probes" id="probes"></canvas>
  <span class="auth-veil"></span>
  <span class="auth-glow"></span>
</div>

<main class="auth-stage">
  <a class="auth-mark" href="${isAdmin ? '/admin/login' : '/login'}" aria-label="${esc(APP_NAME)}">${wordmark()}</a>

  <p class="auth-thesis">${isAdmin
    ? 'أدوات تشغيل النظام: عملاؤك ومواقعهم ومحادثاتهم ومستحقّاتهم في شاشة واحدة.'
    : 'نراقب موقعك على مدار الساعة، ونخبرك قبل أن يسألك زبونك.'}</p>

  <div class="auth-card">${body}</div>

  <ul class="auth-facts">
    ${facts.map(([b, t]) => `<li><b>${esc(b)}</b><span>${esc(t)}</span></li>`).join('')}
  </ul>

  <p class="auth-foot">
    ${icon('shield')}
    <span>اتصال مشفّر</span>
    <span aria-hidden="true">·</span>
    <span>الجلسة تنتهي تلقائيًّا</span>
  </p>
</main>
<script src="/auth.js"${nonce ? ` nonce="${esc(nonce)}"` : ''} defer></script>
<script src="/app.js"${nonce ? ` nonce="${esc(nonce)}"` : ''} defer></script>
</body>
</html>`;
}
export { esc, safeUrl, GRADES, PLATFORM_LABELS };

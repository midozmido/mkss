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
};

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

/** «من 3 أيام» — أقرب للفهم من تاريخ مطلق */
export function ago(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'الآن';
  // العربية فيها مثنى وجمع قلة وجمع كثرة — «2 دقيقة» خطأ يلاحظه أي قارئ عربي
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `من ${plural(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `من ${plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const d = Math.floor(h / 24);
  if (d < 30) return `من ${plural(d, 'يوم', 'يومين', 'أيام', 'يوم')}`;
  const mo = Math.floor(d / 30);
  return `من ${plural(mo, 'شهر', 'شهرين', 'شهور', 'شهرًا')}`;
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
  return `<div class="uptime-bar" role="img" aria-label="سجل آخر ${slice.length} فحص">${cells.join('')}</div>`;
}

/** منحنى زمن الاستجابة — SVG مولّد، بلا Chart.js */
export function sparkline(checks, { width = 640, height = 120 } = {}) {
  const pts = checks.filter((c) => c.response_ms != null);
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
    <figcaption class="row-between faint" style="margin-block-start:var(--s-2)">
      <span>الأحدث ←</span>
      <span>المتوسط <b class="num">${avg}ms</b></span>
      <span>→ الأقدم</span>
    </figcaption>
  </figure>`;
}

// ——————————————————— القالب العام ———————————————————

export function layout({ title, user, active = '', body, flash = null, nonce = '' }) {
  const isAdmin = user?.role === 'admin';
  const nav = user
    ? (isAdmin
        ? [['/admin', 'لوحة الأدمن', 'grid'], ['/admin/clients', 'العملاء', 'globe'], ['/admin/requests', 'الطلبات', 'inbox']]
        : [['/', 'مواقعي', 'grid'], ['/invoices', 'الفواتير', 'receipt'], ['/tickets', 'الدعم', 'chat']]
      )
        .map(
          ([href, label, ic]) =>
            `<a href="${href}"${active === href ? ' aria-current="page"' : ''}>${icon(ic)} ${esc(label)}</a>`
        )
        .join('')
    : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — نظام دعم العملاء</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d7a6f'/><text x='16' y='23' font-size='18' font-family='sans-serif' font-weight='bold' fill='white' text-anchor='middle'>م</text></svg>">
</head>
<body>
<a class="skip-link" href="#main">تخطَّ إلى المحتوى</a>
${user ? `<header class="topbar">
  <div class="wrap">
    <a class="brand" href="${isAdmin ? '/admin' : '/'}">
      <span class="brand-mark" aria-hidden="true">م</span>
      <span>مركز المواقع</span>
    </a>
    <nav class="nav grow" aria-label="التنقل الرئيسي">${nav}</nav>
    <div class="row">
      <button class="btn btn-sm" id="theme-toggle" type="button" aria-label="تبديل الوضع الليلي">${icon('moon')}</button>
      <form method="POST" action="/logout" class="row">
        <input type="hidden" name="_csrf" value="${esc(user.csrf || '')}">
        <button class="btn btn-sm" type="submit">${icon('logout')} خروج</button>
      </form>
    </div>
  </div>
</header>` : ''}
<main id="main" class="wrap" style="padding-block:var(--s-5) var(--s-8)">
${flash ? `<div class="alert alert-${esc(flash.kind || 'info')}" role="status">${icon(flash.kind === 'danger' ? 'alert' : 'check')}<div>${esc(flash.text)}</div></div>` : ''}
${body}
</main>
<script src="/app.js"${nonce ? ` nonce="${esc(nonce)}"` : ''} defer></script>
</body>
</html>`;
}

export { esc, safeUrl, GRADES, PLATFORM_LABELS };

// تقييم هيدرات الأمان لموقع العميل — قراءة فقط، بدون أي خدمة خارجية.
// كل هيدر له وزن حسب أثره الحقيقي على أمان زوار الموقع.

const CHECKS = [
  {
    key: 'hsts',
    header: 'strict-transport-security',
    weight: 25,
    label: 'HSTS',
    why: 'يجبر المتصفح على استخدام HTTPS دائمًا ويمنع اعتراض أول زيارة',
    fix: 'أضف: Strict-Transport-Security: max-age=31536000; includeSubDomains',
    httpsOnly: true,
    validate: (v) => {
      const m = /max-age\s*=\s*(\d+)/i.exec(v || '');
      if (!m) return { ok: false, note: 'موجود بدون max-age' };
      const age = Number(m[1]);
      if (age < 15768000) return { ok: true, partial: true, note: `max-age قصير (${age} ثانية)` };
      return { ok: true };
    },
  },
  {
    key: 'csp',
    header: 'content-security-policy',
    weight: 25,
    label: 'CSP',
    why: 'أقوى دفاع ضد حقن السكربتات (XSS)',
    fix: 'أضف سياسة Content-Security-Policy تحدد مصادر السكربتات المسموحة',
    validate: (v) => {
      const s = String(v || '');
      if (/unsafe-inline|unsafe-eval/i.test(s))
        return { ok: true, partial: true, note: 'موجودة لكنها تسمح بـ unsafe-inline أو unsafe-eval' };
      return { ok: true };
    },
  },
  {
    key: 'nosniff',
    header: 'x-content-type-options',
    weight: 15,
    label: 'منع تخمين نوع الملف',
    why: 'يمنع المتصفح من تنفيذ ملف كسكربت بناءً على تخمين نوعه',
    fix: 'أضف: X-Content-Type-Options: nosniff',
    validate: (v) => ({ ok: /nosniff/i.test(v || '') }),
  },
  {
    key: 'frame',
    header: 'x-frame-options',
    weight: 15,
    label: 'منع التأطير',
    why: 'يمنع وضع موقعك داخل إطار في موقع آخر لخداع الزوار (clickjacking)',
    fix: 'أضف: X-Frame-Options: SAMEORIGIN — أو frame-ancestors في الـ CSP',
    // بديل مقبول: frame-ancestors داخل CSP
    altSatisfied: (h) => /frame-ancestors/i.test(String(h['content-security-policy'] || '')),
    validate: (v) => ({ ok: /deny|sameorigin/i.test(v || '') }),
  },
  {
    key: 'referrer',
    header: 'referrer-policy',
    weight: 10,
    label: 'سياسة المُحيل',
    why: 'يمنع تسريب روابط صفحاتك للمواقع الخارجية',
    fix: 'أضف: Referrer-Policy: strict-origin-when-cross-origin',
    validate: (v) => ({ ok: Boolean(v) }),
  },
  {
    key: 'permissions',
    header: 'permissions-policy',
    weight: 10,
    label: 'سياسة الأذونات',
    why: 'يقيّد وصول الصفحة للكاميرا والميكروفون والموقع الجغرافي',
    fix: 'أضف: Permissions-Policy: geolocation=(), microphone=(), camera=()',
    validate: (v) => ({ ok: Boolean(v) }),
  },
];

/** هيدرات تفضح معلومات تساعد المهاجم */
const LEAKS = [
  {
    header: 'x-powered-by',
    label: 'x-powered-by',
    why: 'يكشف التقنية ونسختها، فيسهّل على المهاجم البحث عن ثغرات نسختك بالتحديد',
  },
  {
    header: 'x-aspnet-version',
    label: 'x-aspnet-version',
    why: 'يكشف نسخة ASP.NET بالضبط',
  },
  {
    header: 'x-generator',
    label: 'x-generator',
    why: 'يكشف نظام إدارة المحتوى ونسخته',
  },
];

/**
 * @param {object} headers هيدرات الرد
 * @param {boolean} isHttps هل الموقع على HTTPS
 * @returns {{score:number, present:string[], findings:object[], leaks:object[]}}
 */
export function evaluateHeaders(headers = {}, isHttps = true) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) {
    h[k.toLowerCase()] = Array.isArray(v) ? v.join('; ') : v;
  }

  let earned = 0;
  let possible = 0;
  const present = [];
  const findings = [];

  for (const c of CHECKS) {
    // HSTS بلا معنى على موقع HTTP — لا نحاسبه عليه، بل يُحاسب على غياب HTTPS نفسه
    if (c.httpsOnly && !isHttps) continue;
    possible += c.weight;

    const raw = h[c.header];
    const satisfiedByAlt = !raw && c.altSatisfied && c.altSatisfied(h);

    if (!raw && !satisfiedByAlt) {
      findings.push({
        key: c.key,
        level: c.weight >= 20 ? 'warn' : 'info',
        label: c.label,
        problem: `غير مُفعَّل — ${c.why}`,
        fix: c.fix,
      });
      continue;
    }

    if (satisfiedByAlt) {
      earned += c.weight;
      present.push(c.label);
      continue;
    }

    const v = c.validate ? c.validate(raw) : { ok: true };
    if (v.ok && !v.partial) {
      earned += c.weight;
      present.push(c.label);
    } else if (v.partial) {
      earned += Math.round(c.weight * 0.6);
      present.push(`${c.label} (جزئي)`);
      findings.push({
        key: c.key,
        level: 'info',
        label: c.label,
        problem: v.note || 'مُفعَّل جزئيًا',
        fix: c.fix,
      });
    } else {
      findings.push({
        key: c.key,
        level: 'info',
        label: c.label,
        problem: v.note || 'قيمة غير فعّالة',
        fix: c.fix,
      });
    }
  }

  const leaks = [];
  for (const l of LEAKS) {
    if (h[l.header]) {
      leaks.push({ header: l.label, value: String(h[l.header]).slice(0, 60), why: l.why });
    }
  }
  // Server يحمل رقم نسخة (مثل: Apache/2.4.29) يعتبر تسريبًا
  const server = String(h['server'] || '');
  if (/\d+\.\d+/.test(server)) {
    leaks.push({
      header: 'server',
      value: server.slice(0, 60),
      why: 'يكشف نسخة السيرفر بالضبط، فيسهّل استهدافها بثغرة معروفة',
    });
  }

  if (leaks.length) {
    findings.push({
      key: 'leaks',
      level: 'info',
      label: 'تسريب معلومات السيرفر',
      problem: `السيرفر يعلن عن نفسه في: ${leaks.map((l) => l.header).join('، ')}`,
      fix: 'أخفِ هذه الهيدرات من إعدادات السيرفر — لا تفيد الزائر وتفيد المهاجم',
    });
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  return { score, present, findings, leaks, earned, possible };
}

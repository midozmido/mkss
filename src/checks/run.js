// منسّق الفحص — يشغّل كل الفحوصات ويحسب درجة الصحة النهائية.
// كل نقصان في الدرجة ينتج عنه سبب بالعربي وحل مقترح — لا رقم أحمر مجرد.
import { fetchSite } from './fetch.js';
import { inspectTLS, tlsVerdict } from './tls.js';
import { inspectDNS } from './dns.js';
import { fingerprint } from './fingerprint.js';
import { evaluateHeaders } from './headers.js';

export const WEIGHTS = { uptime: 40, ssl: 20, speed: 15, headers: 15, dns: 10 };

/** أداء الاستجابة → نقاط */
function speedPoints(ms) {
  if (ms == null) return 0;
  if (ms < 400) return 15;
  if (ms < 800) return 12;
  if (ms < 1500) return 9;
  if (ms < 3000) return 5;
  return 2;
}

function uptimePoints(status) {
  if (!status) return 0;
  if (status >= 200 && status < 300) return 40;
  if (status >= 300 && status < 400) return 35;
  if (status >= 400 && status < 500) return 25;
  return 10; // 5xx
}

function sslPoints(tls) {
  if (!tls?.applicable) return 0;           // HTTP بلا تشفير
  if (!tls.valid || !tls.coversHost) return 0;
  if (tls.daysLeft <= 7) return 5;
  if (tls.daysLeft <= 21) return 12;
  return 20;
}

export function grade(score) {
  if (score >= 90) return { key: 'excellent', label: 'ممتاز' };
  if (score >= 75) return { key: 'good', label: 'جيد' };
  if (score >= 60) return { key: 'attention', label: 'يحتاج انتباه' };
  if (score >= 40) return { key: 'problems', label: 'فيه مشاكل' };
  return { key: 'critical', label: 'حرج' };
}

/**
 * يفحص موقعًا واحدًا فحصًا كاملًا.
 * @param {string} url
 * @param {{timeout?:number, allowPrivate?:boolean}} opts
 */
export async function runCheck(url, opts = {}) {
  const at = new Date().toISOString();
  const isHttps = String(url).startsWith('https:');

  // الثلاثة مستقلة — نشغّلها بالتوازي لتقليل زمن الفحص
  const [res, tls, dns] = await Promise.all([
    fetchSite(url, opts),
    isHttps ? inspectTLS(url, opts) : Promise.resolve({ applicable: false, insecureHttp: true }),
    inspectDNS(url, opts),
  ]);

  const reachable = !res.error && res.status != null;
  const fp = reachable ? fingerprint(res) : null;
  const hdr = reachable ? evaluateHeaders(res.headers, isHttps) : null;

  const findings = [];
  const breakdown = { uptime: 0, ssl: 0, speed: 0, headers: 0, dns: 0 };

  // ——— الدومين والـ DNS ———
  if (dns?.ok) {
    breakdown.dns = 10;
  } else {
    breakdown.dns = 0;
    findings.push({
      level: 'critical',
      area: 'dns',
      problem: 'الدومين لا يشير لأي عنوان — الموقع غير موجود على الإنترنت',
      fix: 'راجع سجلات الـ DNS عند مزوّد الدومين، وتأكد أن الدومين لم تنتهِ صلاحيته',
    });
  }

  // ——— التشغيل ———
  if (res.blocked) {
    findings.push({
      level: 'critical',
      area: 'security',
      problem: `رُفض فحص هذا الرابط: ${res.error}`,
      fix: 'هذا الرابط يشير لعنوان داخلي ولا يصح مراقبته. راجع الرابط المسجَّل للموقع.',
    });
  } else if (!reachable) {
    findings.push({
      level: 'critical',
      area: 'uptime',
      problem: `الموقع لا يستجيب: ${res.error}`,
      fix: 'تحقق من السيرفر والاستضافة — الزوار لا يستطيعون فتح الموقع الآن',
    });
  } else {
    breakdown.uptime = uptimePoints(res.status);
    if (res.status >= 500) {
      findings.push({
        level: 'critical',
        area: 'uptime',
        problem: `السيرفر يرد بخطأ ${res.status} — الموقع مفتوح لكنه معطّل`,
        fix: 'راجع سجل أخطاء السيرفر — غالبًا خطأ برمجي أو قاعدة بيانات لا تستجيب',
      });
    } else if (res.status >= 400) {
      findings.push({
        level: 'warn',
        area: 'uptime',
        problem: `السيرفر يرد بكود ${res.status} على الصفحة الرئيسية`,
        fix: 'الصفحة الرئيسية يجب أن ترد بكود 200 — راجع الروابط والصلاحيات',
      });
    }
    if (res.redirects >= 3) {
      findings.push({
        level: 'warn',
        area: 'speed',
        problem: `${res.redirects} تحويلات قبل الوصول للصفحة — كل تحويلة تضيف تأخيرًا`,
        fix: 'اجعل التحويل خطوة واحدة مباشرة للرابط النهائي',
      });
    }
  }

  // ——— SSL ———
  const verdict = tlsVerdict(tls);
  breakdown.ssl = sslPoints(tls);
  if (!isHttps) {
    findings.push({
      level: 'critical',
      area: 'ssl',
      problem: 'الموقع يعمل على HTTP بدون تشفير — بيانات الزوار تنتقل مكشوفة',
      fix: 'ركّب شهادة SSL مجانية (Let’s Encrypt) وحوّل كل الروابط لـ HTTPS',
    });
  } else if (verdict.level === 'critical') {
    findings.push({
      level: 'critical',
      area: 'ssl',
      problem: `شهادة الأمان: ${verdict.label} — ${verdict.note}`,
      fix: 'جدّد الشهادة فورًا — المتصفح يعرض تحذير أمان يمنع الزوار من الدخول',
    });
  } else if (verdict.level === 'warn') {
    findings.push({
      level: 'warn',
      area: 'ssl',
      problem: `شهادة الأمان ${verdict.label}`,
      fix: 'جدّد الشهادة قبل انتهائها — التجديد التلقائي يمنع تكرار المشكلة',
    });
  }

  // ——— السرعة ———
  const responseMs = reachable ? res.totalChain ?? res.total : null;
  breakdown.speed = reachable ? speedPoints(responseMs) : 0;
  if (reachable && responseMs >= 1500) {
    findings.push({
      level: responseMs >= 3000 ? 'critical' : 'warn',
      area: 'speed',
      problem: `الموقع يستغرق ${(responseMs / 1000).toFixed(1)} ثانية للرد`,
      fix: 'فعّل التخزين المؤقت (caching) وحسّن الصور وراجع خطة الاستضافة',
    });
  }

  // ——— هيدرات الأمان ———
  if (hdr) {
    breakdown.headers = Math.round((hdr.score / 100) * WEIGHTS.headers);
    for (const f of hdr.findings) {
      findings.push({
        level: f.level === 'warn' ? 'warn' : 'info',
        area: 'headers',
        problem: `${f.label}: ${f.problem}`,
        fix: f.fix,
      });
    }
  }

  // ——— الدرجة النهائية مع الحالات الحدّية ———
  let score = breakdown.uptime + breakdown.ssl + breakdown.speed + breakdown.headers + breakdown.dns;
  let capped = null;

  if (!dns?.ok) {
    score = 0;
    capped = 'الدومين لا يُحل — لا معنى لباقي الدرجات';
  } else if (!reachable) {
    score = 0;
    capped = 'الموقع لا يفتح — لا معنى لباقي الدرجات';
  } else if (!isHttps && score > 60) {
    score = 60;
    capped = 'موقع بلا تشفير — الدرجة محدودة بـ 60 مهما كان الباقي';
  }

  const g = grade(score);
  const order = { critical: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);

  return {
    at,
    url,
    ok: reachable && res.status < 400,
    blocked: Boolean(res.blocked),
    status: res.status ?? null,
    error: res.error ?? null,
    errorCode: res.errorCode ?? null,
    finalUrl: res.finalUrl ?? null,
    redirects: res.redirects ?? 0,
    ttfbMs: res.ttfb ?? null,
    responseMs,
    bytes: res.bytes ?? null,
    dns,
    tls: { ...tls, verdict },
    fingerprint: fp,
    headers: hdr,
    health: { score, grade: g, breakdown, capped, findings },
  };
}

/** صف مختصر جاهز للحفظ في جدول checks */
export function toCheckRow(siteId, r) {
  return {
    site_id: siteId,
    at: r.at,
    ok: r.ok ? 1 : 0,
    status_code: r.status,
    response_ms: r.responseMs,
    ttfb_ms: r.ttfbMs,
    page_bytes: r.bytes,
    redirects: r.redirects,
    final_url: r.finalUrl,
    error: r.error,
    dns_ok: r.dns?.ok ? 1 : 0,
    dns_ms: r.dns?.ms ?? null,
    ssl_valid: r.tls?.valid ? 1 : 0,
    ssl_days_left: r.tls?.daysLeft ?? null,
    ssl_issuer: r.tls?.issuer ?? null,
    sec_score: r.headers?.score ?? null,
    health_score: r.health.score,
    platform: r.fingerprint?.platform?.key ?? null,
    detail: JSON.stringify({
      platform: r.fingerprint?.platform ?? null,
      addons: r.fingerprint?.addons ?? [],
      extras: r.fingerprint?.extras ?? [],
      findings: r.health.findings,
      capped: r.health.capped,
      breakdown: r.health.breakdown,
    }),
  };
}

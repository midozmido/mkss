// جالب HTTP خام بقياس زمن دقيق — node:http / node:https فقط.
// كل طلب يمر على حارس SSRF أولًا، ويتصل بالـ IP الذي تم التحقق منه مباشرة
// (تثبيت الـ IP) فلا تستطيع إجابة DNS متغيرة أن تحوّلنا لعنوان داخلي بعد الفحص.
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { assertSafeUrl } from './guard.js';

const UA = 'SupportVIP-Monitor/1.0 (+site health checker)';
const MAX_BODY = 512 * 1024; // 512KB — كفاية للبصمة ولا ترهق الذاكرة
const MAX_REDIRECTS = 5;

/** طلب واحد لهدف تم التحقق منه بالفعل، بدون تتبع تحويلات */
function once(urlStr, safe, { timeout = 15000, method = 'GET' } = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const lib = safe.protocol === 'https:' ? https : http;
    const started = process.hrtime.bigint();
    let ttfb = null;
    let settled = false;
    const ms = (t) => Number((t - started) / 1000000n);

    const isDefaultPort =
      (safe.protocol === 'https:' && safe.port === 443) ||
      (safe.protocol === 'http:' && safe.port === 80);

    const req = lib.request(
      {
        protocol: safe.protocol,
        // نتصل بالـ IP المتحقق منه لا بالاسم — هذا ما يمنع DNS rebinding
        host: safe.ip,
        port: safe.port,
        path: url.pathname + url.search,
        method,
        // Host الحقيقي يذهب في الهيدر ليصل للاستضافة المشتركة بشكل صحيح
        setHost: false,
        headers: {
          Host: isDefaultPort ? safe.host : `${safe.host}:${safe.port}`,
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en;q=0.8',
          'Accept-Encoding': 'identity', // بدون ضغط: نقرأ HTML مباشرة للبصمة
          Connection: 'close',
        },
        timeout,
        // SNI باسم الدومين الحقيقي — ضروري للاستضافة المشتركة
        servername: safe.protocol === 'https:' ? safe.host : undefined,
        // الشهادة تُفحص بشكل منفصل في tls.js — هنا لا نريد فشل الطلب كله
        rejectUnauthorized: false,
      },
      (res) => {
        ttfb = ms(process.hrtime.bigint());
        const chunks = [];
        let bytes = 0;
        let truncated = false;

        res.on('data', (c) => {
          bytes += c.length;
          if (!truncated) {
            if (bytes > MAX_BODY) {
              truncated = true;
              chunks.push(c.subarray(0, Math.max(0, MAX_BODY - (bytes - c.length))));
              res.destroy();
            } else {
              chunks.push(c);
            }
          }
        });

        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            bytes,
            truncated,
            ttfb,
            total: ms(process.hrtime.bigint()),
            url: urlStr,
            protocol: safe.protocol,
            host: safe.host,
            ip: safe.ip,
          });
        };

        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      if (settled) return;
      settled = true;
      resolve({
        error: `انتهت المهلة بعد ${timeout / 1000} ثانية`,
        errorCode: 'TIMEOUT',
        total: ms(process.hrtime.bigint()),
        url: urlStr,
      });
    });

    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({
        error: describeError(e),
        errorCode: e.code || 'ERROR',
        total: ms(process.hrtime.bigint()),
        url: urlStr,
      });
    });

    req.end();
  });
}

/** رسائل خطأ بالعربي بدل أكواد Node الخام */
function describeError(e) {
  const map = {
    ENOTFOUND: 'الدومين غير موجود أو الـ DNS مش شغال',
    ECONNREFUSED: 'السيرفر رفض الاتصال',
    ECONNRESET: 'السيرفر قطع الاتصال',
    ETIMEDOUT: 'انتهت مهلة الاتصال بالسيرفر',
    EHOSTUNREACH: 'تعذر الوصول للسيرفر',
    ENETUNREACH: 'الشبكة غير متاحة',
    EAI_AGAIN: 'فشل مؤقت في الـ DNS',
    EPROTO: 'خطأ في بروتوكول TLS',
    CERT_HAS_EXPIRED: 'شهادة SSL منتهية',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'شهادة SSL موقّعة ذاتيًا',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'تعذر التحقق من شهادة SSL',
  };
  return map[e.code] || e.message || 'خطأ غير معروف في الاتصال';
}

/**
 * جلب مع تتبع التحويلات. **كل قفزة** تمر على حارس SSRF من جديد،
 * لأن موقعًا عامًا قد يحوّل لعنوان داخلي.
 */
export async function fetchSite(startUrl, opts = {}) {
  const { allowPrivate = false } = opts;
  let current = startUrl;
  const chain = [];
  let first = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safe = await assertSafeUrl(current, { allowPrivate });
    if (!safe.ok) {
      return {
        error: safe.reason,
        errorCode: safe.code,
        blocked: true,
        url: current,
        chain,
        redirects: chain.length,
        firstResponse: first,
      };
    }

    const res = await once(current, safe, opts);
    if (!first) first = res;
    if (res.error) {
      return { ...res, chain, redirects: chain.length, firstResponse: first };
    }

    const loc = res.headers?.location;
    const isRedirect = res.status >= 300 && res.status < 400 && loc;

    if (!isRedirect) {
      return {
        ...res,
        finalUrl: current,
        chain,
        redirects: chain.length,
        firstResponse: first,
        totalChain: chain.reduce((s, c) => s + (c.total || 0), 0) + (res.total || 0),
      };
    }

    let next;
    try {
      next = new URL(loc, current).toString();
    } catch {
      return { ...res, finalUrl: current, chain, redirects: chain.length, firstResponse: first };
    }
    chain.push({ from: current, to: next, status: res.status, total: res.total });
    if (next === current) break; // حلقة تحويل مفرغة
    current = next;
  }

  return {
    error: 'حلقة تحويلات لا نهائية أو تحويلات كتير جدًا',
    errorCode: 'TOO_MANY_REDIRECTS',
    chain,
    redirects: chain.length,
    firstResponse: first,
  };
}

export { MAX_BODY, MAX_REDIRECTS };

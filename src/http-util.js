// أدوات HTTP — راوتر، كوكيز، قراءة الطلب، تهريب HTML، رؤوس أمان بوابتنا.
// كله من node:http بلا أي إطار.
import { randomBytes } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024; // نماذجنا صغيرة — أي أكبر من هذا مشبوه

/**
 * تهريب HTML — يُطبَّق على **كل** مُخرَج.
 * حرج بشكل خاص لأننا نعرض عناوين وهيدرات مسحوبة من مواقع العملاء،
 * وموقع مخترق قد يحقن سكربتًا في وسم <title> ليعمل داخل لوحتنا.
 */
export function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** تهريب قيمة داخل سمة href — يمنع javascript: و data: */
export function safeUrl(v) {
  const s = String(v || '').trim();
  if (!/^https?:\/\//i.test(s)) return '#';
  return esc(s);
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookieHeader(name, value, { maxAge, expires, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) bits.push('HttpOnly');
  if (secure) bits.push('Secure');
  if (maxAge != null) bits.push(`Max-Age=${Math.floor(maxAge)}`);
  if (expires) bits.push(`Expires=${new Date(expires).toUTCString()}`);
  return bits.join('; ');
}

/** يقرأ جسم الطلب بسقف حجم — يمنع استنزاف الذاكرة */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // إيقاف القراءة لا هدم المقبس: الهدم يقطع الاتصال قبل أي رد، فيرى
        // المستخدم صفحة «تعذّر الاتصال» من المتصفّح بدل رسالة تقول ما جرى.
        // المعالج العام يقرأ e.status ويردّ ٤١٣ نظيفًا.
        req.pause();
        reject(Object.assign(new Error('حجم الطلب كبير جدًا'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function readForm(req) {
  const raw = await readBody(req);
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

/**
 * يأخذ الحقول المسموحة فقط.
 * ضروري: بدونه يستطيع عميل أن يرسل role=admin في نموذج فيرفّع صلاحياته.
 */
export function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f];
  return out;
}

// ——————————————————— رؤوس أمان بوابتنا نحن ———————————————————

export function securityHeaders({ secure = false, nonce } = {}) {
  const csp = [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}`,
    /**
     * ‎'unsafe-inline'‎ للأنماط وحدها — قرار مقصود لا تساهل.
     *
     * ‎style-src 'self'‎ يحجب **سمات** ‎style="…"‎ أيضًا لا عناصر ‎<style>‎ فقط،
     * وكانت النتيجة أن كل قيمة ديناميكية في الواجهة تُسقَط بصمت: مقاس حلقة
     * الصحة، ولون الحالة على الرقم، ومقاس صورة سامي، و**لون المحادثة الذي
     * يختاره العميل**. صفحة الدخول وحدها كانت تفقد ٤٤ سمة.
     *
     * والمخاطرة هنا دنيا: لا يوجد في المشروع عنصر ‎<style>‎ واحد (كل الأنماط
     * في app.css)، وكل مُخرَج يمرّ على esc()، ولون المحادثة يُطابَق بقائمة
     * بيضاء قبل كتابته. أما ‎script-src‎ فيبقى صارمًا بلا ‎unsafe-inline‎ —
     * وهناك تقع الخطورة الحقيقية.
     */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');

  const h = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

export const newNonce = () => randomBytes(16).toString('base64');

// ——————————————————— الردود ———————————————————

export function sendHtml(res, html, { status = 200, headers = {} } = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

export function sendJson(res, data, { status = 200, headers = {} } = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

export function redirect(res, location, { status = 303, headers = {} } = {}) {
  res.writeHead(status, { Location: location, ...headers });
  res.end();
}

// ——————————————————— الراوتر ———————————————————

/**
 * راوتر بسيط: '/site/:id' → يلتقط params.id
 */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const names = [];
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
          .replace(/:(\w+)/g, (_, n) => {
            names.push(n);
            return '([^/]+)';
          }) +
        '/?$'
    );
    routes.push({ method, regex, names, handler });
  }

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
      return null;
    },
  };
}

/** تحديد معدل عام في الذاكرة — للنماذج الحساسة */
export function createRateLimiter({ windowMs = 15 * 60_000, max = 20, capacity = 20_000 } = {}) {
  const hits = new Map();
  let lastSweep = Date.now();

  /**
   * تقليم المنتهي.
   * بدونه ينمو الجدول بلا حدّ: مفتاح الدخول هو `ip|email`، ومن يجرّب ألف
   * بريد من ألف عنوان يترك مليون سجل لا يُحذف أبدًا — والذاكرة على استضافة
   * مشتركة ليست بلا قاع. السجل المنتهي لا يُستبدل إلا إن عاد صاحبه.
   */
  function sweep(now) {
    for (const [k, rec] of hits) if (now - rec.first > windowMs) hits.delete(k);
    lastSweep = now;
  }

  return {
    check(key) {
      const now = Date.now();
      // كنسة كل نافذة، أو فورًا إن بلغنا السقف (هجوم يملأ أسرع من الوقت)
      if (now - lastSweep > windowMs || hits.size >= capacity) sweep(now);
      // ما زال ممتلئًا بعد الكنس: كله حديث وحقيقي. نرفض الجديد بدل أن
      // نستهلك ذاكرة بلا حدّ — ومن له سجل قائم يُخدم كالمعتاد.
      if (hits.size >= capacity && !hits.has(key)) return { allowed: false, remaining: 0, saturated: true };

      const rec = hits.get(key);
      if (!rec || now - rec.first > windowMs) {
        hits.set(key, { first: now, count: 1 });
        return { allowed: true, remaining: max - 1 };
      }
      rec.count++;
      return { allowed: rec.count <= max, remaining: Math.max(0, max - rec.count) };
    },
    reset: (key) => hits.delete(key),
    size: () => hits.size,
  };
}

/** عنوان العميل الحقيقي خلف بروكسي موثوق فقط */
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export { MAX_BODY_BYTES };

// حارس SSRF — يمنع سيرفرنا من جلب عناوين داخلية.
// السيناريو المحمي منه: الأدمن (أو مهاجم) يدخل رابطًا يشير لشبكة داخلية أو لعنوان
// بيانات اعتماد السحابة (169.254.169.254)، فيجلبه سيرفرنا ويعرض محتواه في اللوحة.
//
// مبدآن أساسيان:
//   1) الفحص على الـ IP **المحلول** لا على النص — لأن دومينًا عامًا قد يشير لـ 127.0.0.1
//   2) إعادة الفحص **بعد كل تحويلة** — لأن موقعًا عامًا قد يحوّل لعنوان داخلي
//
// ولمنع DNS rebinding نُرجع الـ IP الذي تحققنا منه، ويتصل به الجالب مباشرة
// مع ضبط Host و servername — فلا فرصة لتغيير الإجابة بين التحقق والاتصال.

import { promises as dnsp } from 'node:dns';
import { isIP } from 'node:net';
import { URL } from 'node:url';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set([80, 443]);

/** نطاقات IPv4 محظورة: [أول بايت مطابق..], بادئة بالبِتّات */
const BLOCKED_V4 = [
  ['0.0.0.0', 8, 'هذه الشبكة'],
  ['10.0.0.0', 8, 'شبكة خاصة'],
  ['100.64.0.0', 10, 'شبكة مزوّد مشتركة (CGNAT)'],
  ['127.0.0.0', 8, 'الجهاز نفسه (loopback)'],
  ['169.254.0.0', 16, 'عنوان محلي — يشمل بيانات اعتماد السحابة'],
  ['172.16.0.0', 12, 'شبكة خاصة'],
  ['192.0.0.0', 24, 'محجوز بروتوكوليًا'],
  ['192.0.2.0', 24, 'شبكة اختبار'],
  ['192.168.0.0', 16, 'شبكة خاصة'],
  ['198.18.0.0', 15, 'شبكة قياس أداء'],
  ['198.51.100.0', 24, 'شبكة اختبار'],
  ['203.0.113.0', 24, 'شبكة اختبار'],
  ['224.0.0.0', 4, 'بث متعدد (multicast)'],
  ['240.0.0.0', 4, 'محجوز'],
];

function v4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function v4Blocked(ip) {
  const n = v4ToInt(ip);
  if (n === null) return 'عنوان IPv4 غير صالح';
  for (const [base, bits, why] of BLOCKED_V4) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) === (v4ToInt(base) & mask)) return why;
  }
  if (n === 0xffffffff) return 'عنوان بث عام';
  return null;
}

/** يفك IPv6 لمصفوفة 16 بايت */
function v6ToBytes(ip) {
  let s = ip.split('%')[0]; // يشيل معرّف الواجهة (fe80::1%eth0)
  let embeddedV4 = null;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const n = v4ToInt(tail);
    if (n === null) return null;
    embeddedV4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    s = s.slice(0, lastColon + 1) + '0:0';
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tailGroups = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const fill = 8 - head.length - tailGroups.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;

  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;

  const bytes = [];
  for (const g of groups) {
    const v = parseInt(g, 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.push((v >> 8) & 255, v & 255);
  }
  if (embeddedV4) {
    bytes[12] = embeddedV4[0];
    bytes[13] = embeddedV4[1];
    bytes[14] = embeddedV4[2];
    bytes[15] = embeddedV4[3];
  }
  return bytes;
}

function v6Blocked(ip) {
  const b = v6ToBytes(ip);
  if (!b) return 'عنوان IPv6 غير صالح';

  const isZero = b.every((x) => x === 0);
  if (isZero) return 'عنوان غير محدد';
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return 'الجهاز نفسه (loopback)';

  // ::ffff:a.b.c.d — عنوان IPv4 مغلّف: نفحصه كـ IPv4
  const isMappedV4 = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  // 64:ff9b::/96 — NAT64
  const isNat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b;
  if (isMappedV4 || isNat64) {
    const v4 = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    return v4Blocked(v4) || null;
  }

  // 2002::/16 — 6to4، الـ IPv4 مضمّن في البايتات 2..5
  if (b[0] === 0x20 && b[1] === 0x02) {
    const v4 = `${b[2]}.${b[3]}.${b[4]}.${b[5]}`;
    const why = v4Blocked(v4);
    if (why) return `6to4 يغلّف ${why}`;
  }

  if ((b[0] & 0xfe) === 0xfc) return 'شبكة خاصة (ULA)';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'عنوان محلي بالوصلة';
  if (b[0] === 0xff) return 'بث متعدد (multicast)';
  return null;
}

/** هل هذا الـ IP محظور؟ يرجع سبب الحظر بالعربي، أو null لو مسموح */
export function ipBlockReason(ip) {
  const kind = isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind === 6) return v6Blocked(ip);
  return 'ليس عنوان IP صالحًا';
}

/**
 * يتحقق من رابط قبل جلبه.
 * @returns {Promise<{ok:true, host:string, port:number, protocol:string, ip:string, family:number}
 *                  | {ok:false, reason:string, code:string}>}
 */
export async function assertSafeUrl(urlStr, { allowPrivate = false, timeout = 5000 } = {}) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, code: 'BAD_URL', reason: 'رابط غير صالح' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      code: 'BAD_PROTOCOL',
      reason: `بروتوكول ممنوع: ${url.protocol.replace(':', '')} — مسموح http و https فقط`,
    };
  }

  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  // allowPrivate هو وضع الاختبار المحلي فقط، وفيه يُسمح بمنفذ عشوائي لسيرفر التجهيزات
  if (!allowPrivate && !ALLOWED_PORTS.has(port)) {
    return { ok: false, code: 'BAD_PORT', reason: `منفذ ممنوع: ${port} — مسموح 80 و 443 فقط` };
  }

  if (url.username || url.password) {
    return { ok: false, code: 'HAS_CREDENTIALS', reason: 'الرابط يحتوي بيانات دخول — ممنوع' };
  }

  const host = url.hostname.replace(/^\[|\]$/g, ''); // يشيل أقواس IPv6

  // وضع الاختبار المحلي: يسمح بالـ loopback فقط (127.0.0.1 و ::1) ولا شيء غيره.
  // متعمَّد أن يظل يحظر 169.254.169.254 و 10.x وغيرها، حتى تبقى اختبارات
  // "تحويل لعنوان داخلي" اختبارات حقيقية لا مسرحية.
  if (allowPrivate) {
    const ip = isIP(host) ? host : (await resolveFirst(host, timeout))?.address;
    if (!ip) return { ok: false, code: 'DNS_FAIL', reason: 'تعذر تحليل الدومين' };
    const why = ipBlockReason(ip);
    if (why && !isLoopback(ip)) {
      return { ok: false, code: 'BLOCKED_IP', reason: `عنوان محظور (${why})` };
    }
    return { ok: true, host, port, protocol: url.protocol, ip, family: isIP(ip) };
  }

  // لو المضيف عنوان IP مباشر، نفحصه بدون DNS
  if (isIP(host)) {
    const why = ipBlockReason(host);
    if (why) return { ok: false, code: 'BLOCKED_IP', reason: `عنوان محظور (${why})` };
    return { ok: true, host, port, protocol: url.protocol, ip: host, family: isIP(host) };
  }

  if (!/^[a-z0-9.-]+$/i.test(host) || host.length > 253) {
    return { ok: false, code: 'BAD_HOST', reason: 'اسم مضيف غير صالح' };
  }

  let addrs;
  try {
    addrs = await Promise.race([
      dnsp.lookup(host, { all: true, verbatim: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
  } catch {
    return { ok: false, code: 'DNS_FAIL', reason: 'تعذر تحليل الدومين' };
  }

  if (!addrs?.length) return { ok: false, code: 'DNS_FAIL', reason: 'الدومين لا يشير لأي عنوان' };

  // صرامة: لو **أي** عنوان من عناوين الدومين محظور، نرفض الرابط كله.
  // السبب: DNS يمكن أن يرجّح عنوانًا مختلفًا في الاتصال التالي.
  for (const a of addrs) {
    const why = ipBlockReason(a.address);
    if (why) {
      return {
        ok: false,
        code: 'BLOCKED_RESOLVED',
        reason: `الدومين يشير لعنوان داخلي ${a.address} (${why})`,
      };
    }
  }

  const chosen = addrs[0];
  return { ok: true, host, port, protocol: url.protocol, ip: chosen.address, family: chosen.family };
}

function isLoopback(ip) {
  if (isIP(ip) === 4) return ip.startsWith('127.');
  const b = v6ToBytes(ip);
  if (!b) return false;
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  return mapped && b[12] === 127;
}

async function resolveFirst(host, timeout) {
  try {
    return await Promise.race([
      dnsp.lookup(host, { verbatim: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
  } catch {
    return null;
  }
}

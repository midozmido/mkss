// المصادقة — scrypt + جلسات موقّعة، كله من node:crypto
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { all, get, run, nowISO, setting } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 14;
export const COOKIE_NAME = 'mkss_sid';

/** سر التوقيع: يتولد مرة واحدة ويتخزن — أو يجي من البيئة */
export function signingSecret() {
  if (process.env.MKSS_SECRET) return process.env.MKSS_SECRET;
  let s = setting('signing_secret');
  if (!s) s = setting('signing_secret', randomBytes(32).toString('hex'));
  return s;
}

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(plain, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  }).toString('hex');
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [scheme, N, r, p, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(key, 'hex');
    const actual = scryptSync(plain, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ——— الجلسات ———
export function createSession(userId, { ip, ua } = {}) {
  const id = randomBytes(32).toString('hex');
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  run(
    'INSERT INTO sessions(id, user_id, created_at, expires_at, ip, ua) VALUES(?,?,?,?,?,?)',
    id,
    userId,
    now.toISOString(),
    exp.toISOString(),
    ip || null,
    (ua || '').slice(0, 250)
  );
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now.toISOString(), userId);
  return { id, expires: exp };
}

export function sessionUser(sid) {
  if (!sid) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
    sid,
    nowISO()
  );
  return row || null;
}

export function destroySession(sid) {
  if (sid) run('DELETE FROM sessions WHERE id = ?', sid);
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', nowISO());
}

// ——— حماية CSRF: توكن مشتق من الجلسة ———
export function csrfToken(sid) {
  return createHmac('sha256', signingSecret()).update(`csrf:${sid}`).digest('hex').slice(0, 32);
}

export function csrfOk(sid, token) {
  if (!sid || !token) return false;
  const expected = Buffer.from(csrfToken(sid));
  const given = Buffer.from(String(token));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ——— تحديد محاولات الدخول (في الذاكرة) ———
const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

export function loginBlocked(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

export function noteLoginFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
  } else {
    rec.count++;
  }
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}

export function findUserByEmail(email) {
  return get('SELECT * FROM users WHERE lower(email) = lower(?)', String(email).trim());
}

export function listSessions(userId) {
  return all('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC', userId);
}

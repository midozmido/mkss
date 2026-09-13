// الشات المباشر بين العميل ولوحة الأدمن.
//
// التقنية: Server-Sent Events — بروتوكول HTTP عادي (نص مع text/event-stream).
// لا يحتاج أي مكتبة، ويعيد الاتصال تلقائيًا من جانب المتصفح، ويمر عبر nginx
// بإعداد واحد. WebSocket كان سيتطلب مكتبة خارجية — وهذا مرفوض هنا.
import { all, get, run, nowISO } from './db.js';

const MAX_BODY = 4000;

// ——————————————————— ناقل الأحداث داخل العملية ———————————————————
// Map: مفتاح القناة → مجموعة الردود المفتوحة.
// قناة العميل = `u:<id>` · قناة الأدمن = `admin`
const channels = new Map();

export function subscribe(channel, res) {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(res);
  return () => {
    const set = channels.get(channel);
    if (!set) return;
    set.delete(res);
    if (!set.size) channels.delete(channel);
  };
}

export function publish(channel, event, data) {
  const set = channels.get(channel);
  if (!set) return 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of set) {
    try {
      res.write(payload);
      sent++;
    } catch {
      set.delete(res); // اتصال مات — ننظّفه بدل أن نتراكم
    }
  }
  return sent;
}

export const listenerCount = (channel) => channels.get(channel)?.size || 0;

// ——————————————————— الرسائل ———————————————————

export function sendMessage(userId, { body, role, authorId = null }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('الرسالة فارغة');
  if (text.length > MAX_BODY) throw new Error('الرسالة طويلة جدًا');
  if (!['client', 'admin', 'system'].includes(role)) throw new Error('دور غير معروف');

  const at = nowISO();
  const r = run(
    `INSERT INTO chat_messages(user_id, author_role, author_id, body, created_at, read_by_admin, read_by_client)
     VALUES(?,?,?,?,?,?,?)`,
    userId, role, authorId, text, at,
    role === 'admin' || role === 'system' ? 1 : 0,
    role === 'client' ? 1 : 0
  );
  const msg = get('SELECT * FROM chat_messages WHERE id = ?', Number(r.lastInsertRowid));

  // البثّ فورًا للطرفين: رسالة العميل تصل لوحة الأدمن في نفس اللحظة
  publish(`u:${userId}`, 'message', msg);
  publish('admin', 'message', { ...msg, client_name: get('SELECT name FROM users WHERE id = ?', userId)?.name });
  return msg;
}

export function history(userId, limit = 100) {
  return all(
    'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    userId,
    Math.min(Number(limit) || 100, 300)
  ).reverse();
}

export function since(userId, afterId) {
  return all(
    'SELECT * FROM chat_messages WHERE user_id = ? AND id > ? ORDER BY id LIMIT 200',
    userId,
    Number(afterId) || 0
  );
}

export function markRead(userId, by) {
  const col = by === 'admin' ? 'read_by_admin' : 'read_by_client';
  run(`UPDATE chat_messages SET ${col} = 1 WHERE user_id = ? AND ${col} = 0`, userId);
}

export const unreadForClient = (userId) =>
  get('SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND read_by_client = 0', userId)?.n || 0;

export const unreadForAdmin = () =>
  get('SELECT COUNT(*) AS n FROM chat_messages WHERE read_by_admin = 0')?.n || 0;

/** قائمة محادثات الأدمن — غير المقروء أولًا ثم الأحدث */
export function adminThreads() {
  return all(
    `SELECT u.id AS user_id, u.name, u.email, u.company,
            (SELECT body       FROM chat_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM chat_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_at,
            (SELECT author_role FROM chat_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_role,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.user_id = u.id AND m.read_by_admin = 0) AS unread
       FROM users u
      WHERE u.role = 'client'
        AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.user_id = u.id)
      ORDER BY unread DESC, last_at DESC`
  );
}

/** ترويسة SSE + نبضة تمنع الوسطاء من قطع الاتصال الصامت */
export function openStream(res, channel, { onClose } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // يمنع nginx من تخزين البث مؤقتًا
  });
  res.write('retry: 3000\n\n');

  const unsubscribe = subscribe(channel, res);
  const beat = setInterval(() => {
    try {
      res.write(': نبضة\n\n');
    } catch {
      cleanup();
    }
  }, 25_000);

  let done = false;
  function cleanup() {
    if (done) return;
    done = true;
    clearInterval(beat);
    unsubscribe();
    onClose?.();
    try { res.end(); } catch {}
  }
  res.on('close', cleanup);
  res.on('error', cleanup);
  return cleanup;
}

export { MAX_BODY };

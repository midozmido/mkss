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

export function sendMessage(userId, { body, role, authorId = null, channel = 'live', visibility = 'all', meta = null }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('الرسالة فارغة');
  if (text.length > MAX_BODY) throw new Error('الرسالة طويلة جدًا');
  if (!['client', 'admin', 'system', 'bot'].includes(role)) throw new Error('دور غير معروف');
  if (!['bot', 'live'].includes(channel)) throw new Error('قناة غير معروفة');
  if (!['all', 'internal'].includes(visibility)) throw new Error('رؤية غير معروفة');

  const at = nowISO();
  // رد البوت لا يُحسب غير مقروء عند الأدمن — وإلا امتلأت لوحته بضجيج آلي.
  // ورسالة العميل تبقى غير مقروءة حتى لو ردّ عليها البوت، لأنها قد تحتاجك.
  const r = run(
    `INSERT INTO chat_messages(user_id, author_role, author_id, body, created_at,
                               read_by_admin, read_by_client, channel, visibility, meta)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    userId, role, authorId, text, at,
    role === 'client' ? 0 : 1,
    role === 'client' || visibility === 'internal' ? 1 : 0,
    channel, visibility, meta ? JSON.stringify(meta) : null
  );
  const msg = get('SELECT * FROM chat_messages WHERE id = ?', Number(r.lastInsertRowid));

  // البثّ فورًا: رسالة العميل تصل لوحة الأدمن في نفس اللحظة.
  // الرسائل الداخلية لا تُبثّ لقناة العميل إطلاقًا.
  if (visibility !== 'internal') publish(`u:${userId}`, 'message', msg);
  publish('admin', 'message', { ...msg, client_name: get('SELECT name FROM users WHERE id = ?', userId)?.name });
  return msg;
}

/**
 * @param {'client'|'admin'} viewer — العميل لا يرى الرسائل الداخلية أبدًا.
 * الفلترة هنا لا في الواجهة: نسيانها في قالب واحد يسرّب ملاحظات الفريق.
 */
export function history(userId, limit = 100, viewer = 'admin') {
  const rows = all(
    `SELECT * FROM chat_messages
      WHERE user_id = ? ${viewer === 'client' ? "AND visibility = 'all'" : ''}
      ORDER BY id DESC LIMIT ?`,
    userId,
    Math.min(Number(limit) || 100, 300)
  );
  return rows.reverse();
}

export function since(userId, afterId, viewer = 'admin') {
  return all(
    `SELECT * FROM chat_messages
      WHERE user_id = ? AND id > ? ${viewer === 'client' ? "AND visibility = 'all'" : ''}
      ORDER BY id LIMIT 200`,
    userId,
    Number(afterId) || 0
  );
}

export function markRead(userId, by) {
  const col = by === 'admin' ? 'read_by_admin' : 'read_by_client';
  run(`UPDATE chat_messages SET ${col} = 1 WHERE user_id = ? AND ${col} = 0`, userId);
}

export const unreadForClient = (userId) =>
  get(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND read_by_client = 0 AND visibility = 'all'",
    userId
  )?.n || 0;

export const unreadForAdmin = () =>
  get('SELECT COUNT(*) AS n FROM chat_messages WHERE read_by_admin = 0')?.n || 0;

/** غير المقروء لمحادثة عميل بعينه — العدّاد العام لا يصلح للقياس لكل محادثة */
export const unreadForAdminIn = (userId) =>
  get('SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND read_by_admin = 0', userId)?.n || 0;

/** قائمة محادثات الأدمن — غير المقروء أولًا ثم الأحدث */
export function adminThreads() {
  return all(
    `SELECT u.id AS user_id, u.name, u.email, u.company,
            (SELECT body       FROM chat_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM chat_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_at,
            (SELECT author_role FROM chat_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_role,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.user_id = u.id AND m.read_by_admin = 0) AS unread,
            u.support_mode, u.escalated_at, u.snooze_until
       FROM users u
      WHERE u.role = 'client'
        AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.user_id = u.id)
      -- المؤجَّلة تنزل لأسفل حتى ينتهي أجلها: هذا هو معنى التأجيل،
      -- وإبقاؤها في الأعلى يجعل الزر بلا أثر.
      ORDER BY (CASE WHEN u.snooze_until > ? THEN 1 ELSE 0 END) ASC,
               unread DESC, last_at DESC`,
    nowISO()
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

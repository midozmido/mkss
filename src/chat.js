// المحادثات — محادثات متعددة لكل عميل، بأرشيف، وبثّ لحظي.
//
// التقنية: Server-Sent Events — بروتوكول HTTP عادي، لا يحتاج أي مكتبة،
// ويعيد الاتصال تلقائيًا من جانب المتصفح.
import { all, get, run, nowISO } from './db.js';
import { OwnershipError } from './repo.js';

const MAX_BODY = 4000;

// ——————————————————— ناقل الأحداث ———————————————————
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
    try { res.write(payload); sent++; } catch { set.delete(res); }
  }
  return sent;
}

export const listenerCount = (channel) => channels.get(channel)?.size || 0;

// ——————————————————— المحادثات ———————————————————

/** عنوان مشتق من أول رسالة — يجعل الأرشيف قابلًا للتصفّح */
function titleFrom(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 60) + (t.length > 60 ? '…' : '') : 'محادثة جديدة';
}

export function openConversation(userId, { title = null } = {}) {
  const at = nowISO();
  const r = run(
    'INSERT INTO conversations(user_id, title, status, mode, created_at, last_at) VALUES(?,?,?,?,?,?)',
    userId, title, 'open', 'bot', at, at
  );
  const conv = get('SELECT * FROM conversations WHERE id = ?', Number(r.lastInsertRowid));
  publish('admin', 'conversation', conv);
  return conv;
}

/** المحادثة المفتوحة حاليًا، أو null — لا نُنشئ تلقائيًا حتى لا تمتلئ القوائم بمحادثات فارغة */
export const currentConversation = (userId) =>
  get("SELECT * FROM conversations WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", userId) || null;

/** المفتوحة، وإن لم توجد فواحدة جديدة */
export const ensureConversation = (userId) => currentConversation(userId) || openConversation(userId);

/**
 * محادثة جديدة للعميل — إلا إن كانت لديه واحدة مفتوحة **لم يكتب فيها بعد**،
 * فنعيدها بدل أن تتراكم في سجله بطاقات «محادثة جديدة» فارغة بلا محتوى.
 * الشرط «فارغة» لا «مفتوحة»: من أغلق محادثته يحصل على جديدة نظيفة دائمًا،
 * ومن له محادثة فيها كلام يحصل على جديدة أيضًا — وهذا ما طلبه العميل.
 */
export function startConversation(userId) {
  const blank = get(
    `SELECT c.* FROM conversations c
      WHERE c.user_id = ? AND c.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id)
      ORDER BY c.id DESC LIMIT 1`,
    userId
  );
  return blank || openConversation(userId);
}

export const listConversations = (userId, limit = 30) =>
  all(
    `SELECT c.*,
            (SELECT body FROM chat_messages m
              WHERE m.conversation_id = c.id AND m.visibility = 'all' ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT author_role FROM chat_messages m
              WHERE m.conversation_id = c.id AND m.visibility = 'all' ORDER BY m.id DESC LIMIT 1) AS last_role,
            (SELECT COUNT(*) FROM chat_messages m
              WHERE m.conversation_id = c.id AND m.read_by_client = 0 AND m.visibility = 'all') AS unread
       FROM conversations c
      WHERE c.user_id = ?
      ORDER BY (c.status = 'open') DESC, c.last_at DESC
      LIMIT ?`,
    userId, Math.min(Number(limit) || 30, 100)
  );

/** قراءة محادثة مع فحص الملكية — العميل لا يفتح محادثة غيره */
export function getConversation(userId, conversationId) {
  const c = get('SELECT * FROM conversations WHERE id = ? AND user_id = ?', conversationId, userId);
  // نستخدم خطأ الملكية نفسه المستعمل في repo.js حتى يرد الخادم 404 لا 500،
  // فلا يفرّق المهاجم بين «غير موجودة» و«ليست لك».
  if (!c) throw new OwnershipError('محادثة', conversationId);
  return c;
}

export const adminGetConversation = (id) => get('SELECT * FROM conversations WHERE id = ?', id);

export function closeConversation(conversationId, by = 'client') {
  const c = get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!c || c.status === 'closed') return { already: true, conversation: c };
  run(
    "UPDATE conversations SET status = 'closed', mode = 'bot', escalated_at = NULL, closed_at = ?, closed_by = ? WHERE id = ?",
    nowISO(), by, conversationId
  );
  run('UPDATE escalations SET closed_at = ? WHERE conversation_id = ? AND closed_at IS NULL', nowISO(), conversationId);
  const after = get('SELECT * FROM conversations WHERE id = ?', conversationId);
  publish(`u:${c.user_id}`, 'conversation', after);
  publish('admin', 'conversation', after);
  return { already: false, conversation: after };
}

export const isLive = (conversationId) =>
  get('SELECT mode FROM conversations WHERE id = ?', conversationId)?.mode === 'live';

export const setMode = (conversationId, mode) =>
  run('UPDATE conversations SET mode = ?, escalated_at = ? WHERE id = ?',
    mode, mode === 'live' ? nowISO() : null, conversationId);

export const bumpFailStreak = (conversationId, reset = false) =>
  run(
    reset
      ? 'UPDATE conversations SET fail_streak = 0 WHERE id = ?'
      : 'UPDATE conversations SET fail_streak = fail_streak + 1 WHERE id = ?',
    conversationId
  );

export const failStreak = (conversationId) =>
  get('SELECT fail_streak FROM conversations WHERE id = ?', conversationId)?.fail_streak || 0;

// ——————————————————— الرسائل ———————————————————

export function sendMessage(conversationId, { body, role, authorId = null, channel = 'live', visibility = 'all', meta = null, alertAdmin = false }) {
  const conv = get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv) throw new Error('المحادثة غير موجودة');

  const text = String(body || '').trim();
  if (!text) throw new Error('الرسالة فارغة');
  if (text.length > MAX_BODY) throw new Error('الرسالة طويلة جدًا');
  if (!['client', 'admin', 'system', 'bot'].includes(role)) throw new Error('دور غير معروف');
  if (!['bot', 'live'].includes(channel)) throw new Error('قناة غير معروفة');
  if (!['all', 'internal'].includes(visibility)) throw new Error('رؤية غير معروفة');

  const at = nowISO();
  // رد المساعد لا يُحسب غير مقروء عند الأدمن وإلا امتلأت لوحته بضجيج آلي.
  //
  // لكن ليس كل رسالة غير بشرية ضجيجًا: إشعار تحويل فعلٌ ينتظر مراجعة، وكان
  // يهبط مقروءًا لأنه ليس من «عميل» — فلا يرتفع عدّاد ولا ينبّه شيء، ويكتشفه
  // الأدمن حين يفتح المحادثة مصادفةً. ‎alertAdmin‎ تفصل «آلي» عن «لا يستحق
  // انتباهًا»، ولا يمرّرها إلا من يعرف أن رسالته تستحقّه.
  const r = run(
    `INSERT INTO chat_messages(conversation_id, user_id, author_role, author_id, body, created_at,
                               read_by_admin, read_by_client, channel, visibility, meta)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    conversationId, conv.user_id, role, authorId, text, at,
    role === 'client' || alertAdmin ? 0 : 1,
    role === 'client' || visibility === 'internal' ? 1 : 0,
    channel, visibility, meta ? JSON.stringify(meta) : null
  );
  const msg = get('SELECT * FROM chat_messages WHERE id = ?', Number(r.lastInsertRowid));

  // أول رسالة من العميل تصير عنوان المحادثة في الأرشيف
  const patch = role === 'client' && !conv.title
    ? run('UPDATE conversations SET last_at = ?, title = ? WHERE id = ?', at, titleFrom(text), conversationId)
    : run('UPDATE conversations SET last_at = ? WHERE id = ?', at, conversationId);
  void patch;

  if (visibility !== 'internal') publish(`u:${conv.user_id}`, 'message', msg);
  publish('admin', 'message', {
    ...msg,
    client_name: get('SELECT name FROM users WHERE id = ?', conv.user_id)?.name,
  });
  return msg;
}

/**
 * إرسال رسالة إلى **عميل** لا إلى محادثة بعينها.
 *
 * وجودها مقصود: المسارات التي تعرف العميل فقط (تأكيد دفعة، رفض إشعار) كانت
 * تمرّر userId مكان conversationId، فتهبط الرسالة في محادثة رقمها يصادف
 * رقم العميل — أي في محادثة عميل آخر. النوعان عددان، فلا شيء يشتكي.
 * هذه الدالة تُغلق الباب: من يعرف العميل يستدعيها، ولا يترجم بنفسه.
 */
export const notify = (userId, fields) => sendMessage(ensureConversation(userId).id, fields);

/** @param {'client'|'admin'} viewer — العميل لا يرى الملاحظات الداخلية أبدًا */
export function history(conversationId, limit = 100, viewer = 'admin') {
  return all(
    `SELECT * FROM chat_messages
      WHERE conversation_id = ? ${viewer === 'client' ? "AND visibility = 'all'" : ''}
      ORDER BY id DESC LIMIT ?`,
    conversationId, Math.min(Number(limit) || 100, 300)
  ).reverse();
}

export function since(conversationId, afterId, viewer = 'admin') {
  return all(
    `SELECT * FROM chat_messages
      WHERE conversation_id = ? AND id > ? ${viewer === 'client' ? "AND visibility = 'all'" : ''}
      ORDER BY id LIMIT 200`,
    conversationId, Number(afterId) || 0
  );
}

export function markRead(conversationId, by) {
  const col = by === 'admin' ? 'read_by_admin' : 'read_by_client';
  run(`UPDATE chat_messages SET ${col} = 1 WHERE conversation_id = ? AND ${col} = 0`, conversationId);
}

export const unreadForClient = (userId) =>
  get(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND read_by_client = 0 AND visibility = 'all'",
    userId
  )?.n || 0;

export const unreadForAdmin = () =>
  get('SELECT COUNT(*) AS n FROM chat_messages WHERE read_by_admin = 0')?.n || 0;

export const unreadForAdminIn = (conversationId) =>
  get('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND read_by_admin = 0', conversationId)?.n || 0;

/** قائمة محادثات الأدمن عبر كل العملاء */
export function adminThreads() {
  return all(
    `SELECT c.id AS conversation_id, c.user_id, c.title, c.status, c.mode, c.escalated_at,
            c.last_at, u.name, u.email, u.company, u.snooze_until,
            (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT author_role FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.read_by_admin = 0) AS unread
       FROM conversations c
       JOIN users u ON u.id = c.user_id
      WHERE EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id)
      -- المؤجَّلة تنزل لأسفل، والمفتوحة قبل المغلقة، وغير المقروء أولًا
      ORDER BY (CASE WHEN u.snooze_until > ? THEN 1 ELSE 0 END) ASC,
               (CASE WHEN c.status = 'open' THEN 0 ELSE 1 END) ASC,
               unread DESC, c.last_at DESC
      LIMIT 100`,
    nowISO()
  );
}

/** ترويسة SSE + نبضة تمنع الوسطاء من قطع الاتصال الصامت */
export function openStream(res, channel, { onClose } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const unsubscribe = subscribe(channel, res);
  const beat = setInterval(() => {
    try { res.write(': نبضة\n\n'); } catch { cleanup(); }
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

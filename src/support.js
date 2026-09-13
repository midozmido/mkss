// الطبقة الاحترافية للدعم: ردود محفوظة · تقييم رضا · تأجيل · بحث · رسائل استباقية.
import { all, get, run, nowISO } from './db.js';
import * as chat from './chat.js';
import { normalize, tokens } from './kb.js';

// ——————————————————— الردود المحفوظة ———————————————————

export const listReplies = () =>
  all('SELECT * FROM canned_replies ORDER BY uses DESC, title LIMIT 50');

export function saveReply({ id, title, body, shortcut }) {
  if (!String(title || '').trim() || !String(body || '').trim()) throw new Error('العنوان والنص مطلوبان');
  if (id) {
    run('UPDATE canned_replies SET title = ?, body = ?, shortcut = ? WHERE id = ?',
      String(title).slice(0, 120), String(body).slice(0, 4000), shortcut || null, id);
    return id;
  }
  const r = run('INSERT INTO canned_replies(title, body, shortcut, created_at) VALUES(?,?,?,?)',
    String(title).slice(0, 120), String(body).slice(0, 4000), shortcut || null, nowISO());
  return Number(r.lastInsertRowid);
}

export const deleteReply = (id) => run('DELETE FROM canned_replies WHERE id = ?', id);
export const noteReplyUse = (id) => run('UPDATE canned_replies SET uses = uses + 1 WHERE id = ?', id);

// ——————————————————— تقييم الرضا ———————————————————

/** يُسأل العميل بعد إغلاق المحادثة — وهذا التوقيت مقصود: التقييم أثناءها يقاطع */
export function askForRating(userId) {
  const esc = get(
    `SELECT * FROM escalations WHERE user_id = ? AND closed_at IS NOT NULL AND rating IS NULL
      ORDER BY closed_at DESC LIMIT 1`,
    userId
  );
  if (!esc) return null;
  return esc;
}

export function rateEscalation(userId, escalationId, score, note) {
  const row = get('SELECT * FROM escalations WHERE id = ? AND user_id = ?', escalationId, userId);
  if (!row) throw new Error('المحادثة غير موجودة');
  if (row.rating != null) return { already: true };
  run('UPDATE escalations SET rating = ?, rating_note = ?, rated_at = ? WHERE id = ?',
    score ? 1 : 0, note ? String(note).slice(0, 500) : null, nowISO(), escalationId);
  return { already: false };
}

/** نسبة الرضا وزمن أول رد — ما يُقاس يتحسّن */
export function supportStats(days = 30) {
  const since = `-${Number(days) || 30} days`;
  const r = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS happy,
            SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
            AVG(CASE WHEN first_reply_at IS NOT NULL
                     THEN (julianday(first_reply_at) - julianday(started_at)) * 1440 END) AS avg_min
       FROM escalations WHERE started_at >= datetime('now', ?)`,
    since
  );
  const rated = r?.rated || 0;
  return {
    escalations: r?.total || 0,
    rated,
    satisfaction: rated ? Math.round(((r.happy || 0) / rated) * 100) : null,
    avgFirstReplyMinutes: r?.avg_min ? Math.round(r.avg_min) : null,
  };
}

// ——————————————————— التأجيل ———————————————————

export function snooze(userId, hours) {
  const until = new Date(Date.now() + Number(hours) * 3600_000).toISOString();
  run('UPDATE users SET snooze_until = ? WHERE id = ?', until, userId);
  return until;
}

export const unsnooze = (userId) => run('UPDATE users SET snooze_until = NULL WHERE id = ?', userId);
export const isSnoozed = (u) => Boolean(u?.snooze_until && u.snooze_until > nowISO());

// ——————————————————— البحث في المحادثات ———————————————————

/**
 * بحث في كل المحادثات — بالنص المُطبَّع حتى يجد «صيانه» من يكتب «صيانة».
 * الملاحظات الداخلية مشمولة لأن الباحث هنا هو الأدمن وحده.
 */
export function searchConversations(query, { limit = 40 } = {}) {
  const words = tokens(query);
  if (!words.length) return [];
  const like = `%${normalize(query).slice(0, 60)}%`;
  return all(
    `SELECT m.*, u.name AS client_name
       FROM chat_messages m JOIN users u ON u.id = m.user_id
      WHERE lower(m.body) LIKE lower(?) OR m.body LIKE ?
      ORDER BY m.id DESC LIMIT ?`,
    like, `%${String(query).slice(0, 60)}%`, Math.min(Number(limit) || 40, 100)
  );
}

// ——————————————————— الرسائل الاستباقية ———————————————————

const SSL_STEPS = [30, 14, 7, 3, 1];

function alreadySent(userId, siteId, kind) {
  return Boolean(
    get('SELECT id FROM proactive_log WHERE user_id = ? AND site_id IS ? AND kind = ? AND day = ?',
      userId, siteId, kind, nowISO().slice(0, 10))
  );
}

function markSent(userId, siteId, kind) {
  try {
    run('INSERT INTO proactive_log(user_id, site_id, kind, day, at) VALUES(?,?,?,?,?)',
      userId, siteId, kind, nowISO().slice(0, 10), nowISO());
    return true;
  } catch {
    return false;
  }
}

/**
 * يفحص نتيجة فحص موقع ويبعث رسالة من سامي عند الحاجة.
 * تحويل الدعم من رد فعل إلى مبادرة: العميل يعرف قبل أن يسأل.
 */
export function proactiveForCheck(site, result) {
  const sent = [];
  const say = (kind, body) => {
    if (alreadySent(site.user_id, site.id, kind)) return;
    if (!markSent(site.user_id, site.id, kind)) return;
    chat.sendMessage(site.user_id, { body, role: 'bot', channel: 'bot', meta: { kind: 'proactive', about: kind } });
    sent.push(kind);
  };

  // شهادة تقترب من الانتهاء — أهم تنبيه استباقي على الإطلاق
  const days = result?.tls?.daysLeft;
  if (result?.tls?.applicable && typeof days === 'number' && days >= 0) {
    const step = SSL_STEPS.find((d) => days <= d && days > (SSL_STEPS[SSL_STEPS.indexOf(d) + 1] ?? -1));
    if (step != null) {
      say(`ssl_${step}`,
        `تنبيه بشأن «${site.name}»: شهادة الأمان تنتهي خلال ${days === 0 ? 'أقل من يوم' : `${days} ${days <= 10 ? 'أيام' : 'يومًا'}`}.\n` +
        `إن انتهت سيعرض المتصفح تحذيرًا لكل زائر. فريقنا على علم بالموعد، وإن أردت التأكيد فأخبرني.`);
    }
  }

  // موقع لا يفتح
  if (result && !result.ok && !result.blocked) {
    say('down',
      `تنبيه: «${site.name}» لا يستجيب في فحصنا الأخير، وقد فتحنا عطلًا وبدأنا المتابعة.\n` +
      `سأخبرك فور عودته. وإن كان لديك أي معلومة تساعدنا فاكتبها هنا.`);
  }

  // موقع بطيء بشكل ملحوظ
  if (result?.ok && result.responseMs >= 3000) {
    say('slow',
      `ملاحظة عن «${site.name}»: زمن الاستجابة ${result.responseMs} جزء من الألف من الثانية، وهو أبطأ من المعتاد.\n` +
      `الأسباب الشائعة: صور غير مضغوطة، أو ضغط على الاستضافة. أستطيع أن أشرح لك التفاصيل إن أردت.`);
  }

  return sent;
}

/** يُستدعى عند إغلاق عطل — العميل يستحق أن يعرف أن الأمور عادت */
export function proactiveRecovered(site) {
  if (alreadySent(site.user_id, site.id, 'recovered')) return false;
  if (!markSent(site.user_id, site.id, 'recovered')) return false;
  chat.sendMessage(site.user_id, {
    body: `بشرى: «${site.name}» عاد للعمل ✅ وأغلقنا العطل.\nكل التفاصيل مسجّلة في سجل الأعطال داخل صفحة الموقع.`,
    role: 'bot', channel: 'bot', meta: { kind: 'proactive', about: 'recovered' },
  });
  return true;
}

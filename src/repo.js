// طبقة الوصول للبيانات — العزل بين العملاء مبني هنا، لا في المسارات.
//
// القاعدة الملزمة: **كل دالة عميل تأخذ userId كوسيط أول إجباري**، وكل استعلام
// يحمل شرط user_id. ممنوع على ملفات routes/ أن تستدعي db.prepare مباشرة.
// السبب: تسريب بيانات عميل لعميل آخر أخطر عطل ممكن في نظام كهذا، ولا يصح
// أن يعتمد منعه على انتباه من يكتب المسار.
import { all, get, run, nowISO } from './db.js';

class OwnershipError extends Error {
  constructor(kind, id) {
    super(`لا صلاحية على ${kind}#${id}`);
    this.name = 'OwnershipError';
    this.status = 404; // نرد 404 لا 403 حتى لا نؤكد للمهاجم وجود السجل
  }
}

function requireUserId(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('استدعاء بلا userId صالح — ممنوع');
  }
  return userId;
}

// ——————————————————— الفلوس ———————————————————
// تُخزَّن بالقروش كأعداد صحيحة. REAL يعطي 0.1+0.2 = 0.30000000000000004.

export const money = {
  toCents: (v) => Math.round(Number(v) * 100),
  fromCents: (c) => (Number(c || 0) / 100),
  format(cents, currency = 'EGP') {
    const names = { EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$' };
    const v = (Number(cents || 0) / 100).toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${v} ${names[currency] || currency}`;
  },
};

// ——————————————————— المواقع ———————————————————

export function listSites(userId) {
  requireUserId(userId);
  return all(
    `SELECT s.*,
            (SELECT health_score FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS health_score,
            (SELECT ok           FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS last_ok,
            (SELECT at           FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS last_check_at,
            (SELECT at FROM maintenance m WHERE m.site_id = s.id AND m.status = 'done' ORDER BY m.at DESC LIMIT 1) AS last_maintenance_at,
            (SELECT COUNT(*) FROM incidents i WHERE i.site_id = s.id AND i.resolved = 0) AS open_incidents
       FROM sites s
      WHERE s.user_id = ?
      ORDER BY s.created_at`,
    userId
  );
}

export function getSite(userId, siteId) {
  requireUserId(userId);
  const site = get('SELECT * FROM sites WHERE id = ? AND user_id = ?', siteId, userId);
  if (!site) throw new OwnershipError('موقع', siteId);
  return site;
}

export function latestCheck(userId, siteId) {
  getSite(userId, siteId); // يتحقق من الملكية قبل أي قراءة
  return get('SELECT * FROM checks WHERE site_id = ? ORDER BY at DESC LIMIT 1', siteId);
}

export function recentChecks(userId, siteId, limit = 60) {
  getSite(userId, siteId);
  return all(
    'SELECT at, ok, status_code, response_ms, health_score FROM checks WHERE site_id = ? ORDER BY at DESC LIMIT ?',
    siteId,
    Math.min(Number(limit) || 60, 500)
  ).reverse();
}

export function siteIncidents(userId, siteId, limit = 20) {
  getSite(userId, siteId);
  return all(
    'SELECT * FROM incidents WHERE site_id = ? ORDER BY started_at DESC LIMIT ?',
    siteId,
    Math.min(Number(limit) || 20, 100)
  );
}

export function siteMaintenance(userId, siteId, limit = 30) {
  getSite(userId, siteId);
  return all(
    'SELECT * FROM maintenance WHERE site_id = ? ORDER BY at DESC LIMIT ?',
    siteId,
    Math.min(Number(limit) || 30, 200)
  );
}

/**
 * نسبة التشغيل خلال فترة، مع **استبعاد فجوات المراقبة** من الحساب.
 * لا نحسب وقتًا لم نكن نراقب فيه كوقت تشغيل — هذا بند أمانة لا تحسين أرقام.
 */
export function uptimeStats(userId, siteId, days = 30) {
  getSite(userId, siteId);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const live = get(
    'SELECT COUNT(*) AS total, SUM(ok) AS ok FROM checks WHERE site_id = ? AND at >= ?',
    siteId,
    since
  );
  const rolled = get(
    'SELECT SUM(checks) AS total, SUM(ok_checks) AS ok FROM checks_daily WHERE site_id = ? AND day >= ?',
    siteId,
    since.slice(0, 10)
  );

  const total = (live?.total || 0) + (rolled?.total || 0);
  const ok = (live?.ok || 0) + (rolled?.ok || 0);
  const gaps = all(
    'SELECT started_at, ended_at, reason FROM monitor_gaps WHERE ended_at >= ? ORDER BY started_at DESC',
    since
  );
  const gapMinutes = gaps.reduce(
    (s, g) => s + Math.max(0, (new Date(g.ended_at) - new Date(g.started_at)) / 60000),
    0
  );

  return {
    days,
    totalChecks: total,
    okChecks: ok,
    percent: total ? Number(((ok / total) * 100).toFixed(2)) : null,
    gaps,
    gapMinutes: Math.round(gapMinutes),
    hasGaps: gaps.length > 0,
  };
}

/** منذ متى والموقع شغّال بلا انقطاع — للسرد: «شغّال من 47 يوم» */
export function currentStreak(userId, siteId) {
  getSite(userId, siteId);
  const lastFail = get(
    'SELECT at FROM checks WHERE site_id = ? AND ok = 0 ORDER BY at DESC LIMIT 1',
    siteId
  );
  const first = get('SELECT at FROM checks WHERE site_id = ? ORDER BY at ASC LIMIT 1', siteId);
  const from = lastFail?.at || first?.at;
  if (!from) return null;
  const ms = Date.now() - new Date(from).getTime();
  return { since: from, days: Math.floor(ms / 86400_000), hours: Math.floor(ms / 3600_000) };
}

// ——————————————————— الفواتير ———————————————————

export function userInvoices(userId) {
  requireUserId(userId);
  return all(
    `SELECT i.*,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
       FROM invoices i
      WHERE i.user_id = ?
      ORDER BY i.issued_at DESC`,
    userId
  );
}

export function getInvoice(userId, invoiceId) {
  requireUserId(userId);
  const inv = get('SELECT * FROM invoices WHERE id = ? AND user_id = ?', invoiceId, userId);
  if (!inv) throw new OwnershipError('فاتورة', invoiceId);
  inv.payments = all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY at', invoiceId);
  inv.paid_cents = inv.payments.reduce((s, p) => s + p.amount_cents, 0);
  inv.due_cents = Math.max(0, inv.amount_cents - inv.paid_cents);
  return inv;
}

/** إجمالي المتأخر على العميل، بالقروش */
export function outstanding(userId) {
  requireUserId(userId);
  const row = get(
    `SELECT COALESCE(SUM(i.amount_cents), 0) -
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                       JOIN invoices i2 ON i2.id = p.invoice_id
                      WHERE i2.user_id = ? AND i2.status != 'void'), 0) AS due,
            COUNT(*) AS count
       FROM invoices i
      WHERE i.user_id = ? AND i.status NOT IN ('paid','void')`,
    userId,
    userId
  );
  const today = nowISO().slice(0, 10);
  const overdue = get(
    `SELECT COUNT(*) AS n FROM invoices
      WHERE user_id = ? AND status NOT IN ('paid','void') AND due_at IS NOT NULL AND due_at < ?`,
    userId,
    today
  );
  return {
    cents: Math.max(0, row?.due || 0),
    invoices: row?.count || 0,
    overdueCount: overdue?.n || 0,
  };
}

// ——————————————————— التذاكر ———————————————————

export function userTickets(userId) {
  requireUserId(userId);
  return all(
    `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages
       FROM tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC`,
    userId
  );
}

export function getTicket(userId, ticketId) {
  requireUserId(userId);
  const t = get('SELECT * FROM tickets WHERE id = ? AND user_id = ?', ticketId, userId);
  if (!t) throw new OwnershipError('تذكرة', ticketId);
  t.messages = all('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id', ticketId);
  return t;
}

export function createTicket(userId, { subject, body, siteId = null, priority = 'normal' }) {
  requireUserId(userId);
  if (siteId) getSite(userId, siteId); // لا يفتح تذكرة على موقع ليس له
  const at = nowISO();
  const r = run(
    'INSERT INTO tickets(user_id, site_id, subject, priority, created_at, updated_at) VALUES(?,?,?,?,?,?)',
    userId,
    siteId,
    String(subject).slice(0, 200),
    ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
    at,
    at
  );
  run(
    'INSERT INTO ticket_messages(ticket_id, user_id, author_role, body, created_at) VALUES(?,?,?,?,?)',
    r.lastInsertRowid,
    userId,
    'client',
    String(body).slice(0, 5000),
    at
  );
  return Number(r.lastInsertRowid);
}

export function replyToTicket(userId, ticketId, body) {
  const t = getTicket(userId, ticketId);
  const at = nowISO();
  run(
    'INSERT INTO ticket_messages(ticket_id, user_id, author_role, body, created_at) VALUES(?,?,?,?,?)',
    t.id,
    userId,
    'client',
    String(body).slice(0, 5000),
    at
  );
  run("UPDATE tickets SET updated_at = ?, status = 'open' WHERE id = ?", at, t.id);
}

// ——————————————————— ملخص لوحة العميل ———————————————————

export function dashboard(userId) {
  requireUserId(userId);
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  const sites = listSites(userId);
  const due = outstanding(userId);

  const counts = { excellent: 0, good: 0, attention: 0, problems: 0, critical: 0, unknown: 0 };
  for (const s of sites) {
    if (s.health_score == null) counts.unknown++;
    else if (s.health_score >= 90) counts.excellent++;
    else if (s.health_score >= 75) counts.good++;
    else if (s.health_score >= 60) counts.attention++;
    else if (s.health_score >= 40) counts.problems++;
    else counts.critical++;
  }

  return {
    user,
    sites,
    counts,
    outstanding: due,
    openTickets: get(
      "SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status != 'closed'",
      userId
    )?.n || 0,
    mvp: user?.mvp_url ? { url: user.mvp_url, label: user.mvp_label || 'المنتج' } : null,
  };
}

export { OwnershipError, requireUserId };

// دوال الأدمن — منفصلة عن دوال العميل بأسماء تبدأ بـ admin، فلا يلتبس المساران.
// كل دالة هنا تفترض أن المستدعي أدمن — الفحص يتم في السيرفر قبل الاستدعاء.
import { all, get, run, nowISO } from './db.js';
import { money } from './repo.js';
import { referenceCode } from './billing.js';

export function audit(actorId, action, target, detail, ip) {
  run(
    'INSERT INTO audit_log(at, actor_id, action, target, detail, ip) VALUES(?,?,?,?,?,?)',
    nowISO(), actorId, action, target ?? null, detail ?? null, ip ?? null
  );
}

export function adminStats() {
  const clients = get("SELECT COUNT(*) AS n FROM users WHERE role = 'client'")?.n || 0;
  const sites = get('SELECT COUNT(*) AS n FROM sites WHERE active = 1')?.n || 0;
  const owed = get(
    `SELECT COALESCE(SUM(
              i.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)
            ),0) AS due
       FROM invoices i WHERE i.status NOT IN ('paid','void')`
  );
  return { clients, sites, outstandingCents: Math.max(0, owed?.due || 0) };
}

export function adminAllSites() {
  return all(
    `SELECT s.*, u.name AS client_name,
            (SELECT health_score FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS health_score,
            (SELECT ok FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS last_ok,
            (SELECT at FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS last_check_at
       FROM sites s JOIN users u ON u.id = s.user_id
      ORDER BY last_ok ASC, s.created_at DESC`
  );
}

export function adminOpenIncidents() {
  return all(
    `SELECT i.*, s.name AS site_name, u.name AS client_name
       FROM incidents i JOIN sites s ON s.id = i.site_id JOIN users u ON u.id = s.user_id
      WHERE i.resolved = 0 ORDER BY i.started_at DESC`
  );
}

export function adminClients() {
  return all(
    `SELECT u.*,
            (SELECT COUNT(*) FROM sites s WHERE s.user_id = u.id) AS site_count,
            (SELECT COALESCE(SUM(
                      i.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)
                    ),0)
               FROM invoices i WHERE i.user_id = u.id AND i.status NOT IN ('paid','void')) AS outstanding_cents
       FROM users u WHERE u.role = 'client' ORDER BY u.created_at DESC`
  );
}

export const adminGetClient = (id) => get("SELECT * FROM users WHERE id = ? AND role = 'client'", id);
export const adminGetSite = (id) => get('SELECT * FROM sites WHERE id = ?', id);
export const adminSiteChecks = (id, n = 1) =>
  all('SELECT * FROM checks WHERE site_id = ? ORDER BY at DESC LIMIT ?', id, n);
export const adminSiteMaintenance = (id) =>
  all('SELECT * FROM maintenance WHERE site_id = ? ORDER BY at DESC LIMIT 20', id);
export const adminSiteIncidents = (id) =>
  all('SELECT * FROM incidents WHERE site_id = ? ORDER BY started_at DESC LIMIT 20', id);
export const adminClientSites = (userId) =>
  all(
    `SELECT s.*,
            (SELECT health_score FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS health_score,
            (SELECT ok FROM checks c WHERE c.site_id = s.id ORDER BY c.at DESC LIMIT 1) AS last_ok
       FROM sites s WHERE s.user_id = ? ORDER BY s.created_at`,
    userId
  );
export const adminClientInvoices = (userId) =>
  all(
    `SELECT i.*, COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id),0) AS paid_cents
       FROM invoices i WHERE i.user_id = ? ORDER BY i.issued_at DESC`,
    userId
  );

export function adminCreateClient({ name, email, company, phone, whatsapp, mvp_url, mvp_label }, passwordHash) {
  const at = nowISO();
  const months = Number(get("SELECT value FROM settings WHERE key = 'trial_months'")?.value || 6);
  const trialEnds = new Date(Date.parse(at) + months * 30 * 86400_000).toISOString();
  const r = run(
    `INSERT INTO users(email, password_hash, name, role, phone, whatsapp, company, mvp_url, mvp_label,
                       active, created_at, trial_ends_at)
     VALUES(?,?,?,'client',?,?,?,?,?,1,?,?)`,
    String(email).trim().toLowerCase(), passwordHash, String(name).trim(),
    phone || null, whatsapp || phone || null, company || null, mvp_url || null, mvp_label || null, at, trialEnds
  );
  return Number(r.lastInsertRowid);
}

export function adminAddSite(userId, { name, url }) {
  const r = run(
    'INSERT INTO sites(user_id, name, url, created_at) VALUES(?,?,?,?)',
    userId, String(name).trim(), String(url).trim(), nowISO()
  );
  return Number(r.lastInsertRowid);
}

export function adminCreateInvoice(userId, { description, amount, currency = 'EGP', due_at, site_id = null }) {
  const at = nowISO();
  const cents = money.toCents(amount);
  if (!Number.isFinite(cents) || cents < 0) throw new Error('مبلغ غير صالح');
  const seq = (get('SELECT COUNT(*) AS n FROM invoices')?.n || 0) + 1;
  const number = `INV-${at.slice(0, 4)}-${String(seq).padStart(4, '0')}`;
  const r = run(
    `INSERT INTO invoices(user_id, site_id, number, description, amount, amount_cents, currency,
                          issued_at, due_at, status, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,'unpaid',?)`,
    userId, site_id, number, String(description || '').slice(0, 200),
    cents / 100, cents, currency, at, due_at || null, at
  );
  const id = Number(r.lastInsertRowid);
  // كود مرجعي يُكتب في ملاحظات التحويل — إنستا باي وفودافون كاش بلا API،
  // وهذا ما يجعل مطابقة التحويل بالفاتورة فورية بدل التخمين.
  const ref = referenceCode(id, get("SELECT value FROM settings WHERE key = 'pay_vodafone'")?.value);
  run('UPDATE invoices SET reference_code = ? WHERE id = ?', ref, id);
  return { id, number, reference: ref };
}

/**
 * تسجيل دفعة — في معاملة واحدة مع تحديث حالة الفاتورة.
 * لولا المعاملة لأمكن أن تُسجَّل الدفعة وتبقى الفاتورة "غير مدفوعة" عند انقطاع.
 */
export function adminRecordPayment(invoiceId, { amount, method, note }, db) {
  const cents = money.toCents(amount);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error('مبلغ غير صالح');

  db.exec('BEGIN');
  try {
    const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
    if (!inv) throw new Error('الفاتورة غير موجودة');

    run(
      'INSERT INTO payments(invoice_id, at, amount, amount_cents, method, note) VALUES(?,?,?,?,?,?)',
      invoiceId, nowISO(), cents / 100, cents, method || 'تحويل', note || null
    );
    const paid = get('SELECT COALESCE(SUM(amount_cents),0) AS p FROM payments WHERE invoice_id = ?', invoiceId).p;
    const status = paid >= inv.amount_cents ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    run('UPDATE invoices SET status = ? WHERE id = ?', status, invoiceId);

    db.exec('COMMIT');
    return { paidCents: paid, status };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function adminLogMaintenance(siteId, { title, type, notes, performed_by, next_due_at }) {
  const at = nowISO();
  const r = run(
    `INSERT INTO maintenance(site_id, at, type, title, notes, performed_by, status, next_due_at, created_at)
     VALUES(?,?,?,?,?,?,'done',?,?)`,
    siteId, at, type || 'update', String(title).slice(0, 200),
    notes ? String(notes).slice(0, 2000) : null, performed_by || null, next_due_at || null, at
  );
  return Number(r.lastInsertRowid);
}

export function adminPendingResets() {
  return all(
    `SELECT r.*, u.name, u.email FROM reset_requests r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'pending' ORDER BY r.requested_at DESC LIMIT 50`
  );
}

export function adminMarkResetIssued(requestId) {
  run("UPDATE reset_requests SET status = 'issued', handled_at = ? WHERE id = ?", nowISO(), requestId);
}

export function adminOpenTickets() {
  return all(
    `SELECT t.*, u.name AS client_name FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.status != 'closed' ORDER BY t.updated_at DESC LIMIT 50`
  );
}

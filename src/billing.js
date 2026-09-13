// منطق الاشتراك والتحصيل.
//
// مبدأ حاكم: **القفل يقفل المزايا، ولا يقفل طريق الدفع أبدًا.**
// عميل لا يستطيع رؤية ما عليه ولا الوصول إليك لن يدفع أسرع — بل أبطأ.
// لذلك تبقى مفتوحة دائمًا: الفاتورة · طرق الدفع · الشات · واتساب.
//
// ومبدأ ثانٍ: **المراقبة لا تتوقف أثناء القفل.** حين يدفع يجد تاريخه كاملًا،
// وهذا في مصلحتك: بيانات متصلة، وسبب قوي ألا يترك النظام.
import { all, get, run, nowISO, setting } from './db.js';

const DAY = 86400_000;

export function paymentSettings() {
  return {
    instapay: setting('pay_instapay') || '',
    vodafone: setting('pay_vodafone') || '',
    whatsapp: setting('pay_whatsapp') || '',
    holder: setting('pay_holder') || '',
    trialMonths: Number(setting('trial_months') || 6),
    graceDays: Number(setting('grace_days') || 5),
  };
}

/** رابط واتساب جاهز برسالة مبدئية */
export function whatsappLink(text = 'السلام عليكم، أريد تفعيل الاشتراك') {
  const num = (setting('pay_whatsapp') || '').replace(/\D/g, '');
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

/**
 * حالة حساب العميل.
 * trial      — داخل الـ 6 شهور المجانية
 * ok         — لا مستحقات
 * due        — عليه مبلغ ولم يحن موعده بعد
 * grace      — تجاوز الموعد وما زال داخل مهلة الأيام الخمسة
 * restricted — انتهت المهلة → تُقفل المزايا
 */
export function accountState(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return { state: 'ok', locked: false };

  const cfg = paymentSettings();
  const today = nowISO().slice(0, 10);

  const rows = all(
    `SELECT i.*,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
       FROM invoices i
      WHERE i.user_id = ? AND i.status NOT IN ('paid','void')
      ORDER BY COALESCE(i.due_at, i.issued_at) ASC`,
    userId
  );
  const unpaid = rows.filter((r) => r.amount_cents - r.paid_cents > 0);
  const dueCents = unpaid.reduce((s, r) => s + (r.amount_cents - r.paid_cents), 0);

  // أقدم فاتورة تجاوزت موعدها هي التي تحكم المهلة
  const overdue = unpaid.filter((r) => r.due_at && r.due_at < today);
  const oldest = overdue[0] || null;

  const graceDays = user.grace_days ?? cfg.graceDays;
  let daysPastDue = 0;
  let graceLeft = null;
  if (oldest) {
    // نقارن التواريخ مجرّدة من الوقت حتى لا تنزلق المهلة بساعات المنطقة الزمنية
    daysPastDue = Math.floor((Date.parse(today) - Date.parse(oldest.due_at.slice(0, 10))) / DAY);
    // «مهلة 5 أيام» تعني خمسة أيام كاملة: اليوم 1..5 مهلة، والقفل في اليوم 6.
    graceLeft = graceDays - daysPastDue + 1;
  }

  // فترة التجربة
  const trialEndsAt = user.trial_ends_at || null;
  const inTrial = trialEndsAt ? Date.parse(trialEndsAt) > Date.now() : false;
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / DAY))
    : null;

  let state;
  if (user.exempt) state = 'ok';
  else if (inTrial && dueCents === 0) state = 'trial';
  else if (dueCents === 0) state = 'ok';
  else if (!oldest) state = 'due';
  else if (graceLeft > 0) state = 'grace';
  else state = 'restricted';

  // فترة التجربة لا تُلغي فاتورة تجاوزت موعدها بمهلتها —
  // لكنها تمنع القفل، لأن الوعد كان ستة شهور مجانية.
  if (inTrial && state === 'restricted') state = 'grace';

  const locked = state === 'restricted';

  return {
    state,
    locked,
    dueCents,
    invoices: unpaid,
    oldestDueAt: oldest?.due_at || null,
    daysPastDue,
    graceLeft,
    graceDays,
    inTrial,
    trialEndsAt,
    trialDaysLeft,
    exempt: Boolean(user.exempt),
  };
}

/** يسجّل لحظة القفل مرة واحدة — لقياس أثر التحصيل لاحقًا */
export function syncRestriction(userId, st) {
  const user = get('SELECT restricted_at FROM users WHERE id = ?', userId);
  if (st.locked && !user?.restricted_at) {
    run('UPDATE users SET restricted_at = ? WHERE id = ?', nowISO(), userId);
  } else if (!st.locked && user?.restricted_at) {
    run('UPDATE users SET restricted_at = NULL WHERE id = ?', userId);
  }
}

/** كود مرجعي قصير يُكتب في خانة ملاحظات التحويل فتُطابق الفاتورة بلا لبس */
export function referenceCode(invoiceId, number) {
  const tail = String(number || '').replace(/\D/g, '').slice(-4) || '0000';
  return `MK${String(invoiceId).padStart(3, '0')}${tail}`;
}

/** مراحل التذكير — تصاعدية، وكل مرحلة مرة واحدة في اليوم */
export function reminderStage(st) {
  if (st.state === 'restricted') return 'restricted';
  if (st.state === 'grace') return `grace_${Math.max(0, st.graceLeft)}`;
  if (st.state === 'due') return 'due';
  if (st.state === 'trial' && st.trialDaysLeft != null && st.trialDaysLeft <= 30) return 'trial_ending';
  return null;
}

export function noteReminder(userId, kind) {
  const day = nowISO().slice(0, 10);
  try {
    run('INSERT INTO billing_reminders(user_id, kind, at, day) VALUES(?,?,?,?)', userId, kind, nowISO(), day);
    return true;
  } catch {
    return false; // أُرسل اليوم بالفعل
  }
}

// ——————————————————— إشعارات التحويل ———————————————————

export function claimPayment(userId, { invoiceId = null, method, amountCents, senderRef, note }) {
  if (!['instapay', 'vodafone', 'other'].includes(method)) throw new Error('طريقة دفع غير معروفة');
  const cents = Number(amountCents);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error('مبلغ غير صالح');
  if (invoiceId) {
    const owns = get('SELECT id FROM invoices WHERE id = ? AND user_id = ?', invoiceId, userId);
    if (!owns) throw new Error('فاتورة غير موجودة');
  }
  const r = run(
    `INSERT INTO payment_claims(user_id, invoice_id, at, method, amount_cents, sender_ref, note)
     VALUES(?,?,?,?,?,?,?)`,
    userId, invoiceId, nowISO(), method, Math.round(cents),
    senderRef ? String(senderRef).slice(0, 60) : null,
    note ? String(note).slice(0, 500) : null
  );
  return Number(r.lastInsertRowid);
}

export const pendingClaims = () =>
  all(
    `SELECT c.*, u.name AS client_name, u.email, i.number AS invoice_number
       FROM payment_claims c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN invoices i ON i.id = c.invoice_id
      WHERE c.status = 'pending' ORDER BY c.at DESC`
  );

export const userClaims = (userId) =>
  all('SELECT * FROM payment_claims WHERE user_id = ? ORDER BY at DESC LIMIT 20', userId);

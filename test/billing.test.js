// اختبار آلة حالات الاشتراك — المال والقفل، فالخطأ هنا يكلّف عميلًا.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { run, get, all as allRows, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import { accountState, referenceCode, claimPayment, pendingClaims, paymentSettings, whatsappLink } from '../src/billing.js';

const DAY = 86400_000;
const dateOffset = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

let n = 0;
function mkClient({ trialMonthsAgo = 12, exempt = 0 } = {}) {
  const at = new Date(Date.now() - trialMonthsAgo * 30 * DAY).toISOString();
  const trialEnds = new Date(Date.parse(at) + 6 * 30 * DAY).toISOString();
  return Number(
    run(
      `INSERT INTO users(email, password_hash, name, role, created_at, trial_ends_at, grace_days, exempt)
       VALUES(?,?,?,'client',?,?,5,?)`,
      `bill${++n}-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا'), `عميل ${n}`, at, trialEnds, exempt
    ).lastInsertRowid
  );
}

function mkInvoice(userId, cents, dueOffsetDays, paidCents = 0) {
  const at = nowISO();
  const id = Number(
    run(
      `INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, due_at, status, created_at)
       VALUES(?,?,?,?,'EGP',?,?,?,?)`,
      userId, `B-${userId}-${cents}-${Math.random().toString(36).slice(2, 7)}`,
      cents / 100, cents, at, dateOffset(dueOffsetDays), paidCents >= cents ? 'paid' : 'unpaid', at
    ).lastInsertRowid
  );
  if (paidCents > 0) {
    run('INSERT INTO payments(invoice_id, at, amount, amount_cents) VALUES(?,?,?,?)', id, at, paidCents / 100, paidCents);
  }
  return id;
}

before(() => migrate({ quiet: true }));

test('داخل الستة شهور المجانية: حالة تجربة بلا مستحقات', () => {
  const u = mkClient({ trialMonthsAgo: 1 });
  const st = accountState(u);
  assert.equal(st.state, 'trial');
  assert.equal(st.locked, false);
  assert.ok(st.trialDaysLeft > 100, `أيام التجربة المتبقية ${st.trialDaysLeft}`);
});

test('بعد التجربة وبلا مستحقات: حالة سليمة', () => {
  const st = accountState(mkClient());
  assert.equal(st.state, 'ok');
  assert.equal(st.dueCents, 0);
  assert.equal(st.locked, false);
});

test('فاتورة لم يحن موعدها: تظهر الرسالة بلا قفل', () => {
  const u = mkClient();
  mkInvoice(u, 250000, +7);
  const st = accountState(u);
  assert.equal(st.state, 'due');
  assert.equal(st.dueCents, 250000);
  assert.equal(st.locked, false);
});

test('مهلة الخمسة أيام كاملة: اليوم 1 حتى 5 مهلة، والقفل في اليوم 6', () => {
  for (const past of [1, 2, 3, 4, 5]) {
    const u = mkClient();
    mkInvoice(u, 100000, -past);
    const st = accountState(u);
    assert.equal(st.state, 'grace', `اليوم ${past} بعد الاستحقاق يجب أن يكون مهلة لا ${st.state}`);
    assert.equal(st.locked, false, `قُفل الحساب في اليوم ${past} — المهلة خمسة أيام`);
    assert.equal(st.graceLeft, 5 - past + 1, `أيام المهلة المتبقية خطأ في اليوم ${past}`);
  }
  const u6 = mkClient();
  mkInvoice(u6, 100000, -6);
  const st6 = accountState(u6);
  assert.equal(st6.state, 'restricted', 'لم يُقفل الحساب بعد انتهاء المهلة');
  assert.equal(st6.locked, true);
});

test('التجربة المجانية تمنع القفل حتى مع تجاوز المهلة', () => {
  const u = mkClient({ trialMonthsAgo: 1 });
  mkInvoice(u, 100000, -30);
  const st = accountState(u);
  assert.equal(st.locked, false, 'قُفل حساب داخل الستة شهور المجانية — إخلاف بالوعد');
  assert.equal(st.state, 'grace');
});

test('الإعفاء اليدوي يمنع القفل', () => {
  const u = mkClient({ exempt: 1 });
  mkInvoice(u, 500000, -60);
  const st = accountState(u);
  assert.equal(st.state, 'ok');
  assert.equal(st.locked, false);
});

test('الدفع الجزئي يخفض المستحق ولا يلغيه', () => {
  const u = mkClient();
  mkInvoice(u, 300000, -2, 100000);
  const st = accountState(u);
  assert.equal(st.dueCents, 200000);
  assert.equal(st.state, 'grace');
});

test('السداد الكامل يفك القفل فورًا', () => {
  const u = mkClient();
  const inv = mkInvoice(u, 100000, -20);
  assert.equal(accountState(u).locked, true);
  run('INSERT INTO payments(invoice_id, at, amount, amount_cents) VALUES(?,?,?,?)', inv, nowISO(), 1000, 100000);
  run("UPDATE invoices SET status = 'paid' WHERE id = ?", inv);
  const after = accountState(u);
  assert.equal(after.locked, false, 'ظل الحساب مقفولًا بعد السداد');
  assert.equal(after.dueCents, 0);
});

test('أقدم فاتورة متأخرة هي التي تحكم المهلة', () => {
  const u = mkClient();
  mkInvoice(u, 100000, -20);  // قديمة جدًا
  mkInvoice(u, 100000, -1);   // حديثة
  const st = accountState(u);
  assert.equal(st.state, 'restricted', 'الفاتورة الحديثة أخفت تأخّر القديمة');
  assert.equal(st.dueCents, 200000);
});

test('فاتورة بلا تاريخ استحقاق لا تقفل الحساب', () => {
  const u = mkClient();
  const at = nowISO();
  run(`INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, status, created_at)
       VALUES(?,?,?,?,'EGP',?,'unpaid',?)`, u, `ND-${Date.now()}`, 1000, 100000, at, at);
  const st = accountState(u);
  assert.equal(st.state, 'due');
  assert.equal(st.locked, false, 'قُفل حساب بفاتورة بلا موعد استحقاق');
});

test('الكود المرجعي مشتق وثابت', () => {
  assert.equal(referenceCode(7, '01099576398'), 'MK0076398');
  assert.equal(referenceCode(7, '01099576398'), referenceCode(7, '01099576398'));
  assert.notEqual(referenceCode(8, '01099576398'), referenceCode(7, '01099576398'));
});

test('إشعار التحويل يُسجَّل ولا يقبل مبلغًا غير صالح', () => {
  const u = mkClient();
  const inv = mkInvoice(u, 250000, -1);
  const id = claimPayment(u, { invoiceId: inv, method: 'instapay', amountCents: 250000, senderRef: '01099576398' });
  assert.ok(id > 0);
  assert.ok(pendingClaims().some((c) => c.id === id));
  assert.throws(() => claimPayment(u, { method: 'instapay', amountCents: 0 }), /مبلغ/);
  assert.throws(() => claimPayment(u, { method: 'بيتكوين', amountCents: 100 }), /طريقة/);
});

test('عميل لا يستطيع الإبلاغ عن تحويل على فاتورة غيره', () => {
  const a = mkClient(), b = mkClient();
  const invB = mkInvoice(b, 100000, -1);
  assert.throws(() => claimPayment(a, { invoiceId: invB, method: 'vodafone', amountCents: 100000 }), /فاتورة/);
});

test('إعدادات الدفع ورابط واتساب جاهزة', () => {
  const cfg = paymentSettings();
  assert.equal(cfg.instapay, '01099576398');
  assert.equal(cfg.vodafone, '01099576398');
  assert.equal(cfg.graceDays, 5);
  assert.equal(cfg.trialMonths, 6);
  assert.match(whatsappLink(), /^https:\/\/wa\.me\/201099576398\?text=/);
});

// ——————————————————— ثغرات كشفها الفحص الحي ———————————————————

test('تأكيد الإشعار مرتين لا يسجّل الدفعة مرتين', async () => {
  const { db } = await import('../src/db.js');
  const { confirmClaim } = await import('../src/billing.js');
  const u = mkClient();
  const inv = mkInvoice(u, 250000, -2);
  const claim = claimPayment(u, { invoiceId: inv, method: 'instapay', amountCents: 250000 });

  const first = confirmClaim(claim, 1, db);
  assert.equal(first.already, false);

  const second = confirmClaim(claim, 1, db);
  assert.equal(second.already, true, 'قُبل التأكيد مرتين');

  const payments = allRows('SELECT * FROM payments WHERE invoice_id = ?', inv);
  assert.equal(payments.length, 1, `سُجّلت ${payments.length} دفعات لإشعار واحد`);
  assert.equal(payments[0].amount_cents, 250000);
  assert.equal(get('SELECT status FROM invoices WHERE id = ?', inv).status, 'paid');
  assert.equal(accountState(u).locked, false, 'ظل الحساب مقفولًا بعد تأكيد السداد');
});

test('حذف الفاتورة يفك ارتباط الإشعار ولا يسجّل دفعة وهمية', async () => {
  const { db } = await import('../src/db.js');
  const { confirmClaim } = await import('../src/billing.js');
  const u = mkClient();
  const inv = mkInvoice(u, 100000, -2);
  const claim = claimPayment(u, { invoiceId: inv, method: 'vodafone', amountCents: 100000 });

  // المخطط يحمل ON DELETE SET NULL، فالإشعار يُفك ارتباطه بدل أن يصبح يتيمًا
  run('DELETE FROM invoices WHERE id = ?', inv);
  assert.equal(get('SELECT invoice_id FROM payment_claims WHERE id = ?', claim).invoice_id, null);

  const r = confirmClaim(claim, 1, db);
  assert.equal(r.already, false);
  assert.equal(r.linked, false, 'ادّعى النظام ربطًا بفاتورة محذوفة');
  assert.equal(allRows('SELECT * FROM payments WHERE invoice_id = ?', inv).length, 0, 'سُجّلت دفعة على فاتورة محذوفة');
  assert.equal(get('SELECT status FROM payment_claims WHERE id = ?', claim).status, 'confirmed');
});

test('فشل داخل التأكيد يُرجع الإشعار معلّقًا — لا تأكيد بلا دفعة', async () => {
  const { db } = await import('../src/db.js');
  const { confirmClaim } = await import('../src/billing.js');
  const u = mkClient();
  const inv = mkInvoice(u, 100000, -2);
  const claim = claimPayment(u, { invoiceId: inv, method: 'vodafone', amountCents: 100000 });

  // نُفشل تسجيل الدفعة بجعل جدول payments غير قابل للكتابة داخل المعاملة
  db.exec('CREATE TRIGGER IF NOT EXISTS block_pay BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, "منع مؤقت"); END');
  try {
    assert.throws(() => confirmClaim(claim, 1, db), /منع مؤقت/);
    assert.equal(
      get('SELECT status FROM payment_claims WHERE id = ?', claim).status,
      'pending',
      'بقي الإشعار مؤكَّدًا رغم فشل تسجيل الدفعة — المعاملة لم تتراجع'
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS block_pay');
  }
});

test('سقف يومي يمنع إغراق اللوحة بإشعارات تحويل', () => {
  const u = mkClient();
  let accepted = 0;
  for (let i = 0; i < 12; i++) {
    try {
      // مبالغ مختلفة حتى لا يعمل منع التكرار بدل السقف
      claimPayment(u, { method: 'instapay', amountCents: 1000 + i });
      accepted++;
    } catch { /* رُفض بالسقف */ }
  }
  assert.ok(accepted <= 5, `مرّ ${accepted} إشعارًا — السقف خمسة يوميًا`);
  assert.ok(accepted >= 1, 'رُفضت كل الإشعارات');
});

test('ضغطة مكرّرة خلال دقيقتين ترجع نفس الإشعار لا إشعارًا جديدًا', () => {
  const u = mkClient();
  const a = claimPayment(u, { method: 'vodafone', amountCents: 90000 });
  const b = claimPayment(u, { method: 'vodafone', amountCents: 90000 });
  assert.equal(a, b, 'أنشأت الضغطة المكرّرة إشعارًا ثانيًا');
});

test('الستة شهور تُحسب تقويميًا لا 30 يومًا × 6', async () => {
  const { addMonths } = await import('../src/billing.js');
  assert.equal(addMonths('2026-01-15T00:00:00.000Z', 6).slice(0, 10), '2026-07-15');
  assert.equal(addMonths('2026-03-31T00:00:00.000Z', 1).slice(0, 10), '2026-04-30', 'تجاوز نهاية الشهر');
  assert.equal(addMonths('2026-01-31T00:00:00.000Z', 1).slice(0, 10), '2026-02-28', 'فبراير');
  assert.equal(addMonths('2026-08-15T00:00:00.000Z', 6).slice(0, 10), '2027-02-15', 'عبور السنة');

  // والنتيجة تطابق ما تفعله الهجرة في SQLite
  const sqlite = get("SELECT datetime('2026-01-15 00:00:00', '+6 months') AS d").d.slice(0, 10);
  assert.equal(addMonths('2026-01-15T00:00:00.000Z', 6).slice(0, 10), sqlite, 'اختلفت عن حساب الهجرة');
});

// اختبار آلة حالات الاشتراك — المال والقفل، فالخطأ هنا يكلّف عميلًا.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { run, get, nowISO } from '../src/db.js';
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

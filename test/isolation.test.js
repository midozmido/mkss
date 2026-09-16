// اختبار العزل بين العملاء — أخطر بند في النظام.
// كل حالة هنا تحاكي عميلًا يحاول الوصول لبيانات عميل آخر.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { run, get, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import * as repo from '../src/repo.js';
import { hashPassword } from '../src/auth.js';

let alice, bob, aliceSite, bobSite, bobInvoice, bobTicket;

before(() => {
  migrate({ quiet: true });
  const at = nowISO();
  const mk = (email, name) =>
    Number(
      run(
        'INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
        email,
        hashPassword('كلمة-سر-قوية-جدا-123'),
        name,
        'client',
        at
      ).lastInsertRowid
    );
  alice = mk(`alice-${Date.now()}@test.local`, 'عالية');
  bob = mk(`bob-${Date.now()}@test.local`, 'باسم');

  const mkSite = (uid, name) =>
    Number(
      run('INSERT INTO sites(user_id, name, url, created_at) VALUES(?,?,?,?)', uid, name, 'https://x.test/', at)
        .lastInsertRowid
    );
  aliceSite = mkSite(alice, 'موقع عالية');
  bobSite = mkSite(bob, 'موقع باسم');

  bobInvoice = Number(
    run(
      'INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, status, created_at) VALUES(?,?,?,?,?,?,?,?)',
      bob,
      `INV-${Date.now()}`,
      1000,
      100000,
      'EGP',
      at,
      'unpaid',
      at
    ).lastInsertRowid
  );
  bobTicket = repo.createTicket(bob, { subject: 'مشكلة باسم', body: 'سري' });
});

test('عميل لا يرى مواقع عميل آخر في قائمته', () => {
  const ids = repo.listSites(alice).map((s) => s.id);
  assert.ok(ids.includes(aliceSite));
  assert.ok(!ids.includes(bobSite), 'تسريب: موقع باسم ظهر لعالية');
});

test('الوصول المباشر لموقع عميل آخر يُرفض', () => {
  assert.throws(() => repo.getSite(alice, bobSite), /لا صلاحية/);
});

test('كل قراءات الموقع محمية بفحص الملكية', () => {
  for (const fn of [repo.latestCheck, repo.recentChecks, repo.siteIncidents, repo.siteMaintenance, repo.uptimeStats, repo.currentStreak]) {
    assert.throws(() => fn(alice, bobSite), /لا صلاحية/, `${fn.name} لا يفحص الملكية`);
  }
});

test('الفواتير معزولة', () => {
  assert.throws(() => repo.getInvoice(alice, bobInvoice), /لا صلاحية/);
  assert.ok(!repo.userInvoices(alice).some((i) => i.id === bobInvoice));
});

test('التذاكر معزولة', () => {
  assert.throws(() => repo.getTicket(alice, bobTicket), /لا صلاحية/);
  assert.throws(() => repo.replyToTicket(alice, bobTicket, 'تطفّل'), /لا صلاحية/);
});

test('لا يفتح تذكرة على موقع ليس له', () => {
  assert.throws(() => repo.createTicket(alice, { subject: 'x', body: 'y', siteId: bobSite }), /لا صلاحية/);
});

test('استدعاء بلا userId صالح مرفوض — لا يتحول لاستعلام مفتوح', () => {
  for (const bad of [undefined, null, 0, -1, '1', NaN]) {
    assert.throws(() => repo.listSites(bad), /userId/, `قُبل userId غير صالح: ${String(bad)}`);
  }
});

test('رفض الملكية يرد 404 لا 403 — لا يؤكد وجود السجل', () => {
  try {
    repo.getSite(alice, bobSite);
    assert.fail('لم يُرفض');
  } catch (e) {
    assert.equal(e.status, 404);
  }
});

test('حساب الفلوس بالقروش دقيق', () => {
  assert.equal(repo.money.toCents(10.1) + repo.money.toCents(20.2), repo.money.toCents(30.3));
  assert.equal(repo.money.fromCents(3030), 30.3);
  assert.match(repo.money.format(450000, 'EGP'), /ج\.م/);
});

test('المتأخرات تُحسب لصاحبها فقط', () => {
  assert.equal(repo.outstanding(alice).cents, 0, 'تسريب: فاتورة باسم حُسبت على عالية');
  assert.equal(repo.outstanding(bob).cents, 100000);
});

test('المتأخرات لا تخصم دفعات فواتير مسدَّدة من فواتير قائمة', () => {
  const at = nowISO();
  const carol = Number(
    run('INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
      `carol-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا-123'), 'كارول', 'client', at).lastInsertRowid
  );
  // الرقم كان `T-${Date.now()}-${cents}`، وفاتورتان بنفس المبلغ في نفس
  // المللي ثانية تنتجان الرقم نفسه فيفشل الاختبار متقطّعًا. عدّاد صريح
  // يجعل التفرّد مضمونًا لا محكومًا بسرعة الجهاز.
  let seq = 0;
  const mkInv = (cents, status) => Number(
    run(`INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, status, created_at)
         VALUES(?,?,?,?,'EGP',?,?,?)`,
      carol, `T-${Date.now()}-${++seq}`, cents / 100, cents, at, status, at).lastInsertRowid
  );

  // فاتورة مسدَّدة بالكامل + فاتورتان قائمتان
  const paid = mkInv(250000, 'paid');
  run('INSERT INTO payments(invoice_id, at, amount, amount_cents) VALUES(?,?,?,?)', paid, at, 2500, 250000);
  mkInv(250000, 'unpaid');
  mkInv(400000, 'unpaid');

  assert.equal(
    repo.outstanding(carol).cents, 650000,
    'دفعة الفاتورة المسدَّدة خُصمت من الفواتير القائمة'
  );
  assert.equal(repo.outstanding(carol).invoices, 2);
});

test('الدفع الجزئي يُحسب على فاتورته وحدها', () => {
  const at = nowISO();
  const dana = Number(
    run('INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
      `dana-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا-123'), 'دانا', 'client', at).lastInsertRowid
  );
  const inv = Number(
    run(`INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, status, created_at)
         VALUES(?,?,?,?,'EGP',?,'partial',?)`,
      dana, `P-${Date.now()}`, 1000, 100000, at, at).lastInsertRowid
  );
  run('INSERT INTO payments(invoice_id, at, amount, amount_cents) VALUES(?,?,?,?)', inv, at, 300, 30000);
  assert.equal(repo.outstanding(dana).cents, 70000, 'المتبقي بعد دفعة جزئية غير صحيح');
});

test('الأرقام تُعرض لاتينية (1234) لا هندية (١٢٣٤)', () => {
  const s = repo.money.format(650000, 'EGP');
  assert.ok(/6[,٬]?500/.test(s.replace(/٬/g, ',')), `التنسيق غير متوقع: ${s}`);
  assert.ok(!/[٠-٩]/.test(s), `ظهرت أرقام هندية: ${s}`);
});

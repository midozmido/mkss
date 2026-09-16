// اختبار مسار الرفع عبر HTTP حقيقي — لا استدعاء دوال.
//
// ما لا يمسكه اختبارُ وحدة: أن سقف الستّة ميجابايت ينطبق على مسار الرفع
// **وحده**، وأن الاتصال يبقى صالحًا بعد رفض طلب كبير. الثانية عيبٌ لا يظهر
// إلا بطلبين متتاليين على المقبس نفسه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { run, get, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';

let server, BASE, jar, csrf;

const take = (r) => {
  for (const c of r.headers.getSetCookie?.() || []) {
    const [p] = c.split(';'); const i = p.indexOf('=');
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (v) jar.set(k, v); else jar.delete(k);
  }
};
const C = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

/** يبني جسم ‎multipart‎ كما يرسله المتصفّح */
function multipart(fields, fileBytes) {
  const B = '----mkssHTTP';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (fileBytes) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="receipt"; filename="r.png"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(fileBytes, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { body: Buffer.concat(parts), ctype: `multipart/form-data; boundary=${B}` };
}

before(async () => {
  migrate({ quiet: true });
  const at = nowISO();
  const email = `up-${Date.now()}@test.local`;
  const uid = Number(run(
    'INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
    email, hashPassword('كلمة-سر-قوية-جدا-123'), 'رافع', 'client', at).lastInsertRowid);
  // فاتورة مستحقّة كي يظهر نموذج الإبلاغ أصلًا
  run(`INSERT INTO invoices(user_id, number, amount, amount_cents, currency, issued_at, due_at, status, created_at)
       VALUES(?,?,?,?,'EGP',?,?,'unpaid',?)`,
      uid, `U-${Date.now()}`, 500, 50000, at, at, at);

  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jar = new Map();
  take(await fetch(`${BASE}/login`, { redirect: 'manual' }));
  take(await fetch(`${BASE}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: C() },
    body: new URLSearchParams({ email, password: 'كلمة-سر-قوية-جدا-123' }).toString(),
  }));
  assert.ok(jar.get('mkss_sid'), 'لم تُصدَر جلسة — الاختبار كلّه بلا معنى');
  const html = await (await fetch(`${BASE}/billing`, { headers: { Cookie: C() } })).text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'لم نجد رمز CSRF في صفحة الاشتراك');
});

after(() => server?.close());

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000001f15c4890' +
  '000000d4944415478da63fcffff3f0300050001ff9d0d9c0000000049454e44ae426082', 'hex');

test('مسار لا يقبل الرفع يرفض جسمًا كبيرًا ولو حمل ترويسة multipart', async () => {
  // بلا قائمة المسارات المسموحة كان يكفي أن يكتب أحدٌ الترويسة على أي نموذج
  // ليفتح لنفسه مئة ضعف الحدّ في مسار لا يقبل ملفًّا أصلًا.
  const { body, ctype } = multipart({ _csrf: csrf, body: 'مرحبًا' }, Buffer.alloc(300 * 1024, 0x41));
  const r = await fetch(`${BASE}/chat/new`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': ctype, Cookie: C() }, body,
  });
  assert.equal(r.status, 413, 'مرّ جسم ٣٠٠ كيلوبايت إلى مسار محادثة');
});

test('الاتصال يبقى صالحًا بعد رفض ٤١٣', async () => {
  // العيب الذي أوجب هذا الاختبار: بعد ‎413‎ تبقى بقيّة البايتات في المقبس،
  // فيقرأها ‎keep-alive‎ على أنها الطلب التالي. الطلب السليم بعده كان يموت
  // بـ‎fetch failed‎ — فيبدو للمستخدم أن الموقع سقط لأنه رفع ملفًّا كبيرًا.
  const big = multipart({ _csrf: csrf, body: 'كبير' }, Buffer.alloc(300 * 1024, 0x41));
  await fetch(`${BASE}/chat/new`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': big.ctype, Cookie: C() }, body: big.body,
  });
  const after = await fetch(`${BASE}/billing`, { headers: { Cookie: C() }, redirect: 'manual' });
  assert.equal(after.status, 200, 'الطلب التالي بعد ٤١٣ لم يصل');
});

test('رفع إيصال سليم يُسجَّل، ويصل الأدمن غيرَ مقروء', async () => {
  const { body, ctype } = multipart(
    { _csrf: csrf, method: 'instapay', amount: '500.00', senderRef: '01000000009' }, PNG);
  const r = await fetch(`${BASE}/billing/claim`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': ctype, Cookie: C() }, body,
  });
  assert.equal(r.status, 303);

  const claim = get("SELECT * FROM payment_claims WHERE sender_ref = '01000000009'");
  assert.ok(claim, 'لم يُسجَّل الإشعار');
  assert.match(claim.receipt_name, /^[0-9a-f]{32}\.png$/, 'اسم الإيصال ليس اسم تخزين');
  assert.equal(claim.receipt_type, 'image/png');

  // هذا هو بيت القصيد: الإشعار كان يهبط ‎read_by_admin = 1‎ و‎internal‎، فلا
  // يرفع عدّادًا ولا يظهر في معاينة المحادثة — أي أنه لم يكن يصل.
  const msg = get(`SELECT * FROM chat_messages WHERE body LIKE '%01000000009%' ORDER BY id DESC LIMIT 1`);
  assert.ok(msg, 'لم تصل رسالة إلى المحادثة');
  assert.equal(msg.read_by_admin, 0, 'الإشعار هبط مقروءًا فلا ينبّه أحدًا');
  assert.equal(msg.visibility, 'all', 'الإشعار داخليّ فلا يظهر في قائمة المحادثات');
  assert.equal(JSON.parse(msg.meta).receiptName, claim.receipt_name, 'رابط الإيصال لا يشير إلى الملفّ');
});

test('ملفّ يدّعي أنه صورة يُرفض ولا يُسجَّل إشعارٌ بلا إيصال', async () => {
  const before = get("SELECT COUNT(*) n FROM payment_claims").n;
  const { body, ctype } = multipart(
    { _csrf: csrf, method: 'vodafone', amount: '7.00' }, Buffer.from('<?php system($_GET[0]); ?>'));
  const r = await fetch(`${BASE}/billing/claim`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': ctype, Cookie: C() }, body,
  });
  assert.equal(r.status, 303);
  const flash = decodeURIComponent((/mkss_flash=([^;]*)/.exec(r.headers.getSetCookie().join(';')) || [])[1] || '');
  assert.match(flash, /نقبل صورة/, 'لم تُعرض رسالة الرفض');
  // ولا يُسجَّل شيء: إشعارٌ بلا إيصال هنا يعني أن العميل يظنّ صورته وصلت.
  assert.equal(get("SELECT COUNT(*) n FROM payment_claims").n, before, 'سُجِّل إشعار رغم رفض الملفّ');
});

test('رفع بلا رمز CSRF يُرفض', async () => {
  const { body, ctype } = multipart({ _csrf: 'غير-صحيح', method: 'instapay', amount: '1.00' }, PNG);
  const r = await fetch(`${BASE}/billing/claim`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': ctype, Cookie: C() }, body,
  });
  assert.equal(r.status, 403);
});

// اختبارات الرفع — البارسر، وفحص التوقيع، والتخزين.
//
// ما تحرسه: أن ملفًّا يدّعي أنه صورة لا يُقبل لأنه ادّعى، وأن اسم الملفّ
// الوارد من المستخدم لا يصل إلى القرص أبدًا، وأن سقف الحجم يُطبَّق أثناء
// التدفّق لا بعده. كلها أخطاء تمرّ صامتةً من أي اختبار وظيفي.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readMultipart } from '../src/http-util.js';
import * as uploads from '../src/uploads.js';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000001f15c4890' +
  '000000d4944415478da63fcffff3f0300050001ff9d0d9c0000000049454e44ae426082', 'hex');
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(20)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20)]);

/** يبني طلبًا متعدّد الأجزاء كما يرسله المتصفّح تمامًا */
function req(fields, files = [], boundary = '----mkssTEST') {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.ctype}\r\n\r\n`));
    parts.push(f.bytes, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const r = Readable.from([Buffer.concat(parts)]);
  r.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return r;
}

test('البارسر يفصل الحقول عن الملفّات ولا يُفسد البايتات', async () => {
  const { fields, files } = await readMultipart(
    req({ _csrf: 'T', method: 'instapay', amount: '120.50' },
        [{ field: 'receipt', filename: 'a.png', ctype: 'image/png', bytes: PNG }]));
  assert.equal(fields._csrf, 'T');
  assert.equal(fields.amount, '120.50');
  assert.equal(files.length, 1);
  // المساواة بايتًا ببايت: القراءة نصًّا بترميز ‎utf8‎ تُفسد الصورة بصمت،
  // وطولٌ صحيح مع محتوى تالف يمرّ من أي فحص أضعف من هذا.
  assert.ok(files[0].bytes.equals(PNG), 'بايتات الصورة تغيّرت في الطريق');
});

test('النوع يُقرأ من التوقيع لا من ترويسة الطلب', async () => {
  const { files } = await readMultipart(
    req({}, [{ field: 'receipt', filename: 'x.png', ctype: 'image/png',
               bytes: Buffer.from('<?php system($_GET[0]); ?>') }]));
  assert.equal(files[0].type, null, 'صُدِّقت الترويسة بدل التوقيع');
  assert.throws(() => uploads.save(files[0]), /صورة|PDF/);
});

test('الأنواع الثلاثة المقبولة تُعرف بتواقيعها', async () => {
  const { files } = await readMultipart(req({}, [
    { field: 'a', filename: 'a.png', ctype: 'application/octet-stream', bytes: PNG },
    { field: 'b', filename: 'b.jpg', ctype: 'text/plain', bytes: JPEG },
    { field: 'c', filename: 'c.pdf', ctype: 'image/png', bytes: PDF },
  ]));
  assert.deepEqual(files.map((f) => f.type), ['image/png', 'image/jpeg', 'application/pdf']);
});

test('حقل ملفّ فارغ لا يُحسب ملفًّا', async () => {
  // المتصفّح يرسل الجزء بـ‎filename=""‎ حين لا يختار المستخدم شيئًا. عدُّه
  // ملفًّا يعني رفض النموذج كلّه على من لم يرد أن يرفع أصلًا.
  const { files, fields } = await readMultipart(
    req({ amount: '10' }, [{ field: 'receipt', filename: '', ctype: 'application/octet-stream', bytes: Buffer.alloc(0) }]));
  assert.equal(files.length, 0);
  assert.equal(fields.amount, '10');
});

test('اسم الملفّ الوارد لا يصل إلى القرص', () => {
  const dir = uploads.uploadsDir();
  const saved = uploads.save({ bytes: PNG, type: 'image/png', ext: 'png' });
  try {
    // الاسم عشوائي ١٦ بايت + امتداد من جدول السماح — لا أثر لما أرسله أحد.
    assert.match(saved.name, /^[0-9a-f]{32}\.png$/);
    assert.ok(existsSync(join(dir, saved.name)));
    assert.equal(saved.type, 'image/png');
    assert.equal(saved.bytes, PNG.length);
    // والقراءة ترجع البايتات نفسها
    assert.ok(uploads.read(saved.name).bytes.equals(PNG));
  } finally {
    uploads.remove(saved.name);
  }
});

test('القراءة ترفض كل اسم لا يطابق نمط التخزين', () => {
  for (const bad of ['../../data/mkss.db', 'demo.db', '..%2Fx.png', 'abc.png',
                     '/etc/passwd', `${'0'.repeat(32)}.php`, '']) {
    assert.equal(uploads.read(bad), null, `مرّ اسم خطر: ${bad}`);
    assert.equal(uploads.remove(bad), false, `حُذف باسم خطر: ${bad}`);
  }
});

test('سقف الحجم يقطع قبل أن يُخزَّن الفائض', async () => {
  const big = Buffer.alloc(200 * 1024, 0x41);
  await assert.rejects(
    () => readMultipart(req({}, [{ field: 'receipt', filename: 'b.png', ctype: 'image/png', bytes: big }]),
                        { maxBytes: 64 * 1024 }),
    (e) => e.status === 413
  );
});

test('سقف عدد الأجزاء يمنع نموذجًا بألف حقل صغير', async () => {
  const many = {};
  for (let i = 0; i < 60; i++) many[`f${i}`] = 'x';
  await assert.rejects(() => readMultipart(req(many), { maxParts: 24 }), (e) => e.status === 400);
});

test('طلب بلا حدّ فاصل يُرفض لا يُفسَّر', async () => {
  const r = Readable.from([Buffer.from('whatever')]);
  r.headers = { 'content-type': 'multipart/form-data' };
  await assert.rejects(() => readMultipart(r), (e) => e.status === 400);
});

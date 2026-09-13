// اختبار حارس SSRF — كل حالة هنا ناقل هجوم حقيقي.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl, ipBlockReason } from '../src/checks/guard.js';
import { fetchSite } from '../src/checks/fetch.js';
import { startFixtureServer } from './fixtures.js';

const MUST_BLOCK = [
  ['http://127.0.0.1/', 'الجهاز نفسه'],
  ['http://127.0.0.2:80/', 'نطاق loopback كامل'],
  ['http://169.254.169.254/latest/meta-data/', 'بيانات اعتماد السحابة'],
  ['http://10.0.0.5/', 'شبكة خاصة 10.x'],
  ['http://172.16.0.1/', 'شبكة خاصة 172.16.x'],
  ['http://192.168.1.1/', 'شبكة خاصة 192.168.x'],
  ['http://100.64.0.1/', 'شبكة مزوّد مشتركة'],
  ['http://0.0.0.0/', 'عنوان غير محدد'],
  ['http://[::1]/', 'loopback على IPv6'],
  ['http://[fe80::1]/', 'محلي بالوصلة'],
  ['http://[fc00::1]/', 'شبكة خاصة IPv6'],
  ['http://[::ffff:127.0.0.1]/', 'IPv4 مغلّف داخل IPv6'],
  ['http://[::ffff:169.254.169.254]/', 'بيانات اعتماد مغلّفة'],
  ['http://[2002:7f00:1::]/', 'نفق 6to4 يغلّف loopback'],
  ['http://[64:ff9b::a00:1]/', 'نفق NAT64 يغلّف شبكة خاصة'],
  ['file:///etc/passwd', 'بروتوكول ملفات'],
  ['ftp://example.com/', 'بروتوكول FTP'],
  ['gopher://example.com/', 'بروتوكول gopher'],
  ['http://example.com:22/', 'منفذ SSH'],
  ['http://example.com:6379/', 'منفذ Redis'],
  ['http://user:pass@example.com/', 'بيانات دخول في الرابط'],
  ['not-a-url', 'نص ليس رابطًا'],
];

test('يحظر كل ناقلات SSRF المعروفة', async (t) => {
  for (const [url, why] of MUST_BLOCK) {
    await t.test(`${why}: ${url}`, async () => {
      const r = await assertSafeUrl(url);
      assert.equal(r.ok, false, `نفذ رابط كان يجب حظره: ${url}`);
      assert.ok(r.reason, 'الحظر بلا سبب مكتوب');
    });
  }
});

test('يسمح بالعناوين العامة', async () => {
  const r = await assertSafeUrl('http://8.8.8.8/');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.ip, '8.8.8.8');
});

test('يصنّف العناوين تصنيفًا صحيحًا على مستوى الـ IP', () => {
  assert.ok(ipBlockReason('127.0.0.1'));
  assert.ok(ipBlockReason('169.254.169.254'));
  assert.ok(ipBlockReason('192.168.0.1'));
  assert.equal(ipBlockReason('8.8.8.8'), null);
  assert.equal(ipBlockReason('1.1.1.1'), null);
  assert.ok(ipBlockReason('ليس عنوانًا'));
});

test('يحظر التحويل من موقع عام إلى عنوان داخلي', async () => {
  const { server, base } = await startFixtureServer();
  try {
    // السيرفر المحلي مسموح في وضع الاختبار، لكنه يحوّل لعنوان بيانات اعتماد السحابة.
    // الحارس يجب أن يعيد الفحص بعد التحويلة ويرفضها.
    const res = await fetchSite(`${base}/__redirect_to_internal`, { allowPrivate: true });
    assert.equal(res.blocked, true, 'نفذ التحويل لعنوان داخلي — ثغرة SSRF');
    assert.match(res.error, /محظور|داخلي/);
  } finally {
    server.close();
  }
});

test('وضع الاختبار يسمح بالـ loopback فقط ويظل يحظر ما عداه', async () => {
  const ok = await assertSafeUrl('http://127.0.0.1:45000/', { allowPrivate: true });
  assert.equal(ok.ok, true, 'كان يجب السماح بالـ loopback في وضع الاختبار');
  const blocked = await assertSafeUrl('http://169.254.169.254/', { allowPrivate: true });
  assert.equal(blocked.ok, false, 'وضع الاختبار يجب ألا يفتح الباب لبيانات اعتماد السحابة');
});

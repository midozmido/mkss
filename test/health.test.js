// اختبار معادلة درجة الصحة وحالاتها الحدّية.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, grade, WEIGHTS } from '../src/checks/run.js';
import { evaluateHeaders } from '../src/checks/headers.js';
import { startFixtureServer } from './fixtures.js';

test('أوزان الدرجة تجمع 100 بالضبط', () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
});

test('التقديرات تنطبق على الحدود الصحيحة', () => {
  assert.equal(grade(100).key, 'excellent');
  assert.equal(grade(90).key, 'excellent');
  assert.equal(grade(89).key, 'good');
  assert.equal(grade(75).key, 'good');
  assert.equal(grade(60).key, 'attention');
  assert.equal(grade(40).key, 'problems');
  assert.equal(grade(0).key, 'critical');
});

test('موقع لا يفتح تكون درجته صفرًا مهما كان الباقي', async () => {
  const r = await runCheck('https://لا-يوجد-mkss.test/');
  assert.equal(r.health.score, 0);
  assert.ok(r.health.capped, 'لم يُذكر سبب تصفير الدرجة');
  assert.ok(r.health.findings.some((f) => f.level === 'critical'));
});

test('رابط يشير لعنوان داخلي يُرفض ويُبلَّغ عنه', async () => {
  const r = await runCheck('http://169.254.169.254/');
  assert.equal(r.blocked, true);
  assert.equal(r.health.score, 0);
  assert.ok(r.health.findings.some((f) => f.area === 'security'));
});

test('موقع HTTP بلا تشفير: الدرجة محدودة ويظهر سبب واضح', async () => {
  const { server, base } = await startFixtureServer();
  try {
    const r = await runCheck(`${base}/wordpress`, { allowPrivate: true });
    assert.equal(r.ok, true, `الموقع لم يُقرأ: ${r.error}`);
    assert.ok(r.health.score <= 60, `درجة ${r.health.score} لموقع بلا تشفير`);
    const sslFinding = r.health.findings.find((f) => f.area === 'ssl');
    assert.ok(sslFinding, 'لم تُذكر مشكلة غياب التشفير');
    assert.ok(sslFinding.fix, 'الملاحظة بلا حل مقترح');
    assert.equal(r.tls.applicable, false);
    assert.equal(r.fingerprint.platform.key, 'wordpress');
  } finally {
    server.close();
  }
});

test('خطأ 500 يخفض التشغيل ويظهر كملاحظة حرجة', async () => {
  const { server, base } = await startFixtureServer();
  try {
    const r = await runCheck(`${base}/__error500`, { allowPrivate: true });
    assert.equal(r.status, 500);
    assert.equal(r.ok, false);
    assert.equal(r.health.breakdown.uptime, 10);
    assert.ok(r.health.findings.some((f) => f.area === 'uptime' && f.level === 'critical'));
  } finally {
    server.close();
  }
});

test('كل ملاحظة لها حل مقترح مكتوب بالعربي', async () => {
  const { server, base } = await startFixtureServer();
  try {
    const r = await runCheck(`${base}/custom`, { allowPrivate: true });
    assert.ok(r.health.findings.length > 0, 'موقع بلا أي هيدر أمان يجب أن ينتج ملاحظات');
    for (const f of r.health.findings) {
      assert.ok(f.problem, 'ملاحظة بلا وصف');
      assert.ok(f.fix, `ملاحظة بلا حل: ${f.problem}`);
      assert.ok(/[؀-ۿ]/.test(f.fix), `الحل ليس بالعربي: ${f.fix}`);
    }
  } finally {
    server.close();
  }
});

test('هيدرات الأمان: موقع محصّن 100 وموقع مهمَل صفر', () => {
  const strong = evaluateHeaders(
    {
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'geolocation=()',
    },
    true
  );
  assert.equal(strong.score, 100);
  const weak = evaluateHeaders({ server: 'Apache/2.4.29', 'x-powered-by': 'PHP/7.4' }, true);
  assert.equal(weak.score, 0);
  assert.equal(weak.leaks.length, 2, 'لم تُكتشف تسريبات نسخة السيرفر');
});

test('HSTS لا يُحاسب عليه موقع HTTP (لا معنى له بدون تشفير)', () => {
  const onHttp = evaluateHeaders({ 'x-content-type-options': 'nosniff' }, false);
  const onHttps = evaluateHeaders({ 'x-content-type-options': 'nosniff' }, true);
  assert.ok(onHttp.possible < onHttps.possible, 'HSTS حُوسب على موقع HTTP');
});

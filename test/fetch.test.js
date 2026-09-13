// اختبار متانة الجالب — حالات فشل حقيقية يتعرض لها أي نظام مراقبة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSite, MAX_BODY } from '../src/checks/fetch.js';
import { startFixtureServer } from './fixtures.js';

const OPTS = { allowPrivate: true };

test('يتعامل مع كل حالات الفشل بدون انهيار', async (t) => {
  const { server, base } = await startFixtureServer();
  try {
    await t.test('خطأ 500 يُقرأ ولا يُعتبر انهيارًا', async () => {
      const r = await fetchSite(`${base}/__error500`, OPTS);
      assert.equal(r.error, undefined);
      assert.equal(r.status, 500);
    });

    await t.test('404 يُقرأ بشكل صحيح', async () => {
      const r = await fetchSite(`${base}/__nothing`, OPTS);
      assert.equal(r.status, 404);
    });

    await t.test('المهلة تُحترم ولا تعلّق النظام', async () => {
      const started = Date.now();
      const r = await fetchSite(`${base}/__slow`, { ...OPTS, timeout: 1000 });
      const took = Date.now() - started;
      assert.equal(r.errorCode, 'TIMEOUT');
      assert.ok(took < 3000, `المهلة لم تُحترم — استغرق ${took}ms`);
    });

    await t.test('حلقة التحويلات المفرغة تُكتشف ولا تدور للأبد', async () => {
      const r = await fetchSite(`${base}/__loop`, OPTS);
      assert.ok(r.error, 'لم تُكتشف حلقة التحويلات');
      assert.ok(r.redirects <= 6, `تتبع ${r.redirects} تحويلة — الحد 5`);
    });

    await t.test('سلسلة تحويلات أطول من الحد تتوقف', async () => {
      const r = await fetchSite(`${base}/__chain?n=0`, OPTS);
      assert.equal(r.errorCode, 'TOO_MANY_REDIRECTS');
    });

    await t.test('الرد الضخم يُقتطع عند الحد ولا يستهلك الذاكرة', async () => {
      const r = await fetchSite(`${base}/__huge`, OPTS);
      assert.equal(r.truncated, true, 'لم يُقتطع رد بحجم 4 ميجا');
      assert.ok(
        Buffer.byteLength(r.body) <= MAX_BODY + 1024,
        `الجسم المحفوظ ${Buffer.byteLength(r.body)} بايت — يتجاوز الحد`
      );
    });

    await t.test('يقيس زمن أول بايت والزمن الكلي', async () => {
      const r = await fetchSite(`${base}/wordpress`, OPTS);
      assert.equal(typeof r.ttfb, 'number');
      assert.ok(r.ttfb >= 0 && r.ttfb < 5000);
      assert.ok(r.total >= r.ttfb, 'الزمن الكلي أقل من زمن أول بايت');
    });
  } finally {
    server.close();
  }
});

test('الدومين غير الموجود يعطي رسالة عربية مفهومة', async () => {
  const r = await fetchSite('https://لا-يوجد-هذا-الدومين-اطلاقا-mkss.test/');
  assert.ok(r.error, 'لم يُبلَّغ عن خطأ');
  assert.ok(/[؀-ۿ]/.test(r.error), `الرسالة ليست بالعربي: ${r.error}`);
});

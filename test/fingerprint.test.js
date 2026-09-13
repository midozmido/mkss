// اختبار محرك البصمات — يتحقق أن كل منصة تُكتشف، وأن المواقع المخصصة لا تُخمَّن خطأً.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/checks/fingerprint.js';
import { fetchSite } from '../src/checks/fetch.js';
import { FIXTURES, asResponse, startFixtureServer } from './fixtures.js';

test('يكتشف كل منصة من تجهيزاتها', async (t) => {
  for (const [name, fx] of Object.entries(FIXTURES)) {
    await t.test(name, () => {
      const fp = fingerprint(asResponse(fx));
      if (fx.expect === null) {
        assert.equal(
          fp.platform,
          null,
          `${name}: كان يجب ألا يُخمَّن، لكنه قال "${fp.platform?.label}" بثقة ${fp.platform?.confidence}%`
        );
      } else {
        assert.ok(fp.platform, `${name}: لم يُكتشف أي منصة`);
        assert.equal(fp.platform.key, fx.expect, `${name}: اكتُشف "${fp.platform.key}" بدل "${fx.expect}"`);
        assert.ok(fp.platform.confidence >= 40, `${name}: ثقة منخفضة (${fp.platform.confidence}%)`);
      }
      if (fx.expectAddon) {
        assert.ok(
          fp.addons.some((a) => a.key === fx.expectAddon),
          `${name}: لم تُكتشف الإضافة "${fx.expectAddon}"`
        );
      }
    });
  }
});

test('يستخرج نسخة ووردبريس من وسم generator', () => {
  const fp = fingerprint(asResponse(FIXTURES.wordpress));
  assert.equal(fp.platform.version, '6.5.2');
});

test('يكتشف التقنيات الإضافية (Elementor / jQuery)', () => {
  const fp = fingerprint(asResponse(FIXTURES.wordpress));
  const keys = fp.extras.map((e) => e.key);
  assert.ok(keys.includes('elementor'), 'لم يكتشف Elementor');
  assert.ok(keys.includes('jquery'), 'لم يكتشف jQuery');
});

test('لا يقع في فخ image/ الذي يشبه mage/ الخاص بماجنتو', () => {
  const fp = fingerprint(asResponse(FIXTURES.imageTrap));
  assert.equal(fp.platform, null, `خمّن "${fp.platform?.label}" من مجرد وجود مسارات صور`);
});

test('يقرأ اتجاه الصفحة ولغتها ووسم viewport', () => {
  const fp = fingerprint(asResponse(FIXTURES.wordpress));
  assert.equal(fp.lang, 'ar');
  assert.equal(fp.isRTL, true);
  assert.equal(fp.hasViewport, true);
});

test('من طرف لطرف: يجلب من سيرفر محلي ويبصم بشكل صحيح', async () => {
  const { server, base } = await startFixtureServer();
  try {
    for (const name of ['wordpress', 'shopify', 'salla', 'zid', 'drupal']) {
      const res = await fetchSite(`${base}/${name}`, { allowPrivate: true });
      assert.ok(!res.error, `${name}: فشل الجلب — ${res.error}`);
      const fp = fingerprint(res);
      assert.equal(fp.platform?.key, FIXTURES[name].expect, `${name}: بصمة خاطئة عبر الشبكة`);
    }
  } finally {
    server.close();
  }
});

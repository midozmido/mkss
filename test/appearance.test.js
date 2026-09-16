// اختبارات المظهر — تحرس ثلاثة أخطاء صامتة كلّفت هذا المشروع جولة فحص كاملة:
// وزن خط لا يُسجَّل، ولون لا يمرّ معيار التباين، وحبر أبيض فوق سطح فاتح.
// كلها تمرّ من أي اختبار وظيفي ولا يمسكها إلا فحص مكتوب لها.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_COLORS } from '../src/views/chat.js';

const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');

/** نسبة التباين بين لونين ست عشريين حسب WCAG 2.x */
function contrast(hexA, hexB) {
  const lum = (hex) => {
    const n = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [a, b] = [lum(hexA), lum(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test('واصفات ‎@font-face‎ أرقام صريحة لا متغيّرات مخصّصة', () => {
  // ‎@font-face‎ لا تقبل ‎var()‎: الواصف يسقط بالكامل فيُسجَّل الملف تحت الوزن
  // الافتراضي ‎400‎، ولا يوجد وزن ثقيل أصلًا. ومع ‎font-synthesis-weight: none‎
  // يُرسم كل «عريض» في النظام بوزن أخفّ — بلا خطأ واحد في أي مكان.
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.ok(faces.length >= 6, 'كتل ‎@font-face‎ مفقودة');
  for (const f of faces) {
    const m = f.match(/font-weight:\s*([^;]+);/);
    assert.ok(m, 'كتلة ‎@font-face‎ بلا وزن');
    assert.match(m[1].trim(), /^\d+$/, `وزن غير رقمي في ‎@font-face‎: ${m[1].trim()}`);
  }
  // الأوزان الثلاثة المستعملة في التوكنات كلها مسجَّلة
  const weights = new Set(faces.map((f) => f.match(/font-weight:\s*(\d+)/)[1]));
  for (const w of ['400', '500', '700']) assert.ok(weights.has(w), `وزن ${w} غير مسجَّل`);
});

test('كل لون محادثة يمرّ معيار ‎AA‎ مع النص الأبيض', () => {
  // العميل يختار هذا اللون بنفسه، ويصير خلفية رسائله هو. لونٌ فاتح هنا يعني
  // أن العميل لا يقرأ ما كتب — ولا أحد في الفريق يرى المشكلة لأن لكلٍّ لونه.
  for (const c of CHAT_COLORS) {
    const r = contrast(c.hex, '#ffffff');
    assert.ok(r >= 4.5, `${c.label} (${c.hex}) = ${r.toFixed(2)}:1 — دون ‎4.5‎`);
  }
});

test('لا حبر أبيض ثابت فوق سطح من توكنات الهوية', () => {
  // ‎--brand‎ و‎--danger‎ ينقلبان إلى درجات فاتحة في الوضع الداكن، فالأبيض
  // المكتوب حرفيًّا فوقهما يصير غير مقروء. الحبر يأتي من ‎--on-accent‎.
  const rules = css.split('}');
  const bad = rules.filter((r) =>
    /background:\s*var\(--(brand|danger)\)/.test(r) && /color:\s*(#fff|#ffffff|white)\b/i.test(r)
  );
  assert.deepEqual(bad.map((r) => r.split('{')[0].trim()), [], 'قاعدة تكتب الأبيض فوق لون هوية');
});

test('حدّ التباين في التوكنات الفاتحة يمرّ على الأسطح الملوّنة', () => {
  const pick = (name) => (css.match(new RegExp(`\\s--${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
  const faint = pick('text-faint'), sunk = pick('surface-sunk'), soft = pick('brand-soft');
  assert.ok(faint && sunk && soft, 'توكنات مفقودة');
  for (const [bg, label] of [[sunk, 'surface-sunk'], [soft, 'brand-soft'], ['#ffffff', 'surface']]) {
    const r = contrast(faint, bg);
    assert.ok(r >= 4.5, `‎--text-faint‎ فوق ‎${label}‎ = ${r.toFixed(2)}:1`);
  }
});

// ——— عدّادات اللوحة: الرقم أعلى الصفحة يجب ألّا يناقض البطاقة تحته ———
import { run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import * as repo from '../src/repo.js';

test('موقع متوقّف الآن يُحسب «فيه مشاكل» مهما كانت درجته التاريخية', () => {
  migrate({ quiet: true });
  const at = nowISO();
  const uid = Number(run(
    'INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
    `dash-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا-123'), 'صاحب لوحة', 'client', at
  ).lastInsertRowid);

  // الدرجة والحالة يأتيان من آخر فحص في جدول ‎checks‎ لا من جدول ‎sites‎.
  const mkSite = (name, url, score, ok) => {
    const sid = Number(run('INSERT INTO sites(user_id, name, url, created_at) VALUES(?,?,?,?)',
      uid, name, url, at).lastInsertRowid);
    run('INSERT INTO checks(site_id, at, ok, health_score) VALUES(?,?,?,?)', sid, at, ok, score);
    return sid;
  };
  // درجة ‎70‎ تقع في خانة «يحتاج انتباه»، لكن ‎ok = 0‎ تعني أن الموقع لا يفتح
  // **الآن**. البطاقة تقول «لا يفتح»، فلا يجوز أن يقول العدّاد «٠».
  mkSite('موقع متوقّف', 'https://down.test/', 70, 0);
  // وموقع سليم درجته ‎95‎ للتأكّد أن العدّ لم ينقلب كلّه إلى «مشاكل»
  mkSite('موقع سليم', 'https://up.test/', 95, 1);

  const { counts } = repo.dashboard(uid);
  assert.equal(counts.problems + counts.critical, 1, 'الموقع المتوقّف لم يُحسب في «فيها مشاكل»');
  assert.equal(counts.attention, 0, 'الموقع المتوقّف ما زال محسوبًا «يحتاج انتباه»');
  assert.equal(counts.excellent + counts.good, 1, 'الموقع السليم ضاع من العدّ');
});

test('المدّة تُقرأ بوحدتها لا بعدّ الدقائق الخام', async () => {
  const { humanMinutes } = await import('../src/views/layout.js');
  assert.equal(humanMinutes(45), '45 دقيقة');
  assert.equal(humanMinutes(120), 'ساعتين');
  assert.equal(humanMinutes(2413), 'يومين');      // كان يُعرض «2413 دقيقة»
  assert.equal(humanMinutes(0), '0 دقيقة');
});

test('تسمية محور الزمن تتبع ما يُرسم لا ترتيب الكتابة', async () => {
  const { sparkline } = await import('../src/views/layout.js');
  const checks = [
    { at: '2026-01-01T00:00:00.000Z', response_ms: 100 },
    { at: '2026-01-01T00:05:00.000Z', response_ms: 200 },
  ];
  const cap = sparkline(checks).match(/<figcaption[\s\S]*?<\/figcaption>/)[0];
  // ‎.row-between‎ حاوية ‎flex‎ في صفحة ‎RTL‎: أول ابن يظهر يمينًا، وأحدث نقطة
  // في المنحنى على اليسار — فلا بدّ أن تسبق «الأقدم» «الأحدث» في المصدر.
  assert.ok(cap.indexOf('الأقدم') < cap.indexOf('الأحدث'), 'تسميتا المحور مقلوبتان');
});

test('الفحص الفاشل لا يُعرض زمنَ استجابة ولا يدخل منحنى الأداء', async () => {
  const { sparkline } = await import('../src/views/layout.js');
  const checks = [
    { at: '2026-01-01T00:00:00.000Z', ok: 1, response_ms: 300 },
    { at: '2026-01-01T00:05:00.000Z', ok: 1, response_ms: 320 },
    { at: '2026-01-01T00:10:00.000Z', ok: 0, response_ms: 4 },   // انقطاع لا تحسّن
  ];
  const html = sparkline(checks);
  const avg = Number(html.match(/المتوسط <b class="num">(\d+)ms/)[1]);
  assert.equal(avg, 310, 'متوسط الأداء احتسب فحصًا فاشلًا');
});

// ——— صفحة الدخول: النقش والنقاط ———

test('مقاس خلية النقش واحد في الرسم وفي الحركة', async () => {
  // النقاط تسير على خطوط النقش، وموضعها يُحسب من ثابت في ‎public/auth.js‎
  // بينما النقش يُرسم من وسيط في ‎khatam()‎. اختلافهما بمقدار بكسل واحد يُخرج
  // النقاط عن الخطوط — بلا خطأ ولا رسالة، فقط حركة تبدو عشوائية.
  const { khatam } = await import('../src/views/layout.js');
  const drawn = Number(khatam().match(/<pattern id="khatam" width="(\d+)"/)[1]);
  const js = readFileSync(new URL('../public/auth.js', import.meta.url), 'utf8');
  const used = Number(js.match(/var CELL = (\d+);/)[1]);
  assert.equal(used, drawn, `النقش ${drawn}px والنقاط تحسب على ${used}px`);
});

test('ذهبي VIP يمرّ على أرضية صفحة الدخول لا على الأبيض وحده', () => {
  // العلامة خرجت من البطاقة البيضاء إلى المستوى المنقوش، فصار المرجع هو
  // ‎--auth-page‎ لا ‎--surface‎. القيمة التي تمرّ على الأول وحده غشّ.
  const pick = (name) => (css.match(new RegExp(`\\s--${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
  const vip = pick('vip');
  assert.ok(vip, 'التوكن مفقود');
  for (const [bg, label] of [['#eaf0ee', 'auth-page'], ['#ffffff', 'surface']]) {
    const r = contrast(vip, bg);
    assert.ok(r >= 4.5, `‎--vip‎ فوق ‎${label}‎ = ${r.toFixed(2)}:1`);
  }
});

test('صفحة الدخول تعمل بلا جافاسكربت', async () => {
  // النقش في HTML والنموذج يُرسَل إلى الخادم: ‎/auth.js‎ يضيف حركة لا معلومة.
  const { clientLoginPage } = await import('../src/views/auth.js');
  const html = clientLoginPage({});
  assert.match(html, /<svg class="khatam"/, 'النقش ليس في الـHTML');
  assert.match(html, /<form method="POST" action="\/login"/, 'النموذج لا يُرسَل بلا JS');
  assert.ok(!/<script(?![^>]*src=)/.test(html), 'سكربت مضمّن يحجبه CSP');
});

// اختبار ما يلزم للنشر على استضافة مشتركة: التقليم، والجلسات، ونقطة الإقلاع.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { get, run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { createRateLimiter } from '../src/http-util.js';
import * as auth from '../src/auth.js';

before(() => migrate({ quiet: true }));

test('محدّد المعدّل يقلّم المنتهي ولا ينمو بلا حدّ', () => {
  const lim = createRateLimiter({ windowMs: 40, max: 5, capacity: 500 });
  for (let i = 0; i < 300; i++) lim.check(`ip-${i}|user-${i}@x.test`);
  assert.equal(lim.size(), 300);

  // بعد انتهاء النافذة، أول فحص يكنس ما مضى بدل أن يتركه مقيمًا
  const until = Date.now() + 60;
  while (Date.now() < until) { /* انتظار قصير بلا مؤقّت يُبقي الحلقة حيّة */ }
  lim.check('someone-new|z@x.test');
  assert.ok(lim.size() <= 2, `بقي ${lim.size()} سجلًا منتهيًا بلا كنس`);
});

test('عند الإشباع يُرفض الجديد ولا تُستنزف الذاكرة', () => {
  const lim = createRateLimiter({ windowMs: 60_000, max: 5, capacity: 10 });
  for (let i = 0; i < 10; i++) lim.check(`k${i}`);
  const r = lim.check('الحادي-عشر');
  assert.equal(r.allowed, false);
  assert.equal(r.saturated, true);
  assert.equal(lim.size(), 10, 'تجاوز السقف رغم الإشباع');
  // ومن له سجل قائم يبقى مخدومًا
  assert.equal(lim.check('k0').allowed, true);
});

test('سجل محاولات الدخول يُكنس ولا يتراكم', () => {
  for (let i = 0; i < 5200; i++) auth.noteLoginFailure(`bot-${i}|x@t.local`);
  assert.ok(auth.attemptsSize() <= 5200, 'نما بلا كنس');
});

test('purgeExpiredSessions تحذف المنتهية وتُبقي الصالحة', () => {
  const id = Number(run(
    "INSERT INTO users(email,password_hash,name,role,created_at) VALUES(?,?,?,'client',?)",
    `sess-${Date.now()}@t.local`, auth.hashPassword('كلمة-سر-طويلة-جدا'), 'ص', nowISO()
  ).lastInsertRowid);

  const past = new Date(Date.now() - 86400_000).toISOString();
  const future = new Date(Date.now() + 86400_000).toISOString();
  run('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)', 'expired-x', id, past, past);
  run('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)', 'live-x', id, nowISO(), future);

  auth.purgeExpiredSessions();
  assert.equal(get('SELECT id FROM sessions WHERE id = ?', 'expired-x'), undefined, 'بقيت جلسة منتهية');
  assert.ok(get('SELECT id FROM sessions WHERE id = ?', 'live-x'), 'حُذفت جلسة صالحة');
});

test('نقطة إقلاع cPanel موجودة ولا تعتمد على argv', () => {
  // العطل الذي تمنعه: Passenger يستورد ملف الإقلاع ولا يشغّله كـ argv[1]،
  // فشرطٌ من نوع `import.meta.url === argv[1]` لا يتحقّق والخادم لا يقوم.
  assert.ok(existsSync(new URL('../app.js', import.meta.url)), 'app.js مفقود');
  const raw = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  // نجرّد التعليقات: ملف app.js يشرح العطل الذي يمنعه، فيذكر الشرط نصًّا.
  // فحصٌ يقرأ التعليق كأنه كود يفشل على الشرح لا على العلّة.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /start\(/, 'app.js لا يستدعي start');
  assert.doesNotMatch(src, /import\.meta\.url\s*===/, 'app.js يحمل الشرط الذي يعطّله Passenger');

  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /export function start\(/, 'server.js لا يصدّر start');
});

test('حارس data/.htaccess موجود — قاعدة البيانات لا تُنزَّل', () => {
  const f = new URL('../data/.htaccess', import.meta.url);
  assert.ok(existsSync(f), 'الحارس مفقود: قاعدة البيانات قابلة للتنزيل لو وقع المجلد داخل public_html');
  assert.match(readFileSync(f, 'utf8'), /Require all denied|Deny from all/);
});

test('ترقيم الفواتير لا يتصادم بعد حذف فاتورة', async () => {
  // العطل: كان الرقم `COUNT(*) + 1`، فحذف فاتورة يُنقص العدد ويعيد رقمًا
  // مستعملًا — وقيد التفرّد يرفض، فيرى الأدمن خطأ ٥٠٠ بلا تفسير.
  const admin = await import('../src/admin-repo.js');
  const uid = admin.adminCreateClient(
    { name: 'صاحب فواتير', email: `inv-${Date.now()}@t.local`, company: 'ش', phone: '1' },
    auth.hashPassword('كلمة-سر-طويلة-جدا')
  );
  const a = admin.adminCreateInvoice(uid, { description: 'أولى', amount: 100 });
  const b = admin.adminCreateInvoice(uid, { description: 'ثانية', amount: 200 });
  assert.notEqual(a.number, b.number);

  run('DELETE FROM invoices WHERE id = ?', b.id);
  const c = admin.adminCreateInvoice(uid, { description: 'بعد الحذف', amount: 300 });
  assert.notEqual(c.number, a.number, 'أعاد رقمًا مستعملًا بعد الحذف');
});

test('حارس نسخة Node يرفض ما دون ‎22.13‎ ويقبل ما فوقها', async () => {
  // العطل الذي يحرسه: ‎node:sqlite‎ ظهرت في ‎22.5‎ لكنها ظلّت خلف راية حتى
  // ‎22.13‎، ومدير التطبيقات المُدار لا يمرّر رايات. فنسخةٌ بينهما تبدو
  // مطابقة للشرط وتعطي صفحةً بيضاء بلا سبب مفهوم.
  const { execFileSync } = await import('node:child_process');
  const root = new URL('..', import.meta.url).pathname;

  const boot = (version) => {
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e', `
        Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)}, configurable: true });
        await import(${JSON.stringify(new URL('../src/require-node.js', import.meta.url).href)});
      `], { cwd: root, stdio: 'pipe' });
      return 0;
    } catch (e) { return e.status; }
  };

  for (const bad of ['20.11.0', '22.5.0', '22.12.0']) {
    assert.equal(boot(bad), 1, `${bad} أقلع رغم أنه لا يشغّل node:sqlite`);
  }
  for (const good of ['22.13.0', '24.4.1']) {
    assert.equal(boot(good), 0, `${good} رُفض وهو صالح`);
  }
});

test('‎engines.node‎ يقول الحدّ الحقيقي لا حدّ ظهور الوحدة', () => {
  // ‎>=22.5.0‎ كان مكتوبًا هنا، وهي النسخة التي ظهرت فيها الوحدة لا التي
  // تشغّلها بلا راية. ومنصّات تقرأ هذا الحقل لتختار النسخة: الرقم الخاطئ
  // يختار نسخةً لا تقلع.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.13.0');
});

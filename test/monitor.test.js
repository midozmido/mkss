// اختبار محرك المراقبة — تأكيد الأعطال، منع الإنذار الكاذب، الرفرفة، الفجوات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { all, get, run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { checkSite, recordStartupGap, rollupAndPrune, dueSites } from '../src/monitor.js';
import { hashPassword } from '../src/auth.js';
import { startFixtureServer } from './fixtures.js';

let fixture, userId;
const NET_FINE = async () => false;   // اتصالنا سليم
const NET_DOWN = async () => true;    // اتصالنا منقطع

const mkSite = (url, name) =>
  get(
    'SELECT * FROM sites WHERE id = ?',
    Number(
      run(
        'INSERT INTO sites(user_id, name, url, interval_sec, created_at) VALUES(?,?,?,?,?)',
        userId, name, url, 300, nowISO()
      ).lastInsertRowid
    )
  );
const reload = (id) => get('SELECT * FROM sites WHERE id = ?', id);
const openIncidents = (id) => all('SELECT * FROM incidents WHERE site_id = ? AND resolved = 0', id);

before(async () => {
  migrate({ quiet: true });
  userId = Number(
    run(
      'INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
      `mon-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا'), 'مراقبة', 'client', nowISO()
    ).lastInsertRowid
  );
  fixture = await startFixtureServer();
});

after(() => fixture?.server.close());

test('الفشل الأول لا يُعلَن عطلًا — يُعاد الفحص أولًا', async () => {
  const site = mkSite(`${fixture.base}/__error500`, 'فشل أول');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_FINE });
  assert.equal(reload(site.id).consecutive_failures, 1);
  assert.equal(openIncidents(site.id).length, 0, 'أُعلن عطل من أول فشل — إنذار كاذب محتمل');
});

test('الفشل الثاني المتتالي يُعلن العطل', async () => {
  const site = mkSite(`${fixture.base}/__error500`, 'فشل مؤكد');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_FINE });
  await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_FINE });
  const open = openIncidents(site.id);
  assert.equal(open.length, 1, 'لم يُعلن العطل بعد فشلين');
  assert.equal(open[0].kind, 'server_error');
});

test('لا يُعلن عطل على العميل إذا كان اتصالنا نحن هو المنقطع', async () => {
  const site = mkSite(`${fixture.base}/__error500`, 'شبكتنا');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_DOWN });
  await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_DOWN });
  assert.equal(openIncidents(site.id).length, 0, 'أُعلن عطل بينما المشكلة عندنا — إنذار كاذب');
  const gaps = all('SELECT * FROM monitor_gaps WHERE reason = ?', 'network');
  assert.ok(gaps.length > 0, 'لم تُسجَّل فجوة عند انقطاع اتصالنا');
});

test('عودة الموقع تُغلق العطل وتصفّر العدّاد', async () => {
  const site = mkSite(`${fixture.base}/__error500`, 'يتعافى');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_FINE });
  await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_FINE });
  assert.equal(openIncidents(site.id).length, 1);

  run('UPDATE sites SET url = ? WHERE id = ?', `${fixture.base}/wordpress`, site.id);
  await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_FINE });

  assert.equal(openIncidents(site.id).length, 0, 'العطل لم يُغلق بعد التعافي');
  assert.equal(reload(site.id).consecutive_failures, 0);
});

test('الرفرفة لا تُنتج عشرات الأعطال لنفس المشكلة', async () => {
  const site = mkSite(`${fixture.base}/__error500`, 'يرفرف');
  for (let round = 0; round < 3; round++) {
    await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_FINE });
    await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_FINE });
    run('UPDATE sites SET url = ? WHERE id = ?', `${fixture.base}/wordpress`, site.id);
    await checkSite(reload(site.id), { allowPrivate: true, networkCheck: NET_FINE });
    run('UPDATE sites SET url = ? WHERE id = ?', `${fixture.base}/__error500`, site.id);
  }
  const total = all('SELECT * FROM incidents WHERE site_id = ?', site.id);
  assert.equal(total.length, 1, `أنتجت الرفرفة ${total.length} أعطال بدل عطل واحد`);
});

test('الفحص الناجح يسجّل المنصة على الموقع', async () => {
  const site = mkSite(`${fixture.base}/shopify`, 'متجر');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_FINE });
  const s = reload(site.id);
  assert.equal(s.platform, 'shopify');
  assert.ok(s.platform_confidence >= 40);
});

test('الجدولة تحترم موعد الفحص التالي', async () => {
  const site = mkSite(`${fixture.base}/wordpress`, 'مجدول');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_FINE });
  const s = reload(site.id);
  assert.ok(s.next_check_at, 'لم يُحدَّد موعد فحص تالٍ');
  assert.ok(new Date(s.next_check_at) > new Date(), 'الموعد التالي في الماضي');
  assert.ok(!dueSites(50).some((d) => d.id === site.id), 'موقع فُحص للتو ما زال مستحقًا');
});

test('الفشل الأول يُعيد الجدولة سريعًا لتأكيد العطل', async () => {
  const site = mkSite(`${fixture.base}/__error500`, 'إعادة سريعة');
  await checkSite(site, { allowPrivate: true, networkCheck: NET_FINE });
  const waitMs = new Date(reload(site.id).next_check_at) - Date.now();
  assert.ok(waitMs < 120_000, `انتظار ${Math.round(waitMs / 1000)} ثانية قبل تأكيد العطل — طويل`);
});

test('فجوة الإقلاع تُسجَّل عند انقطاع طويل', () => {
  // الفجوة تخص توقف المراقب كله، لا موقعًا بعينه — فنحاكي الحالة الحقيقية:
  // المراقب كان متوقفًا، فكل الفحوصات قديمة.
  const site = mkSite(`${fixture.base}/wordpress`, 'فجوة');
  run('DELETE FROM checks');
  const old = new Date(Date.now() - 3 * 3600_000).toISOString();
  run('INSERT INTO checks(site_id, at, ok, health_score) VALUES(?,?,?,?)', site.id, old, 1, 90);

  const before = all('SELECT * FROM monitor_gaps').length;
  const gap = recordStartupGap('restart');
  assert.ok(gap, 'لم تُسجَّل فجوة رغم انقطاع 3 ساعات');
  assert.ok(gap.minutes >= 175 && gap.minutes <= 185, `مدة الفجوة ${gap.minutes} دقيقة — متوقع ~180`);
  assert.equal(all('SELECT * FROM monitor_gaps').length, before + 1);
});

test('لا تُسجَّل فجوة عندما تكون المراقبة منتظمة', () => {
  const site = mkSite(`${fixture.base}/wordpress`, 'بلا فجوة');
  run('DELETE FROM checks');
  run('INSERT INTO checks(site_id, at, ok, health_score) VALUES(?,?,?,?)', site.id, nowISO(), 1, 90);
  assert.equal(recordStartupGap('restart'), null, 'سُجّلت فجوة وهمية رغم انتظام المراقبة');
});

test('التجميع اليومي يلخّص ثم يحذف الصفوف القديمة', () => {
  const site = mkSite(`${fixture.base}/wordpress`, 'تجميع');
  const oldDay = new Date(Date.now() - 45 * 86400_000).toISOString();
  for (let i = 0; i < 10; i++) {
    run(
      'INSERT INTO checks(site_id, at, ok, response_ms, health_score) VALUES(?,?,?,?,?)',
      site.id, oldDay.replace(/T\d\d/, `T0${i}`), i < 8 ? 1 : 0, 200 + i, 90 - i
    );
  }
  const r = rollupAndPrune({ keepDays: 30 });
  assert.ok(r.deleted >= 10, 'لم تُحذف الصفوف القديمة');
  const rolled = get('SELECT * FROM checks_daily WHERE site_id = ?', site.id);
  assert.ok(rolled, 'لم يُنشأ صف تجميع');
  assert.equal(rolled.checks, 10);
  assert.equal(rolled.ok_checks, 8);
});

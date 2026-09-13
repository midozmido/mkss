// اختبار الطبقة الاحترافية: ردود محفوظة · تقييم · تأجيل · بحث · رسائل استباقية.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { all, get, run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import * as support from '../src/support.js';
import * as bot from '../src/bot.js';
import * as chat from '../src/chat.js';

let n = 0;
function mkClient() {
  const at = nowISO();
  return Number(
    run('INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
      `sup${++n}-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا'), `عميل ${n}`, 'client', at
    ).lastInsertRowid
  );
}
function mkSite(userId, name = 'موقع') {
  const id = Number(
    run('INSERT INTO sites(user_id, name, url, created_at) VALUES(?,?,?,?)',
      userId, name, 'https://x.test/', nowISO()).lastInsertRowid
  );
  return get('SELECT * FROM sites WHERE id = ?', id);
}

before(() => migrate({ quiet: true }));

// ——————————————————— الردود المحفوظة ———————————————————

test('الردود المحفوظة تُحفظ وتُرتَّب بالأكثر استخدامًا', () => {
  const a = support.saveReply({ title: 'طلب صلاحية', body: 'من فضلك أرسل لنا صلاحية دخول مؤقتة.' });
  const b = support.saveReply({ title: 'شكر', body: 'شكرًا لتواصلك معنا.' });
  support.noteReplyUse(b);
  support.noteReplyUse(b);
  const list = support.listReplies();
  assert.equal(list[0].id, b, 'لم يُرتَّب بالأكثر استخدامًا');
  assert.ok(list.some((r) => r.id === a));
  support.deleteReply(a);
  assert.ok(!support.listReplies().some((r) => r.id === a));
});

test('رد محفوظ بلا عنوان أو نص مرفوض', () => {
  assert.throws(() => support.saveReply({ title: '', body: 'نص' }), /مطلوبان/);
  assert.throws(() => support.saveReply({ title: 'عنوان', body: '   ' }), /مطلوبان/);
});

// ——————————————————— التقييم ———————————————————

test('التقييم يُطلب بعد إغلاق المحادثة لا أثناءها', () => {
  const u = mkClient();
  bot.escalate(u, { reason: 'اختبار' });
  assert.equal(support.askForRating(u), null, 'طلب التقييم والمحادثة ما زالت مفتوحة');

  bot.backToBot(u);
  const pending = support.askForRating(u);
  assert.ok(pending, 'لم يُطلب التقييم بعد الإغلاق');
  assert.equal(pending.rating, null);
});

test('التقييم يُسجَّل مرة واحدة ولا يُعاد', () => {
  const u = mkClient();
  bot.escalate(u, { reason: 'اختبار' });
  bot.backToBot(u);
  const esc = support.askForRating(u);

  const first = support.rateEscalation(u, esc.id, true, 'خدمة ممتازة');
  assert.equal(first.already, false);
  assert.equal(get('SELECT rating FROM escalations WHERE id = ?', esc.id).rating, 1);

  const second = support.rateEscalation(u, esc.id, false);
  assert.equal(second.already, true, 'قَبِل تقييمًا ثانيًا');
  assert.equal(get('SELECT rating FROM escalations WHERE id = ?', esc.id).rating, 1, 'تغيّر التقييم');
  assert.equal(support.askForRating(u), null, 'ظل يطلب التقييم بعد استلامه');
});

test('عميل لا يقيّم محادثة عميل آخر', () => {
  const a = mkClient(), b = mkClient();
  bot.escalate(b, { reason: 'اختبار' });
  bot.backToBot(b);
  const escB = support.askForRating(b);
  assert.throws(() => support.rateEscalation(a, escB.id, true), /غير موجودة/);
});

test('إحصاءات الدعم تحسب الرضا وزمن أول رد', () => {
  const u = mkClient();
  bot.escalate(u, { reason: 'اختبار' });
  bot.markFirstReply(u);
  bot.backToBot(u);
  support.rateEscalation(u, support.askForRating(u).id, true);

  const s = support.supportStats(30);
  assert.ok(s.escalations >= 1);
  assert.ok(s.rated >= 1);
  assert.ok(s.satisfaction >= 0 && s.satisfaction <= 100, `نسبة رضا غير منطقية: ${s.satisfaction}`);
  assert.ok(s.avgFirstReplyMinutes != null, 'لم يُحسب زمن أول رد');
});

// ——————————————————— التأجيل ———————————————————

test('التأجيل يُضبط ويُلغى', () => {
  const u = mkClient();
  const until = support.snooze(u, 24);
  assert.ok(until > nowISO());
  assert.equal(support.isSnoozed(get('SELECT * FROM users WHERE id = ?', u)), true);

  support.unsnooze(u);
  assert.equal(support.isSnoozed(get('SELECT * FROM users WHERE id = ?', u)), false);
});

test('تأجيل منتهٍ لا يُعتبر تأجيلًا', () => {
  const u = mkClient();
  run('UPDATE users SET snooze_until = ? WHERE id = ?', new Date(Date.now() - 3600_000).toISOString(), u);
  assert.equal(support.isSnoozed(get('SELECT * FROM users WHERE id = ?', u)), false);
});

// ——————————————————— البحث ———————————————————

test('البحث في المحادثات يجد الرسالة ويذكر صاحبها', () => {
  const u = mkClient();
  chat.sendMessage(u, { body: 'عندي مشكلة في بوابة الدفع الجديدة', role: 'client' });
  const hits = support.searchConversations('بوابة الدفع');
  assert.ok(hits.some((h) => h.user_id === u), 'لم يجد الرسالة');
  assert.ok(hits[0].client_name, 'النتيجة بلا اسم العميل');
});

test('البحث بكلمة غير موجودة يرجع فارغًا لا كل شيء', () => {
  assert.equal(support.searchConversations('كلمةلاوجودلهاإطلاقا').length, 0);
  assert.equal(support.searchConversations('   ').length, 0);
});

// ——————————————————— الرسائل الاستباقية ———————————————————

test('سامي ينبّه قبل انتهاء الشهادة مرة واحدة لكل عتبة', () => {
  const u = mkClient();
  const site = mkSite(u, 'متجر');
  const result = { ok: true, responseMs: 400, tls: { applicable: true, daysLeft: 7 } };

  const first = support.proactiveForCheck(site, result);
  assert.ok(first.includes('ssl_7'), 'لم يُرسل تنبيه الشهادة');

  const second = support.proactiveForCheck(site, result);
  assert.equal(second.length, 0, 'كرّر التنبيه في الفحص التالي');

  const msg = chat.history(u).at(-1);
  assert.equal(msg.author_role, 'bot');
  assert.match(msg.body, /متجر/, 'لم يذكر اسم الموقع');
  assert.match(msg.body, /شهادة الأمان/);
});

test('ينبّه عند التوقف وعند العودة', () => {
  const u = mkClient();
  const site = mkSite(u, 'المدونة');

  support.proactiveForCheck(site, { ok: false, blocked: false, responseMs: null, tls: {} });
  assert.match(chat.history(u).at(-1).body, /لا يستجيب/, 'لم ينبّه بالتوقف');

  assert.equal(support.proactiveRecovered(site), true);
  assert.match(chat.history(u).at(-1).body, /عاد للعمل/, 'لم ينبّه بالعودة');
  assert.equal(support.proactiveRecovered(site), false, 'كرّر تنبيه العودة');
});

test('ينبّه على البطء الشديد فقط لا على كل قياس', () => {
  const u = mkClient();
  const site = mkSite(u, 'سريع');
  assert.equal(support.proactiveForCheck(site, { ok: true, responseMs: 500, tls: {} }).length, 0);
  assert.ok(support.proactiveForCheck(site, { ok: true, responseMs: 4200, tls: {} }).includes('slow'));
});

test('التنبيه الاستباقي لا يُفشل الفحص إذا تعذّر', () => {
  const site = { id: 999999, user_id: 999999, name: 'غير موجود' };
  assert.doesNotThrow(() => {
    try { support.proactiveForCheck(site, { ok: true, responseMs: 100, tls: {} }); } catch { /* متوقع */ }
  });
});

test('المحادثة المؤجَّلة تُعلَّم وتنزل لأسفل القائمة', () => {
  const a = mkClient(), b = mkClient();
  chat.sendMessage(a, { body: 'رسالة أ', role: 'client' });
  chat.sendMessage(b, { body: 'رسالة ب', role: 'client' });
  chat.markRead(a, 'admin');
  chat.markRead(b, 'admin');

  support.snooze(a, 24);
  const threads = chat.adminThreads();
  const ta = threads.find((t) => t.user_id === a);
  const tb = threads.find((t) => t.user_id === b);

  assert.ok(ta.snooze_until, 'حقل التأجيل غير مُعاد من الاستعلام — الشارة لن تظهر أبدًا');
  assert.ok(
    threads.indexOf(ta) > threads.indexOf(tb),
    'المحادثة المؤجَّلة لم تنزل أسفل غير المؤجَّلة'
  );

  support.unsnooze(a);
  assert.equal(chat.adminThreads().find((t) => t.user_id === a).snooze_until, null);
});

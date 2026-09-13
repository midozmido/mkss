// اختبار الشات — وصول الرسالة، العزل، عدّاد غير المقروء، البثّ اللحظي.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import * as chat from '../src/chat.js';

let a, b;
const mk = (name) => Number(
  run('INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
    `chat-${name}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@test.local`,
    hashPassword('كلمة-سر-قوية-جدا'), name, 'client', nowISO()).lastInsertRowid
);

before(() => { migrate({ quiet: true }); a = mk('سالم'); b = mk('نور'); });

test('رسالة العميل تُحفظ وتظهر في سجله', () => {
  chat.sendMessage(a, { body: 'الموقع بطيء اليوم', role: 'client' });
  const h = chat.history(a);
  assert.equal(h.at(-1).body, 'الموقع بطيء اليوم');
  assert.equal(h.at(-1).author_role, 'client');
});

test('سجل عميل لا يحتوي رسائل عميل آخر', () => {
  chat.sendMessage(b, { body: 'سر نور', role: 'client' });
  assert.ok(!chat.history(a).some((m) => m.body === 'سر نور'), 'تسريب رسائل بين العملاء');
  assert.ok(!chat.history(b).some((m) => m.body === 'الموقع بطيء اليوم'));
});

test('رسالة العميل تظهر للأدمن كغير مقروءة، ورد الأدمن العكس', () => {
  const before = chat.unreadForAdmin();
  chat.sendMessage(a, { body: 'في مشكلة', role: 'client' });
  assert.equal(chat.unreadForAdmin(), before + 1);

  const clientBefore = chat.unreadForClient(a);
  chat.sendMessage(a, { body: 'نعالجها الآن', role: 'admin', authorId: 1 });
  assert.equal(chat.unreadForClient(a), clientBefore + 1, 'رد الأدمن لم يظهر كغير مقروء للعميل');
});

test('وضع علامة مقروء يعمل لكل طرف على حدة', () => {
  // unreadForAdmin عدّاد عام لكل العملاء (شارة الإجمالي) — ننظّف الاثنين للقياس
  chat.markRead(a, 'admin');
  chat.markRead(b, 'admin');
  assert.equal(chat.unreadForAdmin(), 0, 'بقي غير مقروء بعد تنظيف كل المحادثات');

  chat.sendMessage(a, { body: 'تذكير', role: 'client' });
  assert.equal(chat.unreadForAdmin(), 1, 'رسالة جديدة لم تُحسب للأدمن');
  // قراءة الأدمن لمحادثة a لا تمس محادثة b
  chat.sendMessage(b, { body: 'رسالة نور', role: 'client' });
  chat.markRead(a, 'admin');
  assert.equal(chat.unreadForAdmin(), 1, 'قراءة محادثة أثّرت على محادثة عميل آخر');

  chat.markRead(b, 'admin');
  chat.markRead(a, 'client');
  assert.equal(chat.unreadForClient(a), 0);
});

test('الرسائل الفارغة والطويلة والأدوار المجهولة مرفوضة', () => {
  assert.throws(() => chat.sendMessage(a, { body: '   ', role: 'client' }), /فارغة/);
  assert.throws(() => chat.sendMessage(a, { body: 'x'.repeat(5000), role: 'client' }), /طويلة/);
  assert.throws(() => chat.sendMessage(a, { body: 'مرحبا', role: 'hacker' }), /دور/);
});

test('البثّ اللحظي يصل للمشتركين في القناة الصحيحة فقط', () => {
  const received = { client: [], admin: [], other: [] };
  const fake = (bucket) => ({ write: (s) => received[bucket].push(s), end() {}, on() {} });

  const offA = chat.subscribe(`u:${a}`, fake('client'));
  const offAdmin = chat.subscribe('admin', fake('admin'));
  const offB = chat.subscribe(`u:${b}`, fake('other'));

  chat.sendMessage(a, { body: 'رسالة لحظية', role: 'client' });

  assert.equal(received.client.length, 1, 'لم تصل الرسالة لقناة العميل');
  assert.equal(received.admin.length, 1, 'لم تصل الرسالة للوحة الأدمن');
  assert.equal(received.other.length, 0, 'وصلت رسالة لقناة عميل آخر');
  assert.match(received.admin[0], /^event: message\ndata: /);
  assert.ok(JSON.parse(received.admin[0].split('data: ')[1]).client_name, 'رسالة الأدمن بلا اسم العميل');

  offA(); offAdmin(); offB();
  assert.equal(chat.listenerCount(`u:${a}`), 0, 'لم تُنظَّف قناة بعد إلغاء الاشتراك');
});

test('اتصال ميت يُنظَّف ولا يعطّل البثّ لباقي المشتركين', () => {
  const good = [];
  chat.subscribe(`u:${a}`, { write: () => { throw new Error('socket مات'); }, end() {}, on() {} });
  const off = chat.subscribe(`u:${a}`, { write: (s) => good.push(s), end() {}, on() {} });
  chat.sendMessage(a, { body: 'بعد الموت', role: 'admin', authorId: 1 });
  assert.equal(good.length, 1, 'اتصال ميت منع الوصول لباقي المشتركين');
  assert.equal(chat.listenerCount(`u:${a}`), 1, 'لم يُزَل الاتصال الميت');
  off();
});

test('since يرجع الجديد فقط — أساس المزامنة بعد انقطاع', () => {
  const m1 = chat.sendMessage(a, { body: 'واحد', role: 'client' });
  const m2 = chat.sendMessage(a, { body: 'اثنان', role: 'client' });
  const fresh = chat.since(a, m1.id);
  assert.ok(fresh.some((m) => m.id === m2.id));
  assert.ok(!fresh.some((m) => m.id === m1.id));
});

test('قائمة محادثات الأدمن ترتّب غير المقروء أولًا', () => {
  chat.markRead(a, 'admin'); chat.markRead(b, 'admin');
  chat.sendMessage(b, { body: 'عاجل', role: 'client' });
  const threads = chat.adminThreads();
  assert.ok(threads.length >= 2);
  assert.equal(threads[0].user_id, b, 'المحادثة غير المقروءة ليست في الأعلى');
  assert.equal(threads[0].unread, 1);
});

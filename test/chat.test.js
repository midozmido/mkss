// اختبار المحادثات — تعدّدها، وعزلها، والبثّ اللحظي، والأرشفة.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { get, run, nowISO } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import * as chat from '../src/chat.js';

let a, b;
let n = 0;
const mk = (name) => Number(
  run('INSERT INTO users(email, password_hash, name, role, created_at) VALUES(?,?,?,?,?)',
    `chat-${++n}-${Date.now()}@test.local`, hashPassword('كلمة-سر-قوية-جدا'), name, 'client', nowISO()
  ).lastInsertRowid
);

before(() => { migrate({ quiet: true }); a = mk('سالم'); b = mk('نور'); });

test('لا تُنشأ محادثة تلقائيًا قبل أن يبدأ العميل', () => {
  const u = mk('هادئ');
  assert.equal(chat.currentConversation(u), null, 'أُنشئت محادثة فارغة بلا سبب');
  assert.equal(chat.listConversations(u).length, 0);
});

test('العميل يفتح محادثات متعددة وتُحفظ كلها', () => {
  const c1 = chat.openConversation(a);
  chat.sendMessage(c1.id, { body: 'سؤالي الأول', role: 'client' });
  chat.closeConversation(c1.id, 'client');

  const c2 = chat.openConversation(a);
  chat.sendMessage(c2.id, { body: 'سؤال جديد تمامًا', role: 'client' });

  const list = chat.listConversations(a);
  assert.equal(list.length, 2, 'ضاعت محادثة من السجل');
  assert.equal(list[0].id, c2.id, 'المحادثة المفتوحة ليست في الأعلى');
  assert.equal(list[0].status, 'open');
  assert.equal(list[1].status, 'closed');
});

test('عنوان المحادثة يُشتق من أول رسالة للعميل', () => {
  const c = chat.openConversation(a);
  chat.sendMessage(c.id, { body: 'الموقع بطيء جدًا منذ أمس', role: 'client' });
  assert.match(get('SELECT title FROM conversations WHERE id = ?', c.id).title, /الموقع بطيء/);
});

test('رسائل محادثة لا تظهر في أخرى', () => {
  const c1 = chat.openConversation(a);
  const c2 = chat.openConversation(b);
  chat.sendMessage(c1.id, { body: 'سر سالم', role: 'client' });
  chat.sendMessage(c2.id, { body: 'سر نور', role: 'client' });
  assert.ok(!chat.history(c1.id).some((m) => m.body === 'سر نور'), 'تسريب بين المحادثات');
  assert.ok(!chat.history(c2.id).some((m) => m.body === 'سر سالم'));
});

test('عميل لا يفتح محادثة عميل آخر — 404 باسم خطأ الملكية', () => {
  const cB = chat.openConversation(b);
  // الاسم مهم بقدر الرمز: الخادم يوزّع على e.name، فلو اختلف رد 500 لا 404.
  assert.throws(() => chat.getConversation(a, cB.id), (e) => {
    assert.equal(e.name, 'OwnershipError');
    assert.equal(e.status, 404);
    return true;
  });
  assert.throws(() => chat.getConversation(a, 999999), { name: 'OwnershipError' });
});

test('المحادثة المغلقة تبقى في السجل ولا تُحذف', () => {
  const c = chat.openConversation(a);
  chat.sendMessage(c.id, { body: 'رسالة قبل الإغلاق', role: 'client' });
  const r = chat.closeConversation(c.id, 'client');
  assert.equal(r.already, false);
  assert.equal(r.conversation.status, 'closed');
  assert.equal(r.conversation.closed_by, 'client');
  assert.equal(chat.history(c.id).length, 1, 'فُقدت الرسائل عند الإغلاق');
  assert.equal(chat.closeConversation(c.id).already, true, 'قَبِل إغلاقًا مكررًا');
});

test('إغلاق المحادثة يعيدها لوضع المساعد', () => {
  const c = chat.openConversation(a);
  chat.setMode(c.id, 'live');
  assert.equal(chat.isLive(c.id), true);
  chat.closeConversation(c.id, 'admin');
  assert.equal(chat.isLive(c.id), false, 'ظلت المحادثة المغلقة في وضع الدعم البشري');
});

test('الملاحظة الداخلية تُحجب عن العميل وتظهر للأدمن', () => {
  const c = chat.openConversation(a);
  chat.sendMessage(c.id, { body: 'سؤال', role: 'client' });
  chat.sendMessage(c.id, { body: 'ملاحظة للفريق', role: 'system', visibility: 'internal' });
  assert.equal(chat.history(c.id, 50, 'client').length, 1, 'تسرّبت الملاحظة الداخلية');
  assert.equal(chat.history(c.id, 50, 'admin').length, 2);
});

test('عدّاد غير المقروء لكل محادثة على حدة', () => {
  const c1 = chat.openConversation(a);
  const c2 = chat.openConversation(a);
  chat.sendMessage(c1.id, { body: 'أ', role: 'client' });
  chat.sendMessage(c2.id, { body: 'ب', role: 'client' });
  assert.equal(chat.unreadForAdminIn(c1.id), 1);
  chat.markRead(c1.id, 'admin');
  assert.equal(chat.unreadForAdminIn(c1.id), 0);
  assert.equal(chat.unreadForAdminIn(c2.id), 1, 'قراءة محادثة أثّرت على أخرى');
});

test('الرسائل الفارغة والطويلة والأدوار المجهولة مرفوضة', () => {
  const c = chat.openConversation(a);
  assert.throws(() => chat.sendMessage(c.id, { body: '   ', role: 'client' }), /فارغة/);
  assert.throws(() => chat.sendMessage(c.id, { body: 'x'.repeat(5000), role: 'client' }), /طويلة/);
  assert.throws(() => chat.sendMessage(c.id, { body: 'مرحبا', role: 'hacker' }), /دور/);
  assert.throws(() => chat.sendMessage(999999, { body: 'مرحبا', role: 'client' }), /غير موجودة/);
});

test('البثّ اللحظي يصل لقناة العميل والأدمن دون غيرهما', () => {
  const got = { client: [], admin: [], other: [] };
  const fake = (k) => ({ write: (s) => got[k].push(s), end() {}, on() {} });
  const offA = chat.subscribe(`u:${a}`, fake('client'));
  const offAdmin = chat.subscribe('admin', fake('admin'));
  const offB = chat.subscribe(`u:${b}`, fake('other'));

  const c = chat.openConversation(a);
  chat.sendMessage(c.id, { body: 'رسالة لحظية', role: 'client' });

  assert.ok(got.client.some((s) => s.includes('رسالة لحظية')), 'لم تصل لقناة العميل');
  assert.ok(got.admin.some((s) => s.includes('رسالة لحظية')), 'لم تصل للوحة الأدمن');
  assert.ok(!got.other.some((s) => s.includes('رسالة لحظية')), 'وصلت لعميل آخر');

  offA(); offAdmin(); offB();
  assert.equal(chat.listenerCount(`u:${a}`), 0);
});

test('الملاحظة الداخلية لا تُبثّ لقناة العميل إطلاقًا', () => {
  const seen = [];
  const off = chat.subscribe(`u:${a}`, { write: (s) => seen.push(s), end() {}, on() {} });
  const c = chat.openConversation(a);
  chat.sendMessage(c.id, { body: 'سرّ الفريق', role: 'system', visibility: 'internal' });
  assert.ok(!seen.some((s) => s.includes('سرّ الفريق')), 'بُثّت ملاحظة داخلية للعميل');
  off();
});

test('اتصال ميت يُنظَّف ولا يعطّل باقي المشتركين', () => {
  const good = [];
  chat.subscribe(`u:${a}`, { write: () => { throw new Error('مات'); }, end() {}, on() {} });
  const off = chat.subscribe(`u:${a}`, { write: (s) => good.push(s), end() {}, on() {} });
  const c = chat.openConversation(a);
  chat.sendMessage(c.id, { body: 'بعد الموت', role: 'admin', authorId: 1 });
  assert.ok(good.length >= 1, 'اتصال ميت منع الوصول للباقي');
  assert.equal(chat.listenerCount(`u:${a}`), 1);
  off();
});

test('since يرجع الجديد فقط', () => {
  const c = chat.openConversation(a);
  const m1 = chat.sendMessage(c.id, { body: 'واحد', role: 'client' });
  const m2 = chat.sendMessage(c.id, { body: 'اثنان', role: 'client' });
  const fresh = chat.since(c.id, m1.id);
  assert.ok(fresh.some((m) => m.id === m2.id));
  assert.ok(!fresh.some((m) => m.id === m1.id));
});

test('قائمة الأدمن ترتّب المفتوح قبل المغلق وتحمل بيانات المحادثة', () => {
  const closed = chat.openConversation(a);
  chat.sendMessage(closed.id, { body: 'محادثة منتهية', role: 'client' });
  chat.markRead(closed.id, 'admin');
  chat.closeConversation(closed.id, 'client');

  const open = chat.openConversation(a);
  chat.sendMessage(open.id, { body: 'مفتوحة وغير مقروءة', role: 'client' });

  const threads = chat.adminThreads();
  const iOpen = threads.findIndex((t) => t.conversation_id === open.id);
  const iClosed = threads.findIndex((t) => t.conversation_id === closed.id);

  assert.ok(iOpen >= 0 && iClosed >= 0, 'محادثة مفقودة من قائمة الأدمن');
  assert.ok(iOpen < iClosed, 'المحادثة المغلقة تسبق المفتوحة في القائمة');

  const row = threads[iOpen];
  assert.ok(row.title, 'المحادثة بلا عنوان في القائمة');
  assert.ok(row.name, 'القائمة بلا اسم العميل');
  assert.equal(row.unread, 1);
  assert.equal(row.status, 'open');
});

test('notify تُسلّم لصاحب الحساب لا لمحادثة رقمها يصادف رقمه', () => {
  // الانحدار المقصود: مسار كان يمرّر userId مكان conversationId. هنا نضمن
  // أن رقم المحادثة الذي يساوي رقم عميل آخر لا يخطف رسالته.
  const owner = mk('صاحب الرسالة');
  const stranger = mk('غريب');
  const decoy = chat.openConversation(stranger);

  const msg = chat.notify(owner, { role: 'system', body: 'تم تأكيد سدادك' });
  assert.equal(msg.user_id, owner, 'الرسالة هبطت في حساب غير صاحبها');
  assert.ok(!chat.history(decoy.id).some((m) => m.body === 'تم تأكيد سدادك'), 'تسريب لمحادثة غريب');
  assert.equal(chat.currentConversation(owner).id, msg.conversation_id);
});

test('notify تستخدم المحادثة المفتوحة ولا تفتح واحدة لكل إشعار', () => {
  const u = mk('عميل واحد');
  const first = chat.notify(u, { role: 'system', body: 'إشعار أول' });
  const second = chat.notify(u, { role: 'system', body: 'إشعار ثانٍ' });
  assert.equal(first.conversation_id, second.conversation_id);
  assert.equal(chat.listConversations(u).length, 1);
});

test('«محادثة جديدة» لا تتراكم فارغة، وتُفتح نظيفة بعد الإغلاق', () => {
  const u = mk('مستعجل');
  const first = chat.startConversation(u);
  assert.equal(chat.startConversation(u).id, first.id, 'تراكمت محادثة فارغة ثانية');

  chat.sendMessage(first.id, { body: 'سؤالي الأول', role: 'client' });
  const second = chat.startConversation(u);
  assert.notEqual(second.id, first.id, 'محادثة فيها كلام أُعيد استعمالها');

  chat.closeConversation(second.id, 'client');
  const third = chat.startConversation(u);
  assert.notEqual(third.id, second.id, 'المغلقة أُعيد فتحها بدل فتح جديدة');
  assert.equal(chat.history(third.id).length, 0, 'المحادثة الجديدة ليست نظيفة');
});

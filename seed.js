#!/usr/bin/env node
// بيانات تجريبية للتشغيل الأول — أدمن + عميل + مواقع + فواتير + صيانة.
import { randomBytes } from 'node:crypto';
import { db, get, run, nowISO } from './src/db.js';
import { migrate } from './src/migrations.js';
import { hashPassword, createOneTimeLink } from './src/auth.js';
import * as admin from './src/admin-repo.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const days = (n) => new Date(Date.now() - n * 86400_000).toISOString();

console.log('◆ تجهيز البيانات التجريبية\n');
migrate();

// ——— الأدمن ———
const adminEmail = process.env.ADMIN_EMAIL || 'admin@mkss.local';
let adminUser = get('SELECT * FROM users WHERE lower(email) = lower(?)', adminEmail);
let adminPassword = null;

if (!adminUser) {
  adminPassword = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  const id = Number(
    run(
      "INSERT INTO users(email, password_hash, name, role, active, created_at) VALUES(?,?,?,'admin',1,?)",
      adminEmail, hashPassword(adminPassword), 'مدير النظام', nowISO()
    ).lastInsertRowid
  );
  adminUser = get('SELECT * FROM users WHERE id = ?', id);
  console.log('✓ حساب الأدمن أُنشئ');
} else {
  console.log('• حساب الأدمن موجود بالفعل');
}

// ——— عميل تجريبي ———
const demoEmail = 'demo@mkss.local';
let demo = get('SELECT * FROM users WHERE lower(email) = lower(?)', demoEmail);

if (!demo) {
  const id = admin.adminCreateClient(
    {
      name: 'أحمد محمود',
      email: demoEmail,
      company: 'متجر النخبة',
      phone: '+201000000000',
      mvp_url: 'https://example.com',
      mvp_label: 'متجر النخبة',
    },
    hashPassword(randomBytes(24).toString('hex'))
  );
  demo = get('SELECT * FROM users WHERE id = ?', id);

  const s1 = admin.adminAddSite(demo.id, { name: 'المتجر الرئيسي', url: 'https://example.com' });
  const s2 = admin.adminAddSite(demo.id, { name: 'المدونة', url: 'https://example.org' });

  // سجل صيانة يُظهر للعميل قيمة اشتراكه
  admin.adminLogMaintenance(s1, {
    title: 'تحديث الإضافات وفحص الأمان الشهري',
    type: 'security', performed_by: 'فريق الصيانة',
    notes: 'حُدِّثت 7 إضافات، ولم يُرصد أي نشاط مشبوه.',
  });
  admin.adminLogMaintenance(s1, {
    title: 'نسخة احتياطية كاملة', type: 'backup', performed_by: 'فريق الصيانة',
  });
  run('UPDATE maintenance SET at = ? WHERE site_id = ? AND type = ?', days(12), s1, 'backup');
  admin.adminLogMaintenance(s2, { title: 'تحسين سرعة الصفحة الرئيسية', type: 'fix', performed_by: 'فريق الصيانة' });

  // فواتير: واحدة مدفوعة وواحدة قائمة
  const paid = admin.adminCreateInvoice(demo.id, {
    description: 'اشتراك صيانة — يوليو', amount: 2500, currency: 'EGP', due_at: days(35).slice(0, 10),
  });
  admin.adminRecordPayment(paid.id, { amount: 2500, method: 'تحويل بنكي' }, db);

  admin.adminCreateInvoice(demo.id, {
    description: 'اشتراك صيانة — أغسطس', amount: 2500, currency: 'EGP', due_at: days(-10).slice(0, 10),
  });
  admin.adminCreateInvoice(demo.id, {
    description: 'تطوير صفحة هبوط', amount: 4000, currency: 'EGP', due_at: days(3).slice(0, 10),
  });

  console.log('✓ عميل تجريبي بموقعين وفواتير وسجل صيانة');
} else {
  console.log('• العميل التجريبي موجود بالفعل');
}

// ——— رابط تفعيل للعميل التجريبي ———
const link = createOneTimeLink(demo.id, 'activate', 72);

console.log('\n' + '─'.repeat(62));
console.log('  الدخول كأدمن');
console.log('─'.repeat(62));
console.log(`  البريد    : ${adminEmail}`);
console.log(`  كلمة السر : ${adminPassword || '(كما ضبطتها سابقًا)'}`);
console.log('\n' + '─'.repeat(62));
console.log('  رابط تفعيل العميل التجريبي (صالح 72 ساعة، مرة واحدة)');
console.log('─'.repeat(62));
console.log(`  ${BASE_URL}/activate/${link.token}`);
console.log('\n  هكذا يستلم عميلك رابطه: أنت ترسله له، وهو يضع كلمة سره فقط.');
console.log('\n  التشغيل:  node server.js\n');

#!/usr/bin/env node
// بيانات تجريبية للتشغيل الأول — أدمن + عميل + مواقع + فواتير + صيانة.
import { randomBytes } from 'node:crypto';
import { db, get, run, nowISO } from './src/db.js';
import { migrate } from './src/migrations.js';
import { hashPassword, createOneTimeLink } from './src/auth.js';
import * as admin from './src/admin-repo.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const days = (n) => new Date(Date.now() - n * 86400_000).toISOString();

/**
 * يولّد سجل فحوصات للعرض. بيانات مصطنعة بوضوح — الغرض أن ترى الواجهة
 * تعمل بمعطيات واقعية الشكل قبل أن تربط النظام بمواقع عملائك.
 */
function seedCheckHistory(siteId, { days: d, everyMin, baseMs, platform, outageAt = null }) {
  const step = everyMin * 60_000;
  const total = Math.floor((d * 86400_000) / step);
  let seed = siteId * 7919; // مولّد حتمي: نفس البذور تعطي نفس السجل
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = total; i >= 0; i--) {
    const at = new Date(Date.now() - i * step).toISOString();
    const ageDays = (i * step) / 86400_000;
    // انقطاع قصير في يوم محدد لإظهار سجل الأعطال والمنحنى
    const down = outageAt != null && ageDays > outageAt && ageDays < outageAt + 0.08;
    const ms = down ? null : Math.round(baseMs * (0.75 + rnd() * 0.6));
    const health = down ? 0 : Math.max(55, Math.min(98, Math.round(92 - (ms - baseMs) / 40)));
    run(
      `INSERT INTO checks(site_id, at, ok, status_code, response_ms, ttfb_ms, page_bytes,
                          redirects, dns_ok, ssl_valid, ssl_days_left, sec_score, health_score, platform, detail)
       VALUES(?,?,?,?,?,?,?,0,1,1,?,?,?,?,?)`,
      siteId, at, down ? 0 : 1, down ? 503 : 200, ms, ms ? Math.round(ms * 0.7) : null,
      down ? null : 120000 + Math.round(rnd() * 60000),
      64, 72, health, platform,
      JSON.stringify({ seeded: true, findings: down
        ? [{ level: 'critical', area: 'uptime', problem: 'السيرفر يرد بخطأ 503 — الموقع مفتوح لكنه معطّل',
             fix: 'راجع سجل أخطاء السيرفر — غالبًا خطأ برمجي أو قاعدة بيانات لا تستجيب' }]
        : [{ level: 'info', area: 'headers', problem: 'سياسة الأذونات: غير مُفعَّلة',
             fix: 'أضف: Permissions-Policy: geolocation=(), microphone=(), camera=()' }] })
    );
  }
  run('UPDATE sites SET platform = ?, platform_confidence = 95, last_checked_at = ? WHERE id = ?',
      platform, nowISO(), siteId);

  if (outageAt != null) {
    const start = new Date(Date.now() - outageAt * 86400_000).toISOString();
    run(`INSERT INTO incidents(site_id, kind, severity, detail, started_at, ended_at, resolved)
         VALUES(?,'server_error','major','السيرفر يرد بخطأ 503',?,?,1)`,
        siteId, start, new Date(new Date(start).getTime() + 105 * 60_000).toISOString());
  }
}

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
  // تواريخ واقعية: سجل صيانة كله "الآن" يبدو مصطنعًا
  run('UPDATE maintenance SET at = ? WHERE site_id = ? AND type = ?', days(6), s1, 'security');
  run('UPDATE maintenance SET at = ? WHERE site_id = ? AND type = ?', days(9), s2, 'fix');

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

  // سجل فحوصات تجريبي — بيانات **مُصطنعة للعرض فقط**، حتى ترى النظام يعمل
  // قبل ربطه بمواقع حقيقية. الفحوصات الحقيقية تبدأ فور تشغيل server.js.
  seedCheckHistory(s1, { days: 14, everyMin: 30, baseMs: 340, platform: 'wordpress', outageAt: 5 });
  seedCheckHistory(s2, { days: 14, everyMin: 30, baseMs: 720, platform: 'shopify' });
  console.log('✓ عميل تجريبي بموقعين وفواتير وسجل صيانة وسجل فحوصات للعرض');
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

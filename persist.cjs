#!/usr/bin/env node
// اختبار بقاء الملفات — يجيب عن السؤال الوحيد الذي يقرّر صلاحية الاستضافة
// المُدارة لهذا النظام: هل يبقى ما نكتبه على القرص بعد إعادة النشر؟
//
// قاعدة البيانات كلها ملف واحد في ‎data/‎. لو كان نظام الملفات مؤقّتًا — وهو
// سلوك شائع في منصّات التطبيقات المُدارة — فكل عميل وكل فاتورة وكل محادثة
// تختفي مع أول إعادة نشر، بلا رسالة خطأ واحدة: النظام يقلع نظيفًا وفارغًا.
// لا تُصدّق وثيقةً في هذا، اختبره بنفسك:
//
//   ١) node persist.cjs        ← يكتب علامة ويطبع وقتها
//   ٢) أعد النشر من لوحة الاستضافة (أو أعد تشغيل التطبيق)
//   ٣) node persist.cjs        ← لو طبع العلامة القديمة فالقرص يبقى
//
// مكتوب بـ CommonJS عمدًا: يعمل على أي نسخة Node مهما قدُمت، فتستطيع
// تشغيله قبل أن تعرف إن كانت نسخة الاستضافة تصلح للنظام أصلًا.
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'data');
const marker = path.join(dir, '.persist-check');

try {
  fs.mkdirSync(dir, { recursive: true });
} catch (e) {
  console.error(`✗ تعذّر إنشاء مجلد data/: ${e.message}`);
  process.exit(1);
}

let previous = null;
try {
  previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
} catch { /* أول تشغيل، أو المجلد لا يبقى */ }

const now = new Date().toISOString();
const runs = (previous?.runs || 0) + 1;

try {
  fs.writeFileSync(marker, JSON.stringify({ first: previous?.first || now, last: now, runs }, null, 2));
} catch (e) {
  console.error(`✗ الكتابة في data/ ممنوعة: ${e.message}`);
  console.error('   بلا كتابة لا تعمل قاعدة البيانات إطلاقًا.');
  process.exit(1);
}

console.log('────────────────────────────────────────────────');
console.log('  اختبار بقاء القرص — Support VIP System');
console.log('────────────────────────────────────────────────');
if (!previous) {
  console.log('  • أول تشغيل. كُتبت العلامة الآن:');
  console.log(`      ${now}`);
  console.log('');
  console.log('  الخطوة التالية: أعد النشر أو أعد تشغيل التطبيق من لوحة');
  console.log('  الاستضافة، ثم شغّل هذا الأمر مرة ثانية.');
} else {
  console.log(`  • العلامة السابقة:  ${previous.last}`);
  console.log(`  • الآن:             ${now}`);
  console.log(`  • عدد التشغيلات:    ${runs}`);
  console.log('');
  console.log('  ✓ القرص يبقى بين التشغيلات.');
  console.log('    إن كنت قد أعدت النشر بين التشغيلين فالاستضافة تصلح');
  console.log('    لقاعدة بيانات على القرص. وإن لم تُعد النشر بعد، فأعِده');
  console.log('    ثم شغّل الأمر ثالثةً — هذه هي الحالة التي تهمّ.');
}
console.log('────────────────────────────────────────────────');

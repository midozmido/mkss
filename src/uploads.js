// تخزين الملفّات المرفوعة — إيصالات التحويل وحدها اليوم.
//
// قاعدة هذا الملفّ كلّها في سطر: **ما يرفعه المستخدم لا يُصدَّق في شيء**.
// لا في اسمه، ولا في امتداده، ولا في نوعه المعلَن. الاسم الذي نكتب به من
// عندنا، والامتداد من توقيع البايتات، والنوع لا يُقرأ من الطلب أبدًا.
//
// ولماذا خارج قاعدة البيانات: صورة الشاشة تبلغ ميجابايتات، وقاعدةٌ ينتفخ
// ملفّها بالصور تُبطئ كل استعلام ويثقل نسخُها الاحتياطي حتى يُهمَل. والملفّ
// على القرص يُنسَخ مع ‎data/‎ نفسها.
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = process.env.MKSS_UPLOAD_DIR
  || join(dirname(process.env.MKSS_DB || join(root, 'data', 'mkss.db')), 'uploads');

/** الأنواع المسموحة — قائمة سماح: ما ليس فيها يُرفض ولو بدا بريئًا */
export const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const uploadsDir = () => DIR;

/**
 * يحفظ ملفًّا مرفوعًا ويرجع اسم تخزينه.
 * @param {{bytes: Buffer, type: string|null, ext: string|null}} file من ‎readMultipart‎
 */
export function save(file) {
  if (!file || !file.bytes?.length) throw new Error('لم يصل ملف.');
  if (!file.type || !ALLOWED[file.type]) {
    throw new Error('نقبل صورة (JPG أو PNG أو WebP) أو ملف PDF فقط.');
  }
  mkdirSync(DIR, { recursive: true });
  // الاسم من ‎randomBytes‎ لا من اسم المستخدم: لا مسار يُشتقّ منه، ولا تخمين
  // لاسم ملفّ عميل آخر، ولا امتداد يحمله الخادم على محمل التنفيذ.
  const name = `${randomBytes(16).toString('hex')}.${ALLOWED[file.type]}`;
  writeFileSync(join(DIR, name), file.bytes, { mode: 0o600 });
  return { name, type: file.type, bytes: file.bytes.length };
}

/**
 * يقرأ ملفًّا بالاسم المخزَّن.
 * ‎basename‎ ليست زينة: لو تسرّب اسمٌ من مُدخل يومًا، فهي ما يمنع ‎../../‎ من
 * الخروج بالمسار عن المجلّد. والقراءة لا تحدث إلا بعد أن يثبت المسار أن
 * الطالب يملك الإيصال.
 */
export function read(name) {
  const safe = basename(String(name || ''));
  if (!/^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/.test(safe)) return null;
  const p = join(DIR, safe);
  if (!existsSync(p)) return null;
  return { bytes: readFileSync(p), size: statSync(p).size };
}

export function remove(name) {
  const safe = basename(String(name || ''));
  if (!/^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/.test(safe)) return false;
  const p = join(DIR, safe);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

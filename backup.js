#!/usr/bin/env node
// نسخة احتياطية آمنة من قاعدة البيانات — تُجدوَل بالكرون يوميًّا.
//
// لماذا ليست `cp`: مع وضع WAL تكون البيانات موزّعة بين الملف الأساسي وملفّ
// ‎-wal‎ الذي يتغيّر أثناء النسخ. نسخةٌ بـ`cp` قد تلتقط الملفّين في لحظتين
// مختلفتين فتخرج قاعدةً ناقصة أو تالفة — ولا تكتشف ذلك إلا يوم تحتاجها.
// ‎VACUUM INTO‎ يكتب قاعدةً متّسقة من لقطة واحدة، وهي الطريقة التي توصي بها
// SQLite نفسها. ويضغط الملف في الطريق فتصغر النسخة.
//
// الجدولة:
//     0 3 * * *  cd ~/mkss && /path/to/node backup.js >> data/backup.log 2>&1
import './src/require-node.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const DB = process.env.MKSS_DB || join(root, 'data', 'mkss.db');
const DIR = process.env.MKSS_BACKUP_DIR || join(dirname(DB), 'backups');
const KEEP_DAYS = Number(process.env.MKSS_BACKUP_KEEP || 14);

const stamp = new Date().toISOString().slice(0, 10);
const target = join(DIR, `mkss-${stamp}.db`);

mkdirSync(DIR, { recursive: true });

// ‎VACUUM INTO‎ يرفض ملفًّا موجودًا، فتشغيلٌ ثانٍ في اليوم نفسه — يدويًّا أو
// بعد فشل جزئي — كان يموت برسالة «output file already exists». نكتب باسم
// مؤقّت ثم نستبدل: يعمل مهما تكرّر، ولا يرى أحد نسخةً نصف مكتوبة.
const tmp = `${target}.part`;
if (existsSync(tmp)) unlinkSync(tmp);

const db = new DatabaseSync(DB, { readOnly: true });
try {
  // المسار يُحقن في نصّ SQL فلا يقبل معاملًا مربوطًا — نضاعف علامة الاقتباس
  // المفردة كما تفعل SQLite، والمسار من بيئتنا لا من مستخدم.
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
renameSync(tmp, target);

// تقليم القديم: نسخةٌ لا تُحذف تملأ القرص، وقرصٌ ممتلئ يوقف قاعدة البيانات.
const cutoff = Date.now() - KEEP_DAYS * 86400_000;
let pruned = 0;
for (const f of readdirSync(DIR)) {
  if (!/^mkss-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
  const p = join(DIR, f);
  if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); pruned++; }
}

const size = statSync(target).size;
console.log(`[${new Date().toISOString()}] نسخة ${target} — ${(size / 1048576).toFixed(2)} ميجابايت${pruned ? `، وحُذفت ${pruned} نسخة قديمة` : ''}`);

// نظام هجرات بسيط بلا أي أداة خارجية: ملفات SQL مرقّمة + جدول نسخة.
// يعمل تلقائيًا عند الإقلاع، وآمن لإعادة التشغيل (يطبّق الجديد فقط).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, get, run, nowISO } from './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'migrations');

export function currentVersion() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = get('SELECT MAX(version) AS v FROM schema_version');
  return row?.v ?? 0;
}

export function pendingMigrations() {
  const at = currentVersion();
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => ({ file: f, version: Number(f.split('_')[0]) }))
    .filter((m) => m.version > at)
    .sort((a, b) => a.version - b.version);
}

/** يطبّق كل الهجرات المعلّقة. كل هجرة في معاملة: تنجح كلها أو لا شيء. */
export function migrate({ quiet = false } = {}) {
  const pending = pendingMigrations();
  if (!pending.length) return { applied: [], version: currentVersion() };

  const applied = [];
  for (const m of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, m.file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      run('INSERT INTO schema_version(version, applied_at) VALUES(?, ?)', m.version, nowISO());
      db.exec('COMMIT');
      applied.push(m.file);
      if (!quiet) console.log(`  ✓ هجرة ${m.file}`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`فشلت الهجرة ${m.file}: ${e.message}`);
    }
  }
  return { applied, version: currentVersion() };
}

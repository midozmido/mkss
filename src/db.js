// طبقة قاعدة البيانات — node:sqlite المدمج، بدون أي مكتبة خارجية
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export const DB_PATH = process.env.MKSS_DB || join(root, 'data', 'mkss.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL يخلي القراءة والكتابة ما يتعارضوش وقت ما المراقب شغال مع الويب
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// ——— اختصارات استعلام ———
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function nowISO() {
  return new Date().toISOString();
}

export function setting(key, value) {
  if (value === undefined) {
    const row = get('SELECT value FROM settings WHERE key = ?', key);
    return row ? row.value : null;
  }
  run(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value)
  );
  return value;
}

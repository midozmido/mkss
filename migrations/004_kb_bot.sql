-- قاعدة المعرفة + مساعد آلي + تحويل احترافي للدعم البشري

-- 1) المقالات
CREATE TABLE IF NOT EXISTS kb_articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  keywords    TEXT,                -- كلمات إضافية يبحث بها العميل ولا ترد في النص
  category    TEXT NOT NULL DEFAULT 'عام',
  search_text TEXT NOT NULL,       -- نسخة مُطبَّعة للبحث (بلا تشكيل ولا اختلاف همزات)
  active      INTEGER NOT NULL DEFAULT 1,
  views       INTEGER NOT NULL DEFAULT 0,
  helpful     INTEGER NOT NULL DEFAULT 0,
  not_helpful INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_active ON kb_articles(active, category, sort_order);

-- 2) فهرس بحث نصي كامل — FTS5 مدمج في SQLite، بلا أي مكتبة
CREATE VIRTUAL TABLE IF NOT EXISTS kb_search USING fts5(
  title, search_text, keywords,
  content='kb_articles', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2"
);

-- مزامنة الفهرس مع الجدول تلقائيًا
CREATE TRIGGER IF NOT EXISTS kb_ai AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_search(rowid, title, search_text, keywords)
  VALUES (new.id, new.title, new.search_text, COALESCE(new.keywords, ''));
END;
CREATE TRIGGER IF NOT EXISTS kb_ad AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_search(kb_search, rowid, title, search_text, keywords)
  VALUES ('delete', old.id, old.title, old.search_text, COALESCE(old.keywords, ''));
END;
CREATE TRIGGER IF NOT EXISTS kb_au AFTER UPDATE ON kb_articles BEGIN
  INSERT INTO kb_search(kb_search, rowid, title, search_text, keywords)
  VALUES ('delete', old.id, old.title, old.search_text, COALESCE(old.keywords, ''));
  INSERT INTO kb_search(rowid, title, search_text, keywords)
  VALUES (new.id, new.title, new.search_text, COALESCE(new.keywords, ''));
END;

-- 3) تقييم المقال — يخبرك أي مقال يحتاج إعادة كتابة
CREATE TABLE IF NOT EXISTS kb_feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES kb_articles(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  helpful    INTEGER NOT NULL,
  question   TEXT,
  at         TEXT NOT NULL
);

-- 4) سجل أسئلة البوت — أهم مصدر لمعرفة أي مقال تكتبه بعد كده
CREATE TABLE IF NOT EXISTS bot_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  question    TEXT NOT NULL,
  intent      TEXT,               -- نية مباشرة (حالة الموقع، المستحق...) أو null
  article_id  INTEGER REFERENCES kb_articles(id) ON DELETE SET NULL,
  score       REAL,
  answered    INTEGER NOT NULL DEFAULT 0,
  escalated   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bot_unanswered ON bot_events(answered, at DESC);

-- 5) وضع الدعم لكل عميل: بوت أم محادثة بشرية
ALTER TABLE users ADD COLUMN support_mode TEXT NOT NULL DEFAULT 'bot'
  CHECK (support_mode IN ('bot','live'));
ALTER TABLE users ADD COLUMN escalated_at TEXT;

-- 6) إعادة بناء chat_messages لإضافة دور 'bot' وعمود القناة والرؤية.
--    قيد CHECK في SQLite لا يُعدَّل، فالبناء من جديد هو الطريق الصحيح.
CREATE TABLE chat_messages_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('client','admin','system','bot')),
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  read_by_admin  INTEGER NOT NULL DEFAULT 0,
  read_by_client INTEGER NOT NULL DEFAULT 0,
  channel     TEXT NOT NULL DEFAULT 'live' CHECK (channel IN ('bot','live')),
  visibility  TEXT NOT NULL DEFAULT 'all'  CHECK (visibility IN ('all','internal')),
  meta        TEXT
);
INSERT INTO chat_messages_new
  (id, user_id, author_role, author_id, body, created_at, read_by_admin, read_by_client)
  SELECT id, user_id, author_role, author_id, body, created_at, read_by_admin, read_by_client
    FROM chat_messages;
DROP TABLE chat_messages;
ALTER TABLE chat_messages_new RENAME TO chat_messages;
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_unread ON chat_messages(read_by_admin, id);

-- 7) إعدادات المساعد
INSERT INTO settings(key, value) VALUES
  ('bot_enabled', '1'),
  ('bot_greeting', 'أهلًا بك 👋 أنا المساعد الآلي — أقدر أجاوبك فورًا عن حالة موقعك ومستحقاتك وأشهر الأسئلة. اسأل، أو اضغط «كلم الدعم الفني» في أي وقت.'),
  ('work_days', '0,1,2,3,4,6'),
  ('work_from', '10'),
  ('work_to', '18'),
  ('tz_offset', '3'),
  ('reply_eta', 'عادة خلال ساعة داخل مواعيد العمل')
ON CONFLICT(key) DO NOTHING;

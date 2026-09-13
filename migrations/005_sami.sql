-- سامي: هوية المساعد · شات بأسلوب ماسنجر · ردود محفوظة · تقييم · زمن أول رد

-- 1) تفضيلات العميل
ALTER TABLE users ADD COLUMN chat_color TEXT;      -- لون الشات الذي يختاره العميل
ALTER TABLE users ADD COLUMN snooze_until TEXT;    -- تأجيل المحادثة في لوحة الأدمن

-- 2) دورة حياة كل تحويل — منها يُحسب زمن أول رد والرضا
CREATE TABLE IF NOT EXISTS escalations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at     TEXT NOT NULL,
  first_reply_at TEXT,
  closed_at      TEXT,
  reason         TEXT,
  rating         INTEGER,          -- 1 راضٍ · 0 غير راضٍ
  rating_note    TEXT,
  rated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_esc_user ON escalations(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_esc_open ON escalations(closed_at, started_at DESC);

-- 3) الردود المحفوظة — أكبر موفّر للوقت في أي نظام دعم
CREATE TABLE IF NOT EXISTS canned_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  shortcut   TEXT,
  uses       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 4) رسائل سامي الاستباقية — نمنع تكرار نفس التنبيه لنفس السبب في اليوم
CREATE TABLE IF NOT EXISTS proactive_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  day     TEXT NOT NULL,
  at      TEXT NOT NULL,
  UNIQUE (user_id, site_id, kind, day)
);

-- 5) هوية سامي
INSERT INTO settings(key, value) VALUES
  ('bot_name', 'سامي'),
  ('bot_greeting', 'أهلًا بك 👋 أنا سامي، مساعدك في كل ما يخصّ موقعك.
أستطيع أن أخبرك بحالة موقعك الآن، ومستحقاتك، وأن أشرح لك أي شيء عن المواقع وبنائها ومشكلاتها.
اسألني عمّا تريد، وإن أردت التحدث إلى زميل من فريق الدعم فاضغط الزر في أي وقت.'),
  ('bot_think_min', '3'),
  ('bot_think_max', '7'),
  ('chat_color_default', '#0d7a6f')
ON CONFLICT(key) DO UPDATE SET value = excluded.value
  WHERE key IN ('bot_name', 'bot_greeting', 'bot_think_min', 'bot_think_max', 'chat_color_default');

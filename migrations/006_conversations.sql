-- محادثات متعددة لكل عميل، بأرشيف — كما في هوستنجر.
-- كانت المحادثة خيطًا واحدًا لا ينتهي لكل عميل؛ صارت محادثات مستقلة:
-- يغلق العميل واحدة فتُحفظ في سجله، ويفتح جديدة نظيفة متى شاء.

CREATE TABLE IF NOT EXISTS conversations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  mode         TEXT NOT NULL DEFAULT 'bot'  CHECK (mode IN ('bot','live')),
  escalated_at TEXT,
  created_at   TEXT NOT NULL,
  last_at      TEXT NOT NULL,
  closed_at    TEXT,
  closed_by    TEXT CHECK (closed_by IN ('client','admin',NULL)),
  fail_streak  INTEGER NOT NULL DEFAULT 0   -- محاولات المساعد الفاشلة المتتالية
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, status, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_open ON conversations(status, mode, last_at DESC);

ALTER TABLE chat_messages ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id, id);

-- ترحيل ما مضى: كل عميل له رسائل تُجمَع في محادثة واحدة تحمل تاريخها
INSERT INTO conversations (user_id, title, status, mode, escalated_at, created_at, last_at)
SELECT m.user_id,
       'محادثة سابقة',
       CASE WHEN u.support_mode = 'live' THEN 'open' ELSE 'closed' END,
       COALESCE(u.support_mode, 'bot'),
       u.escalated_at,
       MIN(m.created_at),
       MAX(m.created_at)
  FROM chat_messages m
  JOIN users u ON u.id = m.user_id
 GROUP BY m.user_id;

UPDATE chat_messages
   SET conversation_id = (
     SELECT c.id FROM conversations c WHERE c.user_id = chat_messages.user_id LIMIT 1
   )
 WHERE conversation_id IS NULL;

-- ربط التحويلات السابقة بمحادثاتها
ALTER TABLE escalations ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE;
UPDATE escalations
   SET conversation_id = (
     SELECT c.id FROM conversations c WHERE c.user_id = escalations.user_id ORDER BY c.id LIMIT 1
   )
 WHERE conversation_id IS NULL;

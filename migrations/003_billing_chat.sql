-- الاشتراك والتحصيل والشات المباشر

-- 1) حالة الاشتراك لكل عميل
ALTER TABLE users ADD COLUMN trial_ends_at TEXT;          -- نهاية الـ 6 شهور المجانية
ALTER TABLE users ADD COLUMN grace_days INTEGER NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN whatsapp TEXT;               -- رقم العميل للتواصل
ALTER TABLE users ADD COLUMN billing_note TEXT;           -- ملاحظة تظهر للعميل
ALTER TABLE users ADD COLUMN restricted_at TEXT;          -- متى قُفلت المزايا
ALTER TABLE users ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0;  -- إعفاء يدوي من القفل

-- 2) كود مرجعي لكل فاتورة — إنستا باي وفودافون كاش بلا API،
--    فالكود هو ما يربط التحويل بالفاتورة عند المطابقة اليدوية
ALTER TABLE invoices ADD COLUMN reference_code TEXT;
CREATE INDEX IF NOT EXISTS idx_inv_ref ON invoices(reference_code);

-- 3) إشعار العميل بتحويل نفّذه — يسرّع المطابقة ويقلّل المكالمات
CREATE TABLE IF NOT EXISTS payment_claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id  INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  at          TEXT NOT NULL,
  method      TEXT NOT NULL CHECK (method IN ('instapay','vodafone','other')),
  amount_cents INTEGER NOT NULL,
  sender_ref  TEXT,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','confirmed','rejected')),
  handled_at  TEXT,
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON payment_claims(status, at DESC);

-- 4) الشات المباشر — رسالة العميل تصل لوحة الأدمن فورًا
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('client','admin','system')),
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  read_by_admin  INTEGER NOT NULL DEFAULT 0,
  read_by_client INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_unread ON chat_messages(read_by_admin, id);

-- 5) تذكيرات مُرسَلة — نمنع تكرار نفس التذكير في نفس اليوم
CREATE TABLE IF NOT EXISTS billing_reminders (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  at       TEXT NOT NULL,
  day      TEXT NOT NULL,
  UNIQUE (user_id, kind, day)
);

-- 6) العملاء الحاليون: فترة تجربة 6 شهور من تاريخ إنشاء الحساب
UPDATE users
   SET trial_ends_at = datetime(created_at, '+6 months')
 WHERE role = 'client' AND trial_ends_at IS NULL;

-- 7) إعدادات الدفع الافتراضية
INSERT INTO settings(key, value) VALUES
  ('pay_instapay',   '01099576398'),
  ('pay_vodafone',   '01099576398'),
  ('pay_whatsapp',   '201099576398'),
  ('pay_holder',     'فريق مركز المواقع'),
  ('trial_months',   '6'),
  ('grace_days',     '5')
ON CONFLICT(key) DO NOTHING;

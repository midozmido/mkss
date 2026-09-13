-- تحصين بعد المراجعة: الفلوس بالقروش · روابط لمرة واحدة · فجوات المراقبة
-- · تجميعات يومية · سجل تدقيق

-- 1) الفلوس: أعداد صحيحة بالقروش. REAL يسبب أخطاء تقريب لا تُغتفر في الفواتير.
ALTER TABLE invoices ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
UPDATE invoices SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER);
UPDATE payments SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER);

-- 2) طلبات إعادة تعيين كلمة السر — لا تُنفَّذ تلقائيًا، الأدمن هو من يصدر الرابط
CREATE TABLE IF NOT EXISTS reset_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  ip           TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','issued','used','denied')),
  handled_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reset_status ON reset_requests(status, requested_at DESC);

-- 3) روابط لمرة واحدة (تفعيل / إعادة تعيين). نخزّن تجزئة التوكن لا التوكن نفسه،
--    حتى لا تكشف نسخة احتياطية مسربة روابط صالحة.
CREATE TABLE IF NOT EXISTS one_time_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('activate','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_otl_user ON one_time_links(user_id, kind);

-- 4) فجوات المراقبة — بند أمانة: لا نحسب وقتًا لم نكن نراقب فيه كوقت تشغيل
CREATE TABLE IF NOT EXISTS monitor_gaps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at   TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'unknown'
             CHECK (reason IN ('restart','shutdown','network','unknown'))
);
CREATE INDEX IF NOT EXISTS idx_gaps_time ON monitor_gaps(started_at DESC);

-- 5) تجميعات يومية — 100 موقع كل 5 دقائق = 8.6 مليون صف سنويًا بدون هذا
CREATE TABLE IF NOT EXISTS checks_daily (
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  checks     INTEGER NOT NULL,
  ok_checks  INTEGER NOT NULL,
  avg_ms     INTEGER,
  max_ms     INTEGER,
  min_health INTEGER,
  avg_health INTEGER,
  PRIMARY KEY (site_id, day)
);

-- 6) سجل تدقيق — من فعل ماذا ومتى، خصوصًا المال وكلمات السر
CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  actor_id INTEGER,
  action   TEXT NOT NULL,
  target   TEXT,
  detail   TEXT,
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

-- 7) حالة الفحص المتتالي — لمنع الإنذارات الكاذبة
ALTER TABLE sites ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN next_check_at TEXT;

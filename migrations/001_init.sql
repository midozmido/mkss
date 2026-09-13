-- بنية قاعدة البيانات — SQLite عبر node:sqlite (مدمج في Node)

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'client',   -- client | admin
  phone         TEXT,
  company       TEXT,
  mvp_url       TEXT,                             -- رابط منتج العميل (زرار الـ MVP)
  mvp_label     TEXT,                             -- اسم الزرار كما يظهر للعميل
  locale        TEXT NOT NULL DEFAULT 'ar',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  url                 TEXT NOT NULL,
  platform            TEXT,        -- wordpress | shopify | salla | ...
  platform_version    TEXT,
  platform_confidence INTEGER NOT NULL DEFAULT 0,
  platform_extras     TEXT,        -- JSON: إضافات/تقنيات مكتشفة
  platform_checked_at TEXT,
  plan                TEXT NOT NULL DEFAULT 'basic',
  interval_sec        INTEGER NOT NULL DEFAULT 300,
  active              INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  created_at          TEXT NOT NULL,
  last_checked_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);

CREATE TABLE IF NOT EXISTS checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  at            TEXT NOT NULL,
  ok            INTEGER NOT NULL,
  status_code   INTEGER,
  response_ms   INTEGER,
  ttfb_ms       INTEGER,
  page_bytes    INTEGER,
  redirects     INTEGER NOT NULL DEFAULT 0,
  final_url     TEXT,
  error         TEXT,
  dns_ok        INTEGER,
  dns_ms        INTEGER,
  ssl_valid     INTEGER,
  ssl_days_left INTEGER,
  ssl_issuer    TEXT,
  sec_score     INTEGER,
  health_score  INTEGER,
  platform      TEXT,
  detail        TEXT            -- JSON بالتفاصيل الكاملة
);
CREATE INDEX IF NOT EXISTS idx_checks_site_at ON checks(site_id, at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,      -- down | ssl_expiring | ssl_invalid | slow | dns
  severity   TEXT NOT NULL DEFAULT 'major',
  detail     TEXT,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  resolved   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incidents_site ON incidents(site_id, resolved);

CREATE TABLE IF NOT EXISTS maintenance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  at           TEXT NOT NULL,
  type         TEXT NOT NULL,     -- update | backup | security | fix | content | audit
  title        TEXT NOT NULL,
  notes        TEXT,
  performed_by TEXT,
  status       TEXT NOT NULL DEFAULT 'done',  -- done | pending | scheduled
  next_due_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_site ON maintenance(site_id, at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  number      TEXT NOT NULL UNIQUE,
  description TEXT,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EGP',
  issued_at   TEXT NOT NULL,
  due_at      TEXT,
  status      TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | partial | paid | void
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_user ON invoices(user_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  amount     REAL NOT NULL,
  method     TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_inv ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id    INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',    -- open | answered | closed
  priority   TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, status);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tmsg_ticket ON ticket_messages(ticket_id, id);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

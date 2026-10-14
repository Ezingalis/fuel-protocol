-- Fuel Protocol database schema (Cloudflare D1)
-- Apply with:  npx wrangler d1 execute fuel-protocol-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

-- One JSON blob per user: the same shape the app keeps in the browser.
CREATE TABLE IF NOT EXISTS state (
  user_id     TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sign-in links. Only the hash of the token is stored, never the token itself.
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  ip_hash     TEXT              -- SHA-256 of requester IP, for the daily cap
);

CREATE INDEX IF NOT EXISTS idx_links_email   ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_links_expires ON magic_links(expires_at);
CREATE INDEX IF NOT EXISTS idx_links_ip      ON magic_links(ip_hash);

-- Meal plans shared by code. Creating and fetching both require a session.
CREATE TABLE IF NOT EXISTS shared_plans (
  code        TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_by ON shared_plans(created_by);

-- One row per workout-PDF import attempt; caps AI spend per user per day.
CREATE TABLE IF NOT EXISTS gym_imports (
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  engine      TEXT
);

CREATE INDEX IF NOT EXISTS idx_imports_user ON gym_imports(user_id, created_at);

-- Access requests from people the owner hasn't approved yet. One row per email, ever.
CREATE TABLE IF NOT EXISTS approvals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  token_hash  TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL,            -- pending | approved | denied
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  decided_at  INTEGER,
  ip_hash     TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_ip ON approvals(ip_hash);

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

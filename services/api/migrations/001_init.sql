-- 001_init.sql — initial schema.
--
-- Migrations are FORWARD-ONLY and IMMUTABLE once shipped: never edit this file after it has run
-- anywhere; to change the schema, add 002_*.sql. The app applies any unapplied migrations on
-- startup (see src/db.ts). The runner records what it has applied in `schema_migrations` (which
-- it creates itself — it can't live in a migration, chicken-and-egg).
--
-- Timestamps are ISO-8601 text via datetime('now') (UTC). SQLite has no native datetime type;
-- text sorts correctly and is human-readable, which is the right trade at this scale.

PRAGMA foreign_keys = ON;

-- ── users ──────────────────────────────────────────────────────────────────────
-- One row per signed-in GitHub identity. `github_id` is GitHub's stable numeric id (the `login`
-- can be renamed by the user; the id can't), so we key identity off it.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,                              -- our uuid
  github_id   INTEGER NOT NULL UNIQUE,                       -- stable id from GitHub
  login       TEXT    NOT NULL,                              -- github username (mutable)
  name        TEXT,
  avatar_url  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── sessions ───────────────────────────────────────────────────────────────────
-- A session id is what gets signed into the httpOnly cookie. The row holds the metadata; we
-- rotate the id on login and expire on disuse. Deleting a user cascades their sessions.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,                            -- random opaque id (the cookie value)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,                               -- idle/absolute expiry (ISO-8601 UTC)
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ── setups ─────────────────────────────────────────────────────────────────────
-- The working copy of a user's terminal config. `ast` is the compiler's input AST as JSON text
-- (Phase 4) — we store the source of truth, not the compiled output, so a newer compiler can
-- re-emit. (CHECK json_valid keeps obviously-broken blobs out at the storage boundary.)
CREATE TABLE setups (
  id          TEXT PRIMARY KEY,                              -- uuid
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  ast         TEXT NOT NULL CHECK (json_valid(ast)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_setups_user ON setups(user_id);

-- ── setup_versions ───────────────────────────────────────────────────────────────
-- Immutable snapshots created by POST /setups/:id/publish. `version` is monotonic per setup
-- (1, 2, 3 …); (setup_id, version) is unique so two publishes can't collide.
CREATE TABLE setup_versions (
  id          TEXT    PRIMARY KEY,                           -- uuid
  setup_id    TEXT    NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  ast         TEXT    NOT NULL CHECK (json_valid(ast)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (setup_id, version)
);
CREATE INDEX idx_versions_setup ON setup_versions(setup_id);

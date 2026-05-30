/**
 * src/store.ts — data access for users + sessions. Plain SQL via better-sqlite3, no ORM.
 *
 * Session policy (the plan's "rotate on login; expire on disuse"):
 *   - login creates a *new* session id (we never reuse one);
 *   - every authenticated lookup slides `expires_at` forward (idle expiry) and stamps
 *     `last_seen_at` — so an active session stays alive and an abandoned one lapses.
 *
 * Synchronous by design (better-sqlite3): these are plain function calls, no `await`.
 */

import { randomUUID } from 'node:crypto';
import { randomToken } from './crypto.ts';
import type { DB } from './db.ts';

export type User = {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
};

/** Identity fields we read back from GitHub's `/user`. */
export type GithubIdentity = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
};

/** 30 days of idle life; slides forward on each authenticated request. */
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

/** Insert or update the user for a GitHub identity (keyed on the stable `github_id`). */
export function upsertUserByGithub(db: DB, gh: GithubIdentity): User {
  const existing = db.prepare('SELECT * FROM users WHERE github_id = ?').get(gh.id) as
    | User
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE users SET login = ?, name = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(gh.login, gh.name ?? null, gh.avatar_url ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO users (id, github_id, login, name, avatar_url) VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), gh.id, gh.login, gh.name ?? null, gh.avatar_url ?? null);
  }
  return db.prepare('SELECT * FROM users WHERE github_id = ?').get(gh.id) as User;
}

/** Create a fresh session for `userId`; returns the opaque session id (the cookie value). */
export function createSession(
  db: DB,
  userId: string,
  userAgent?: string,
  ttlSec: number = SESSION_TTL_SEC,
): string {
  const id = randomToken(32);
  db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent)
     VALUES (?, ?, datetime('now', ?), ?)`,
  ).run(id, userId, `${ttlSec >= 0 ? '+' : ''}${ttlSec} seconds`, userAgent ?? null);
  return id;
}

/**
 * Resolve a session id to its user if the session exists and hasn't expired. Side effect: slides
 * the expiry forward and updates `last_seen_at` (idle-expiry). Returns null for unknown/expired.
 */
export function getSessionUser(
  db: DB,
  sessionId: string,
  ttlSec: number = SESSION_TTL_SEC,
): User | null {
  const session = db
    .prepare(`SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`)
    .get(sessionId) as { user_id: string } | undefined;
  if (!session) return null;
  db.prepare(
    `UPDATE sessions SET last_seen_at = datetime('now'), expires_at = datetime('now', ?) WHERE id = ?`,
  ).run(`+${ttlSec} seconds`, sessionId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as User;
}

/** Delete a session (logout). No-op if it doesn't exist. */
export function deleteSession(db: DB, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ── setups ───────────────────────────────────────────────────────────────────────
//
// The `ast` column is JSON *text*; the API speaks JSON *objects*. We JSON.stringify on the way in
// and JSON.parse on the way out, so callers never touch the string form. Every query is scoped to
// `user_id` — a setup you don't own simply doesn't exist as far as your requests are concerned
// (the handlers turn a null into 404, not 403, so we don't leak which ids exist).

type SetupRow = {
  id: string;
  user_id: string;
  name: string;
  ast: string;
  created_at: string;
  updated_at: string;
};

export type Setup = {
  id: string;
  name: string;
  ast: unknown;
  created_at: string;
  updated_at: string;
};

export type SetupSummary = Omit<Setup, 'ast'>;

function rowToSetup(r: SetupRow): Setup {
  return {
    id: r.id,
    name: r.name,
    ast: JSON.parse(r.ast),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** A user's setups, newest-touched first. Summaries (no `ast`) — the list view doesn't need it. */
export function listSetups(db: DB, userId: string): SetupSummary[] {
  return db
    .prepare(
      'SELECT id, name, created_at, updated_at FROM setups WHERE user_id = ? ORDER BY updated_at DESC',
    )
    .all(userId) as SetupSummary[];
}

/** One setup with its full `ast`, or null if it doesn't exist or isn't this user's. */
export function getSetup(db: DB, userId: string, id: string): Setup | null {
  const r = db.prepare('SELECT * FROM setups WHERE id = ? AND user_id = ?').get(id, userId) as
    | SetupRow
    | undefined;
  return r ? rowToSetup(r) : null;
}

export function createSetup(db: DB, userId: string, name: string, ast: unknown): Setup {
  const id = randomUUID();
  db.prepare('INSERT INTO setups (id, user_id, name, ast) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    name,
    JSON.stringify(ast),
  );
  return getSetup(db, userId, id)!;
}

/** Patch name and/or ast. Returns the updated setup, or null if not found / not owned. */
export function updateSetup(
  db: DB,
  userId: string,
  id: string,
  fields: { name?: string; ast?: unknown },
): Setup | null {
  const existing = getSetup(db, userId, id);
  if (!existing) return null;
  const name = fields.name ?? existing.name;
  const ast = fields.ast !== undefined ? fields.ast : existing.ast;
  db.prepare(
    `UPDATE setups SET name = ?, ast = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).run(name, JSON.stringify(ast), id, userId);
  return getSetup(db, userId, id);
}

/** Delete a setup. Returns true if a row was removed (cascades to its versions). */
export function deleteSetup(db: DB, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM setups WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export type PublishedVersion = { id: string; setup_id: string; version: number; created_at: string };

/**
 * Snapshot a setup's current `ast` into an immutable version. The next version number
 * (MAX+1) and the insert happen in one transaction so concurrent publishes can't collide on
 * `(setup_id, version)`. Returns the version, or null if the setup isn't found / not owned.
 */
export function publishSetup(db: DB, userId: string, id: string): PublishedVersion | null {
  return db.transaction((): PublishedVersion | null => {
    const setup = db.prepare('SELECT ast FROM setups WHERE id = ? AND user_id = ?').get(id, userId) as
      | { ast: string }
      | undefined;
    if (!setup) return null;
    const { next } = db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM setup_versions WHERE setup_id = ?')
      .get(id) as { next: number };
    const vid = randomUUID();
    db.prepare('INSERT INTO setup_versions (id, setup_id, version, ast) VALUES (?, ?, ?, ?)').run(
      vid,
      id,
      next,
      setup.ast,
    );
    return db
      .prepare('SELECT id, setup_id, version, created_at FROM setup_versions WHERE id = ?')
      .get(vid) as PublishedVersion;
  })();
}

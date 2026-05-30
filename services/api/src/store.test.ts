/**
 * store.test.ts — users + sessions against a real (in-memory) SQLite, migrated from migrations/.
 *
 * This is an *integration* test of the SQL itself (upsert semantics, FK, expiry arithmetic), but
 * it needs no fixtures and no running server: `:memory:` + `migrate()` builds the schema fresh.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from './db.ts';
import {
  upsertUserByGithub,
  createSession,
  getSessionUser,
  deleteSession,
} from './store.ts';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('upsertUserByGithub inserts a new user', () => {
  const db = freshDb();
  const u = upsertUserByGithub(db, { id: 42, login: 'octocat', name: 'The Cat', avatar_url: 'x' });
  assert.equal(u.github_id, 42);
  assert.equal(u.login, 'octocat');
  assert.match(u.id, /^[0-9a-f-]{36}$/); // a uuid
});

test('upsertUserByGithub updates login on re-login (same github_id, no new row)', () => {
  const db = freshDb();
  const first = upsertUserByGithub(db, { id: 42, login: 'octocat' });
  const second = upsertUserByGithub(db, { id: 42, login: 'octocat-renamed', name: 'New' });
  assert.equal(second.id, first.id); // same row
  assert.equal(second.login, 'octocat-renamed');
  const count = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
  assert.equal(count, 1);
});

test('createSession + getSessionUser resolves to the user', () => {
  const db = freshDb();
  const u = upsertUserByGithub(db, { id: 7, login: 'me' });
  const sid = createSession(db, u.id, 'test-agent');
  const got = getSessionUser(db, sid);
  assert.equal(got?.id, u.id);
});

test('getSessionUser returns null for an expired session', () => {
  const db = freshDb();
  const u = upsertUserByGithub(db, { id: 7, login: 'me' });
  const sid = createSession(db, u.id, undefined, -10); // already expired 10s ago
  assert.equal(getSessionUser(db, sid), null);
});

test('getSessionUser returns null for an unknown session id', () => {
  const db = freshDb();
  assert.equal(getSessionUser(db, 'nope'), null);
});

test('deleteSession ends the session', () => {
  const db = freshDb();
  const u = upsertUserByGithub(db, { id: 7, login: 'me' });
  const sid = createSession(db, u.id);
  deleteSession(db, sid);
  assert.equal(getSessionUser(db, sid), null);
});

test('deleting a user cascades to their sessions (FK ON DELETE CASCADE)', () => {
  const db = freshDb();
  const u = upsertUserByGithub(db, { id: 7, login: 'me' });
  const sid = createSession(db, u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  const remaining = (db.prepare('SELECT count(*) AS n FROM sessions WHERE id = ?').get(sid) as { n: number }).n;
  assert.equal(remaining, 0);
});

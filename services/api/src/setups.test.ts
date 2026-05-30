/**
 * setups.test.ts — pure input validation + the store CRUD against an in-memory SQLite.
 * (The HTTP dispatch is verified by running the server.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from './db.ts';
import { upsertUserByGithub } from './store.ts';
import {
  listSetups,
  getSetup,
  createSetup,
  updateSetup,
  deleteSetup,
  publishSetup,
} from './store.ts';
import { validateSetupInput } from './setups.ts';

// ── validateSetupInput (pure) ──────────────────────────────────────────────────

test('validateSetupInput (create) requires name and ast', () => {
  assert.deepEqual(validateSetupInput({ name: 'x', ast: {} }, false), {
    ok: true,
    value: { name: 'x', ast: {} },
  });
  assert.equal(validateSetupInput({ name: 'x' }, false).ok, false); // missing ast
  assert.equal(validateSetupInput({ ast: {} }, false).ok, false); // missing name
});

test('validateSetupInput rejects bad shapes', () => {
  assert.equal(validateSetupInput(null, false).ok, false);
  assert.equal(validateSetupInput([], false).ok, false);
  assert.equal(validateSetupInput({ name: '', ast: {} }, false).ok, false); // blank name
  assert.equal(validateSetupInput({ name: 'x', ast: 'nope' }, false).ok, false); // ast not object
  assert.equal(validateSetupInput({ name: 'x'.repeat(201), ast: {} }, false).ok, false); // too long
});

test('validateSetupInput (patch) allows a subset but not nothing', () => {
  assert.deepEqual(validateSetupInput({ name: 'renamed' }, true), {
    ok: true,
    value: { name: 'renamed' },
  });
  assert.deepEqual(validateSetupInput({ ast: { a: 1 } }, true), {
    ok: true,
    value: { ast: { a: 1 } },
  });
  assert.equal(validateSetupInput({}, true).ok, false); // nothing to update
});

// ── store CRUD (in-memory DB) ────────────────────────────────────────────────────

function freshDbWithUser() {
  const db = openDb(':memory:');
  migrate(db);
  const user = upsertUserByGithub(db, { id: 1, login: 'a' });
  return { db, user };
}

test('create → get round-trips the ast as a parsed object', () => {
  const { db, user } = freshDbWithUser();
  const ast = { version: 2, modules: ['git-aliases'] };
  const created = createSetup(db, user.id, 'default', ast);
  const fetched = getSetup(db, user.id, created.id);
  assert.deepEqual(fetched?.ast, ast);
  assert.equal(fetched?.name, 'default');
});

test('listSetups returns summaries without the ast', () => {
  const { db, user } = freshDbWithUser();
  createSetup(db, user.id, 'one', { a: 1 });
  createSetup(db, user.id, 'two', { b: 2 });
  const list = listSetups(db, user.id);
  assert.equal(list.length, 2);
  assert.ok(!('ast' in list[0]));
});

test('updateSetup patches name and ast independently', () => {
  const { db, user } = freshDbWithUser();
  const s = createSetup(db, user.id, 'orig', { a: 1 });
  const renamed = updateSetup(db, user.id, s.id, { name: 'new' });
  assert.equal(renamed?.name, 'new');
  assert.deepEqual(renamed?.ast, { a: 1 }); // ast untouched
  const reAst = updateSetup(db, user.id, s.id, { ast: { a: 2 } });
  assert.deepEqual(reAst?.ast, { a: 2 });
  assert.equal(reAst?.name, 'new'); // name untouched
});

test('deleteSetup removes it; publish/get then 404 (null)', () => {
  const { db, user } = freshDbWithUser();
  const s = createSetup(db, user.id, 'x', {});
  assert.equal(deleteSetup(db, user.id, s.id), true);
  assert.equal(deleteSetup(db, user.id, s.id), false); // already gone
  assert.equal(getSetup(db, user.id, s.id), null);
});

test('publishSetup snapshots and increments version monotonically', () => {
  const { db, user } = freshDbWithUser();
  const s = createSetup(db, user.id, 'x', { v: 1 });
  const v1 = publishSetup(db, user.id, s.id);
  updateSetup(db, user.id, s.id, { ast: { v: 2 } });
  const v2 = publishSetup(db, user.id, s.id);
  assert.equal(v1?.version, 1);
  assert.equal(v2?.version, 2);
  // The first snapshot kept the old ast (immutability).
  const snap = db.prepare('SELECT ast FROM setup_versions WHERE id = ?').get(v1!.id) as { ast: string };
  assert.deepEqual(JSON.parse(snap.ast), { v: 1 });
});

test('a setup is invisible to a different user (ownership scoping → 404, not 403)', () => {
  const { db, user } = freshDbWithUser();
  const other = upsertUserByGithub(db, { id: 2, login: 'b' });
  const s = createSetup(db, user.id, 'mine', { x: 1 });
  assert.equal(getSetup(db, other.id, s.id), null);
  assert.equal(updateSetup(db, other.id, s.id, { name: 'hijack' }), null);
  assert.equal(deleteSetup(db, other.id, s.id), false);
  assert.equal(publishSetup(db, other.id, s.id), null);
  // owner still sees it intact
  assert.equal(getSetup(db, user.id, s.id)?.name, 'mine');
});

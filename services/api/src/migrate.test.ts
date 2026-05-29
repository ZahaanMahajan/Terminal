/**
 * migrate.test.ts — pure migration-planning logic.
 *
 * Uses Node's built-in test runner (`node:test` + `node:assert`) — no Vitest/Jest dependency, in
 * the same "own your tools / defer libraries" spirit as the rest of the project. Run with
 * `npm test` (which is `node --import tsx --test "src/**​/*.test.ts"`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidMigrationName, pendingMigrations } from './migrate.ts';

test('isValidMigrationName accepts NNN_snake_name.sql', () => {
  assert.ok(isValidMigrationName('001_init.sql'));
  assert.ok(isValidMigrationName('002_add_setups_index.sql'));
  assert.ok(isValidMigrationName('010_drop_legacy.sql'));
});

test('isValidMigrationName rejects malformed names', () => {
  assert.ok(!isValidMigrationName('init.sql')); // no ordinal
  assert.ok(!isValidMigrationName('1_init.sql')); // not zero-padded to 3
  assert.ok(!isValidMigrationName('001_init.txt')); // wrong extension
  assert.ok(!isValidMigrationName('001-init.sql')); // dash, not underscore
  assert.ok(!isValidMigrationName('001_Init.sql')); // uppercase
  assert.ok(!isValidMigrationName('001_.sql')); // empty name
  assert.ok(!isValidMigrationName('.DS_Store'));
  assert.ok(!isValidMigrationName('README.md'));
});

test('pendingMigrations returns valid files in ordinal order', () => {
  const entries = ['003_c.sql', '001_a.sql', '002_b.sql'];
  assert.deepEqual(pendingMigrations(entries, []), ['001_a.sql', '002_b.sql', '003_c.sql']);
});

test('zero-padding makes 010 sort after 009 (not after 001)', () => {
  const entries = ['010_j.sql', '002_b.sql', '009_i.sql', '001_a.sql'];
  assert.deepEqual(pendingMigrations(entries, []), [
    '001_a.sql',
    '002_b.sql',
    '009_i.sql',
    '010_j.sql',
  ]);
});

test('pendingMigrations skips already-applied migrations', () => {
  const entries = ['001_a.sql', '002_b.sql', '003_c.sql'];
  assert.deepEqual(pendingMigrations(entries, ['001_a.sql', '002_b.sql']), ['003_c.sql']);
});

test('pendingMigrations ignores non-migration entries in the directory', () => {
  const entries = ['001_a.sql', 'README.md', '.DS_Store', '002_b.sql', '001_a.sql.swp'];
  assert.deepEqual(pendingMigrations(entries, []), ['001_a.sql', '002_b.sql']);
});

test('pendingMigrations is empty when everything is applied', () => {
  const entries = ['001_a.sql', '002_b.sql'];
  assert.deepEqual(pendingMigrations(entries, ['001_a.sql', '002_b.sql']), []);
});

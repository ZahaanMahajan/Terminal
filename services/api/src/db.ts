/**
 * src/db.ts — the database glue: open SQLite, apply migrations on startup.
 *
 * The *decision* of which migrations to run is pure (migrate.ts, tested). This module is the I/O:
 * read the `migrations/` directory, read the already-applied set from `schema_migrations`, and run
 * the rest, each in its own transaction so a failure leaves the DB on a clean boundary.
 *
 * better-sqlite3 is synchronous by design — there is no connection pool and no `await`. For a
 * single-process, single-file database that's a feature: queries are plain function calls, and a
 * `db.transaction(fn)` is a real, synchronous transaction. WAL mode lets reads proceed during a
 * write, which is all the concurrency this service needs (see SQLite's WAL docs).
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pendingMigrations } from './migrate.ts';

export type DB = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Open (or create) the SQLite file with the pragmas this service relies on. */
export function openDb(path: string = process.env.TERMI_DB ?? './termi.db'): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // readers don't block the single writer
  db.pragma('foreign_keys = ON'); // enforce the REFERENCES … ON DELETE CASCADE in the schema
  return db;
}

/**
 * Apply every not-yet-applied migration from `migrations/`, in order, recording each in
 * `schema_migrations`. Returns the names applied *this run* (empty when already up to date).
 * Idempotent: safe to call on every startup.
 */
export function migrate(db: DB): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     );`,
  );

  const applied = (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
    (r) => r.name,
  );
  const pending = pendingMigrations(readdirSync(MIGRATIONS_DIR), applied);

  const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    // One transaction per migration: the SQL and its bookkeeping row commit together or not at all.
    db.transaction(() => {
      db.exec(sql);
      record.run(name);
    })();
  }
  return pending;
}

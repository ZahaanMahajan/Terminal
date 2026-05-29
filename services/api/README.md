# `services/api/` — Phase 6: persistence & a tiny backend

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 6 and the §9 repo shape. A single Node service:
> SQLite, REST, hand-rolled auth, app-owned migrations. **No ORM, no framework, no infra** — the
> whole point of waiting until Phase 6 is that by now we know exactly what we need a database for.

Separate from `services/pty/` on purpose: that one is remote-code-execution-by-design and stays
minimal; this one will hold sessions and personal data, so it gets its own process and boundary.

## Status

- ✅ **Step 1 (this):** foundation — SQLite + an app-owned migration runner + `GET /health`.
- ⏳ **Step 2:** auth — GitHub OAuth (Authorization Code + PKCE), signed httpOnly cookie sessions,
  `POST /auth/github`, `GET /me`.
- ⏳ **Step 3:** setups — `GET/POST/PATCH/DELETE /setups`, `POST /setups/:id/publish`.

## ⚠ Security — localhost only

Binds to **`127.0.0.1`**. It isn't RCE-by-design like the PTY service, but it will soon hold
sessions and user data; there's no reason to listen on a public interface in local dev. Exposing
it is a deliberate deployment decision, never a default.

## Run it

```bash
cd services/api
npm install          # better-sqlite3 ships prebuilt binaries (no C toolchain needed)
npm start            # opens ./termi.db, applies migrations, → http://127.0.0.1:7683
npm test             # pure migration-planning tests (Node's built-in runner)
npm run typecheck    # tsc --noEmit
```

Override the DB path with `TERMI_DB`, the port with `TERMI_API_PORT`.

## The database

`./termi.db` (gitignored), opened in **WAL mode** with `foreign_keys = ON`. Schema (`migrations/001_init.sql`):

| table            | what it holds |
|------------------|---------------|
| `users`          | one row per GitHub identity, keyed off the stable numeric `github_id` |
| `sessions`       | session id (the signed cookie value) + metadata; cascades on user delete |
| `setups`         | a user's working config; `ast` is the Phase-4 AST as JSON (`CHECK json_valid`) |
| `setup_versions` | immutable publish snapshots; `(setup_id, version)` unique |

We store the **AST**, not compiled output, so a newer compiler can always re-emit.

## Migrations — owned by the app, by hand (a learning moment)

No migration library. The rules:

- A migration is `NNN_snake_name.sql` — a zero-padded 3-digit ordinal. **Zero-padding is the
  trick:** lexicographic sort then equals numeric order, so `001 < 002 < … < 010` for free.
- **Forward-only and immutable.** Never edit a shipped migration; add the next number. The DB is a
  ratchet.
- On startup the app reads `migrations/`, diffs against the `schema_migrations` table (which the
  runner creates itself — it can't live in a migration), and applies the rest, **each in its own
  transaction** so a failure leaves the DB on a clean boundary.
- Rebuild the schema on an empty machine in one command: `npm start` (or `npm test` for the logic).

The split that makes this testable:

- `src/migrate.ts` — **pure** planning (`isValidMigrationName`, `pendingMigrations`). No I/O.
  Exhaustively unit-tested (`src/migrate.test.ts`, `node:test`).
- `src/db.ts` — the **glue**: `openDb`, `migrate(db)` (read files, read applied set, run the rest).
  Verified by running (the smoke path: fresh DB → 5 tables, second run a no-op, CHECK + FK bite).

## Why `node:test` and not Vitest

Same "own your tools / defer libraries" spirit as the rest of the project: Node ships a test
runner, so the backend's pure logic needs zero extra dependencies. `npm test` is
`node --import tsx --test "src/**/*.test.ts"`.

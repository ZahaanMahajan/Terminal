# `services/api/` — Phase 6: persistence & a tiny backend

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 6 and the §9 repo shape. A single Node service:
> SQLite, REST, hand-rolled auth, app-owned migrations. **No ORM, no framework, no infra** — the
> whole point of waiting until Phase 6 is that by now we know exactly what we need a database for.

Separate from `services/pty/` on purpose: that one is remote-code-execution-by-design and stays
minimal; this one will hold sessions and personal data, so it gets its own process and boundary.

## Status

- ✅ **Step 1:** foundation — SQLite + an app-owned migration runner + `GET /health`.
- ✅ **Step 2:** auth — GitHub OAuth (Authorization Code + PKCE), signed httpOnly cookie
  sessions, `/auth/github/login`, `/auth/github/callback`, `GET /me`, `POST /auth/logout`.
- ✅ **Step 3 (this):** setups CRUD — `GET/POST /setups`, `GET/PATCH/DELETE /setups/:id`,
  `POST /setups/:id/publish`. The backend half of Phase 6 is done; the web-app wiring (sign-in +
  save/load UI) is the remaining piece to meet the "sign in, save, load on another browser"
  exit criterion.

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

## Auth (step 2) — GitHub OAuth, by hand

The browser never touches a token (a "backend-for-frontend" flow): the API runs the whole
Authorization Code + PKCE exchange server-side and hands back a **signed httpOnly cookie**.

```
GET  /auth/github/login      → mint state + PKCE verifier (stashed in a short-lived signed,
                                httpOnly, path-scoped txn cookie), 302 to GitHub's authorize URL
GET  /auth/github/callback   → verify state (CSRF), exchange code + verifier for a token, fetch the
                                GitHub identity, upsert the user, create a session, set the session
                                cookie, 302 back to the web app
GET  /me                     → the session's user, or 401         (CORS + credentials)
POST /auth/logout            → delete the session + clear the cookie (CORS + credentials)
```

PKCE (RFC 7636) and `state` (RFC 6749) are implemented from the RFCs — no auth library, by design.
Scope is minimized to `read:user`. Sessions slide their expiry on use (idle expiry) and a new id is
minted on each login. The signed cookie is tamper-evident (HMAC-SHA256), `HttpOnly` (JS can't read
it — XSS can't steal it), `SameSite=Lax`, and `Secure` when `TERMI_API_BASE` is https.

### Enable it

1. Register a **GitHub OAuth App** (Settings → Developer settings → OAuth Apps):
   - **Homepage URL:** `http://localhost:5173`
   - **Authorization callback URL:** `http://localhost:7683/auth/github/callback`
2. Export the credentials and start:

```bash
export GITHUB_CLIENT_ID=...        # from the OAuth App
export GITHUB_CLIENT_SECRET=...
export TERMI_COOKIE_SECRET=$(openssl rand -base64 32)   # stable HMAC key (don't lose it)
npm start
```

| env | default | meaning |
|-----|---------|---------|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | required to enable `/auth/*` + `/me` (else they 503) |
| `TERMI_COOKIE_SECRET` | dev fallback (warns) | HMAC key for signed cookies |
| `TERMI_API_BASE`  | `http://localhost:7683` | this server's base; must match the OAuth App callback host |
| `TERMI_WEB_ORIGIN`| `http://localhost:5173` | post-login redirect target + the only allowed CORS origin |

> **Use `localhost`, not `127.0.0.1`, for both the web app and the API.** The session cookie is
> host-scoped; with both on `localhost` (differing only by port) the request from the web app to
> the API is *same-site*, so the `SameSite=Lax` cookie is sent on the credentialed `fetch`. Mixing
> `localhost` and `127.0.0.1` makes them different hosts and the cookie won't travel.

Try it: open `http://localhost:7683/auth/github/login` in a browser → authorize → you land back on
the web app; `curl -b` the session cookie against `/me` (or let the web app call it) to see your user.

## Setups (step 3) — the CRUD

All routes require a session (else 401) and are scoped to the caller — someone else's id is a
**404, never a 403** (we don't reveal which ids exist). CORS + credentials are enabled for the web
origin.

```
GET    /setups               → { setups: [ {id,name,created_at,updated_at}, … ] }   (summaries)
POST   /setups               { name, ast } → 201 the full setup
GET    /setups/:id           → 200 the setup (ast parsed back to JSON) | 404
PATCH  /setups/:id           { name?, ast? } → 200 updated | 404      (partial; ≥1 field)
DELETE /setups/:id           → 204 | 404
POST   /setups/:id/publish   → 201 { version } | 404     (immutable snapshot, version = MAX+1)
```

`ast` is stored as JSON *text* but the API speaks JSON *objects* (stringify in, parse out). Body
shape is validated (`validateSetupInput`, pure + tested); the *semantic* validity of an AST is the
compiler's job (Phase 4, client-side), with the `CHECK json_valid` column as the storage backstop.
Bodies are capped at 1 MB.

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

## Module map

| module | role | tested by |
|--------|------|-----------|
| `migrate.ts` | pure: which migrations run, in what order | `migrate.test.ts` |
| `db.ts` | glue: open SQLite, apply migrations | smoke / `store.test.ts` (in-memory) |
| `crypto.ts` | pure: random tokens, HMAC-signed cookies, PKCE S256 | `crypto.test.ts` (incl. RFC 7636 vector) |
| `cookies.ts` | pure: parse `Cookie`, serialize `Set-Cookie` | `cookies.test.ts` |
| `store.ts` | SQL: users + sessions | `store.test.ts` (`:memory:` + migrate) |
| `config.ts` | env → `AuthConfig` (null = auth disabled) | — |
| `github.ts` | OAuth: authorize URL (pure) + token/user fetch (network) | `github.test.ts` (URL only) |
| `store.ts` | SQL: + setups CRUD / publish | `setups.test.ts` (`:memory:`) |
| `setups.ts` | `/setups` dispatch + `validateSetupInput` (pure) | `setups.test.ts` |
| `auth.ts` | the auth route handlers + `currentUser` | by running |
| `server.ts` | router + CORS | by running |

## Why `node:test` and not Vitest

Same "own your tools / defer libraries" spirit as the rest of the project: Node ships a test
runner, so the backend's pure logic needs zero extra dependencies. `npm test` is
`node --import tsx --test "src/**/*.test.ts"` — 38 tests today. Pure logic (migrations, crypto,
cookies, setup validation) and SQL (store + setups CRUD, against `:memory:`) are unit-tested; the
network half of OAuth and the HTTP wiring are verified by running the real flow.

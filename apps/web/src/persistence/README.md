# `src/persistence/` — Phase 6: the browser client for the Termi API

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 6. The backend is `services/api/`; this is the
> web app's thin, typed client for it. The demo is `demos/SyncDemo.tsx` (the **Sync (P6)** tab).

## What this is

A small `fetch` wrapper that calls the REST API with **cookie credentials**, so the signed httpOnly
session cookie rides along and the browser never handles a token.

```
client.ts   getMe() · listSetups/getSetup/createSetup/updateSetup/deleteSetup/publishSetup ·
            logout() · loginUrl()                                           [+ client.test.ts]
index.ts    re-exports
```

- **`getMe()`** maps `401 → null` (not signed in); everything else throws `ApiError(status, message)`
  carrying the server's error text.
- **Login is a full-page navigation** to `loginUrl()` (`/auth/github/login`) — an OAuth redirect can't
  be a `fetch`. The API redirects back to this app; `getMe()` then picks up the session. A failed
  callback returns `?auth_error=<reason>`, which `SyncDemo` surfaces and clears from the URL.
- The AST you save/load is the **Phase-4 compiler's source of truth**: `SyncDemo` re-runs
  `compileRaw` on the loaded AST, so you see the same dotfiles regenerate.

## Config

`VITE_API_BASE` overrides the API base (default `http://localhost:7683`).

> Use **`localhost`** (not `127.0.0.1`) for both the web app and the API. The session cookie is
> host-scoped; with both on `localhost` (differing only by port) the credentialed `fetch` is
> *same-site*, so the `SameSite=Lax` cookie is sent. Mixing the two hostnames drops the cookie.

## Run the end-to-end

1. `cd services/api && npm start` with `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` set (see that
   README — register an OAuth App with callback `http://localhost:7683/auth/github/callback`).
2. `cd apps/web && npm run dev`, open `http://localhost:5173`, go to **Sync (P6)** → Sign in.
3. Save a setup; open the app in another browser signed in as the same GitHub user → it loads.

## Testing

`client.test.ts` stubs `global.fetch` to assert the client's *logic* — right URL/method, `credentials:
'include'`, the `{setups}` unwrap, `401 → null`, `204 → undefined`, and `ApiError` mapping. The
network itself and the OAuth round-trip are verified by running.

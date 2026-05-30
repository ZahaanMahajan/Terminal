/**
 * src/server.ts — Phase 6: the API.
 *
 * Open the DB, run migrations on startup, then route. Step 1 added /health; step 2 adds the auth
 * slice (GitHub OAuth + sessions). A hand-written router — no framework — because at four routes a
 * `switch` is clearer than any abstraction would be (rule of three: revisit when it hurts).
 *
 * Binds to 127.0.0.1 only. Not RCE-by-design like the PTY service, but it holds sessions + personal
 * data; listening publicly is a deliberate deployment choice, never a default.
 */

import { createServer } from 'node:http';
import { openDb, migrate, type DB } from './db.ts';
import { loadAuthConfig } from './config.ts';
import { json } from './respond.ts';
import {
  handleLogin,
  handleCallback,
  handleMe,
  handleLogout,
  corsHeaders,
} from './auth.ts';
import { handleSetups } from './setups.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.TERMI_API_PORT ?? 7683); // 7682 is the PTY service

const db: DB = openDb();
const appliedNow = migrate(db);
console.log(
  appliedNow.length ? `migrations: applied ${appliedNow.join(', ')}` : 'migrations: up to date',
);

const cfg = loadAuthConfig();
console.log(
  cfg
    ? `auth: GitHub OAuth enabled (callback ${cfg.callbackUrl})`
    : 'auth: disabled — set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET to enable /auth/* and /me',
);

const server = createServer((req, res) => {
  const method = req.method ?? 'GET';
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (method === 'GET' && pathname === '/health') {
    const { n } = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number };
    return json(res, 200, { ok: true, migrations: n, auth: cfg ? 'github' : 'disabled' });
  }

  const credentialed =
    pathname === '/me' ||
    pathname === '/auth/logout' ||
    pathname === '/setups' ||
    pathname.startsWith('/setups/');

  // CORS preflight for the web app's credentialed XHR.
  if (method === 'OPTIONS' && credentialed) {
    if (!cfg) return json(res, 503, { error: 'auth not configured' });
    return json(res, 204, null, {
      ...corsHeaders(req, cfg),
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
  }

  if (pathname.startsWith('/auth/') || pathname === '/me') {
    if (!cfg) {
      return json(res, 503, {
        error: 'auth not configured',
        hint: 'set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart',
      });
    }
    if (method === 'GET' && pathname === '/auth/github/login') return handleLogin(req, res, cfg);
    if (method === 'GET' && pathname === '/auth/github/callback') {
      return void handleCallback(req, res, db, cfg);
    }
    if (method === 'GET' && pathname === '/me') return handleMe(req, res, db, cfg);
    if (method === 'POST' && pathname === '/auth/logout') return handleLogout(req, res, db, cfg);
  }

  if (pathname === '/setups' || pathname.startsWith('/setups/')) {
    if (!cfg) {
      return json(res, 503, {
        error: 'auth not configured',
        hint: 'set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart',
      });
    }
    return void handleSetups(req, res, db, cfg);
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`termi api → http://${HOST}:${PORT}  (localhost only)`);
});

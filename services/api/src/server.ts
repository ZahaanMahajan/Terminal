/**
 * src/server.ts — Phase 6, step 1: the API skeleton.
 *
 * For now: open the DB, run migrations on startup, and expose GET /health. Auth (OAuth+PKCE,
 * sessions) and the /setups CRUD land in the next steps — this step is the foundation (database +
 * an app-owned migration runner) the rest hangs off.
 *
 * Binds to 127.0.0.1 only. Unlike the PTY service this isn't RCE-by-design, but it will soon hold
 * sessions and personal data, and there's no reason to listen on a public interface in local dev.
 * Exposing it later is a deliberate deployment decision, not a default.
 */

import { createServer, type ServerResponse } from 'node:http';
import { openDb, migrate, type DB } from './db.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.TERMI_API_PORT ?? 7683); // 7682 is the PTY service

const db: DB = openDb();
const appliedNow = migrate(db);
console.log(
  appliedNow.length
    ? `migrations: applied ${appliedNow.join(', ')}`
    : 'migrations: up to date',
);

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const { n } = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number };
    return json(res, 200, { ok: true, migrations: n });
  }
  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`termi api → http://${HOST}:${PORT}  (localhost only)`);
});

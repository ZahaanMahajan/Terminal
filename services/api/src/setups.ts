/**
 * src/setups.ts — the /setups CRUD, guarded by the session.
 *
 *   GET    /setups            list the caller's setups (summaries, no ast)
 *   POST   /setups            create  { name, ast }                 → 201 setup
 *   GET    /setups/:id        one setup with its ast                → 200 | 404
 *   PATCH  /setups/:id        partial update { name?, ast? }        → 200 | 404
 *   DELETE /setups/:id        delete                                → 204 | 404
 *   POST   /setups/:id/publish  snapshot the ast into a version     → 201 { version } | 404
 *
 * Every query is scoped to the authenticated user (store.ts), so someone else's id is a 404, never
 * a 403 — we don't reveal which ids exist. Body shape is validated here (`validateSetupInput`,
 * pure + tested); the *semantic* validity of an AST is the compiler's job (client-side, Phase 4),
 * and the `CHECK json_valid` column is the storage-level backstop.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './respond.ts';
import { corsHeaders, currentUser } from './auth.ts';
import {
  listSetups,
  getSetup,
  createSetup,
  updateSetup,
  deleteSetup,
  publishSetup,
} from './store.ts';
import type { AuthConfig } from './config.ts';
import type { DB } from './db.ts';

const MAX_NAME = 200;
const MAX_BODY_BYTES = 1_000_000; // 1 MB — an AST is small; reject anything that isn't

export type SetupInput = { name: string; ast: unknown };
type ValidationResult =
  | { ok: true; value: Partial<SetupInput> }
  | { ok: false; error: string };

/**
 * Validate a request body into setup fields. `partial` (PATCH) makes both fields optional but
 * still type-checks any that are present; otherwise (POST) both are required. Pure — unit-tested.
 */
export function validateSetupInput(body: unknown, partial: boolean): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const value: Partial<SetupInput> = {};

  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || b.name.trim() === '') {
      return { ok: false, error: 'name must be a non-empty string' };
    }
    if (b.name.length > MAX_NAME) return { ok: false, error: `name must be ≤ ${MAX_NAME} chars` };
    value.name = b.name;
  } else if (!partial) {
    return { ok: false, error: 'name is required' };
  }

  if (b.ast !== undefined) {
    if (typeof b.ast !== 'object' || b.ast === null) {
      return { ok: false, error: 'ast must be a JSON object' };
    }
    value.ast = b.ast;
  } else if (!partial) {
    return { ok: false, error: 'ast is required' };
  }

  if (partial && value.name === undefined && value.ast === undefined) {
    return { ok: false, error: 'nothing to update (provide name and/or ast)' };
  }
  return { ok: true, value };
}

/** Read the request body as a string, rejecting anything over the size limit. */
function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else {
        data += chunk;
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Match `/setups`, `/setups/:id`, `/setups/:id/publish`. */
const ROUTE = /^\/setups(?:\/([^/]+)(?:\/(publish))?)?$/;

/** Dispatch any /setups* request. Assumes the server has confirmed `cfg` is present. */
export async function handleSetups(
  req: IncomingMessage,
  res: ServerResponse,
  db: DB,
  cfg: AuthConfig,
): Promise<void> {
  const cors = corsHeaders(req, cfg);
  const user = currentUser(req, db, cfg);
  if (!user) return json(res, 401, { error: 'unauthenticated' }, cors);

  const pathname = new URL(req.url ?? '/', cfg.apiBase).pathname;
  const m = pathname.match(ROUTE);
  if (!m) return json(res, 404, { error: 'not found' }, cors);
  const id = m[1];
  const isPublish = m[2] === 'publish';
  const method = req.method ?? 'GET';

  // Collection: /setups
  if (!id) {
    if (method === 'GET') return json(res, 200, { setups: listSetups(db, user.id) }, cors);
    if (method === 'POST') {
      const body = await parseBody(req, res, cors);
      if (body === undefined) return; // already responded with 400
      const v = validateSetupInput(body, false);
      if (!v.ok) return json(res, 400, { error: v.error }, cors);
      const setup = createSetup(db, user.id, v.value.name!, v.value.ast);
      return json(res, 201, setup, cors);
    }
    return json(res, 405, { error: 'method not allowed' }, cors);
  }

  // Action: /setups/:id/publish
  if (isPublish) {
    if (method !== 'POST') return json(res, 405, { error: 'method not allowed' }, cors);
    const version = publishSetup(db, user.id, id);
    return version ? json(res, 201, version, cors) : json(res, 404, { error: 'not found' }, cors);
  }

  // Item: /setups/:id
  if (method === 'GET') {
    const setup = getSetup(db, user.id, id);
    return setup ? json(res, 200, setup, cors) : json(res, 404, { error: 'not found' }, cors);
  }
  if (method === 'PATCH') {
    const body = await parseBody(req, res, cors);
    if (body === undefined) return;
    const v = validateSetupInput(body, true);
    if (!v.ok) return json(res, 400, { error: v.error }, cors);
    const setup = updateSetup(db, user.id, id, v.value);
    return setup ? json(res, 200, setup, cors) : json(res, 404, { error: 'not found' }, cors);
  }
  if (method === 'DELETE') {
    return deleteSetup(db, user.id, id)
      ? json(res, 204, null, cors)
      : json(res, 404, { error: 'not found' }, cors);
  }
  return json(res, 405, { error: 'method not allowed' }, cors);
}

/** Read + JSON-parse a body; responds 400 itself and returns undefined on failure. */
async function parseBody(
  req: IncomingMessage,
  res: ServerResponse,
  cors: Record<string, string>,
): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: 'request body too large' }, cors);
    return undefined;
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    json(res, 400, { error: 'invalid JSON body' }, cors);
    return undefined;
  }
}

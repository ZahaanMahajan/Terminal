/**
 * src/auth.ts — the OAuth + session route handlers, tying the primitives together.
 *
 * The flow (Authorization Code + PKCE, BFF-style — the browser never sees a token):
 *
 *   GET /auth/github/login
 *     → mint `state` + PKCE verifier, stash both in a short-lived signed httpOnly cookie scoped to
 *       /auth/github, 302 to GitHub's authorize URL (carrying state + the S256 challenge).
 *   GET /auth/github/callback?code&state
 *     → verify the txn cookie's state == query state (CSRF), exchange code+verifier for a token,
 *       fetch the GitHub identity, upsert the user, create a session, set the signed session
 *       cookie, 302 back to the web app.
 *   GET  /me            → the session's user, or 401.
 *   POST /auth/logout   → delete the session + clear the cookie.
 *
 * Why GET (not the doc's `POST /auth/github`) for login: starting the flow is a top-level browser
 * navigation to a cross-origin page; a fetched POST can't carry the user to github.com. The CSRF
 * defense is `state` + the SameSite=Lax txn cookie, exactly as the RFC intends.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCookies, serializeCookie, clearCookie } from './cookies.ts';
import {
  randomToken,
  signValue,
  unsignValue,
  generateCodeVerifier,
  codeChallengeS256,
} from './crypto.ts';
import { buildAuthorizeUrl, exchangeCode, fetchGithubUser } from './github.ts';
import {
  upsertUserByGithub,
  createSession,
  getSessionUser,
  deleteSession,
  SESSION_TTL_SEC,
  type User,
} from './store.ts';
import type { AuthConfig } from './config.ts';
import type { DB } from './db.ts';
import { json } from './respond.ts';

const OAUTH_COOKIE = 'termi_oauth';
const SESSION_COOKIE = 'termi_session';
const OAUTH_PATH = '/auth/github';

/** CORS headers for credentialed XHR from the web app (echo the exact origin, allow credentials). */
export function corsHeaders(req: IncomingMessage, cfg: AuthConfig): Record<string, string> {
  const origin = req.headers.origin;
  if (origin && origin === cfg.webOrigin) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      vary: 'Origin',
    };
  }
  return {};
}

/** Resolve the request's session cookie to a user, or null. Reused by `/me` and (later) `/setups`. */
export function currentUser(req: IncomingMessage, db: DB, cfg: AuthConfig): User | null {
  const signed = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!signed) return null;
  const sid = unsignValue(signed, cfg.cookieSecret);
  if (!sid) return null;
  return getSessionUser(db, sid);
}

export function handleLogin(_req: IncomingMessage, res: ServerResponse, cfg: AuthConfig): void {
  const state = randomToken(16);
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);

  // Stash {state:verifier} in a signed, httpOnly, path-scoped, short-lived cookie. base64url
  // values contain no ':' so the split in the callback is unambiguous.
  const txn = signValue(`${state}:${verifier}`, cfg.cookieSecret);
  const cookie = serializeCookie(OAUTH_COOKIE, txn, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: cfg.secureCookies,
    maxAgeSec: 600,
    path: OAUTH_PATH,
  });

  res.writeHead(302, { 'set-cookie': cookie, location: buildAuthorizeUrl(cfg, state, challenge) });
  res.end();
}

export async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  db: DB,
  cfg: AuthConfig,
): Promise<void> {
  const url = new URL(req.url ?? '/', cfg.apiBase);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const txnRaw = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
  const txn = txnRaw ? unsignValue(txnRaw, cfg.cookieSecret) : null;
  const clearTxn = clearCookie(OAUTH_COOKIE, {
    path: OAUTH_PATH,
    httpOnly: true,
    sameSite: 'Lax',
    secure: cfg.secureCookies,
  });

  const fail = (reason: string): void => {
    res.writeHead(302, { 'set-cookie': clearTxn, location: `${cfg.webOrigin}/?auth_error=${reason}` });
    res.end();
  };

  if (!code || !state || !txn) return fail('bad_request');
  const sep = txn.indexOf(':');
  const savedState = txn.slice(0, sep);
  const verifier = txn.slice(sep + 1);
  if (savedState !== state) return fail('state_mismatch'); // CSRF / mismatched transaction

  try {
    const token = await exchangeCode(cfg, code, verifier);
    const gh = await fetchGithubUser(token);
    const user = upsertUserByGithub(db, gh);
    const sid = createSession(db, user.id, req.headers['user-agent']);
    const session = serializeCookie(SESSION_COOKIE, signValue(sid, cfg.cookieSecret), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: cfg.secureCookies,
      maxAgeSec: SESSION_TTL_SEC,
      path: '/',
    });
    res.writeHead(302, { 'set-cookie': [clearTxn, session], location: cfg.webOrigin });
    res.end();
  } catch {
    fail('oauth_failed');
  }
}

export function handleMe(req: IncomingMessage, res: ServerResponse, db: DB, cfg: AuthConfig): void {
  const cors = corsHeaders(req, cfg);
  const user = currentUser(req, db, cfg);
  if (!user) return json(res, 401, { error: 'unauthenticated' }, cors);
  json(
    res,
    200,
    {
      id: user.id,
      github_id: user.github_id,
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    },
    cors,
  );
}

export function handleLogout(
  req: IncomingMessage,
  res: ServerResponse,
  db: DB,
  cfg: AuthConfig,
): void {
  const signed = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (signed) {
    const sid = unsignValue(signed, cfg.cookieSecret);
    if (sid) deleteSession(db, sid);
  }
  const cleared = clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: cfg.secureCookies,
  });
  json(res, 200, { ok: true }, { ...corsHeaders(req, cfg), 'set-cookie': cleared });
}

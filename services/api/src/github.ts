/**
 * src/github.ts — the GitHub OAuth endpoints, by hand against the RFCs.
 *
 *   buildAuthorizeUrl  — where we send the browser (step 1 of the Authorization Code flow). Pure,
 *                        so it's unit-tested.
 *   exchangeCode       — POST code + PKCE verifier → access token (the confidential exchange that
 *                        happens server-side; never in the browser). Network.
 *   fetchGithubUser    — GET /user with the token → identity. Network.
 *
 * Scope is minimized to `read:user` — we only need identity, not repo access (that's the optional
 * git-sync feature later). The network calls are verified by running the real flow, not unit tests.
 */

import type { AuthConfig } from './config.ts';
import type { GithubIdentity } from './store.ts';

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';

/** The authorize URL: client_id, redirect_uri, scope, CSRF `state`, and the PKCE S256 challenge. */
export function buildAuthorizeUrl(cfg: AuthConfig, state: string, challenge: string): string {
  const u = new URL(AUTHORIZE);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.callbackUrl);
  u.searchParams.set('scope', 'read:user');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('allow_signup', 'true');
  return u.toString();
}

/** Exchange the authorization code (+ PKCE verifier) for an access token. */
export async function exchangeCode(cfg: AuthConfig, code: string, verifier: string): Promise<string> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.callbackUrl,
      code_verifier: verifier,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`token exchange failed: ${data.error ?? res.status}`);
  }
  return data.access_token;
}

/** Fetch the authenticated user's identity. */
export async function fetchGithubUser(token: string): Promise<GithubIdentity> {
  const res = await fetch(USER, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'termi-api',
    },
  });
  if (!res.ok) throw new Error(`github /user failed: ${res.status}`);
  const u = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
  };
  return { id: u.id, login: u.login, name: u.name, avatar_url: u.avatar_url };
}

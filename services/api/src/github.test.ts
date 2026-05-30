/**
 * github.test.ts — the pure half of the OAuth glue (the authorize URL). The network calls
 * (token exchange, /user) are verified by running the real flow.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl } from './github.ts';
import type { AuthConfig } from './config.ts';

const cfg: AuthConfig = {
  clientId: 'Iv1.abc123',
  clientSecret: 'shh',
  cookieSecret: 'k',
  apiBase: 'http://localhost:7683',
  webOrigin: 'http://localhost:5173',
  callbackUrl: 'http://localhost:7683/auth/github/callback',
  secureCookies: false,
};

test('buildAuthorizeUrl carries client_id, redirect_uri, scope, state and the S256 challenge', () => {
  const url = new URL(buildAuthorizeUrl(cfg, 'state-token', 'challenge-token'));
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'Iv1.abc123');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:7683/auth/github/callback');
  assert.equal(url.searchParams.get('scope'), 'read:user');
  assert.equal(url.searchParams.get('state'), 'state-token');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-token');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

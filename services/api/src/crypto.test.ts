/**
 * crypto.test.ts — random tokens, signed cookies, PKCE. Pure crypto, exact vectors.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomToken,
  signValue,
  unsignValue,
  generateCodeVerifier,
  codeChallengeS256,
} from './crypto.ts';

test('randomToken is URL-safe and high-entropy', () => {
  const t = randomToken(32);
  assert.match(t, /^[A-Za-z0-9_-]+$/); // base64url alphabet, no padding
  assert.equal(t.length, 43); // 32 bytes → 43 base64url chars
  assert.notEqual(randomToken(), randomToken()); // overwhelmingly unlikely to collide
});

test('signValue → unsignValue round-trips', () => {
  const signed = signValue('session-abc', 'secret');
  assert.ok(signed.includes('.'));
  assert.equal(unsignValue(signed, 'secret'), 'session-abc');
});

test('unsignValue rejects a tampered value', () => {
  const signed = signValue('session-abc', 'secret');
  const tampered = signed.replace('session-abc', 'session-xyz');
  assert.equal(unsignValue(tampered, 'secret'), null);
});

test('unsignValue rejects the wrong secret', () => {
  const signed = signValue('payload', 'secret-a');
  assert.equal(unsignValue(signed, 'secret-b'), null);
});

test('unsignValue rejects garbage with no signature', () => {
  assert.equal(unsignValue('no-dot-here', 'secret'), null);
  assert.equal(unsignValue('', 'secret'), null);
  assert.equal(unsignValue('.sig', 'secret'), null);
});

test('PKCE S256 matches the RFC 7636 Appendix B test vector', () => {
  // RFC 7636 §B: this exact verifier must produce this exact challenge.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(codeChallengeS256(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('generateCodeVerifier is in the RFC length range and URL-safe', () => {
  const v = generateCodeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  assert.ok(v.length >= 43 && v.length <= 128);
});

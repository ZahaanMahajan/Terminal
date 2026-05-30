/**
 * src/crypto.ts — the cryptographic primitives auth needs, written by hand.
 *
 *   randomToken      — URL-safe random ids (session ids, OAuth `state`, PKCE verifier)
 *   signValue/unsign — HMAC-SHA256 "value.signature" — the *signed* in "signed httpOnly cookie".
 *                      Tamper-evident: a client can read the cookie but can't forge a new value.
 *   PKCE (RFC 7636)  — code_verifier + S256 code_challenge.
 *
 * All pure given `node:crypto` (no DB, no network), so the whole module is unit-testable —
 * including against RFC 7636's published test vector.
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** A URL-safe random token with `bytes` of entropy (32 → 43 base64url chars). */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

function hmac(value: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(value).digest());
}

/**
 * Sign a value → `"<value>.<signature>"`. The signature is HMAC-SHA256(value, secret). Callers
 * pass values drawn from the base64url alphabet (`A–Z a–z 0–9 - _`) plus our own separators, so
 * the value never contains a '.', and `unsignValue` can split on the last one unambiguously.
 */
export function signValue(value: string, secret: string): string {
  return `${value}.${hmac(value, secret)}`;
}

/** Verify a signed value; return the value if the signature matches (constant-time), else null. */
export function unsignValue(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const provided = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(hmac(value, secret));
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? value : null;
}

// ── PKCE (RFC 7636) ──────────────────────────────────────────────────────────────

/** A code_verifier: 32 random bytes → 43 base64url chars (within the RFC's 43–128 range). */
export function generateCodeVerifier(): string {
  return randomToken(32);
}

/** The S256 code_challenge for a verifier: base64url(SHA-256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

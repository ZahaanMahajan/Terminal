/**
 * cookies.test.ts — header parsing + Set-Cookie serialization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, serializeCookie, clearCookie } from './cookies.ts';

test('parseCookies handles multiple pairs and surrounding spaces', () => {
  assert.deepEqual(parseCookies('a=1; b=2;  c=3'), { a: '1', b: '2', c: '3' });
});

test('parseCookies URL-decodes values', () => {
  assert.deepEqual(parseCookies('t=a%2Eb.sig'), { t: 'a.b.sig' });
});

test('parseCookies is empty for undefined / blank', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('parseCookies keeps the first occurrence of a repeated name', () => {
  assert.deepEqual(parseCookies('x=first; x=second'), { x: 'first' });
});

test('serializeCookie emits attributes with Path defaulting to /', () => {
  const c = serializeCookie('termi_session', 'abc.def', {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    maxAgeSec: 3600,
  });
  assert.equal(c, 'termi_session=abc.def; Max-Age=3600; Path=/; SameSite=Lax; HttpOnly; Secure');
});

test('serializeCookie URL-encodes the value and honors a custom path', () => {
  const c = serializeCookie('termi_oauth', 'a b', { path: '/auth/github' });
  assert.equal(c, 'termi_oauth=a%20b; Path=/auth/github');
});

test('clearCookie zeroes the value and Max-Age', () => {
  assert.equal(clearCookie('termi_session'), 'termi_session=; Max-Age=0; Path=/');
});

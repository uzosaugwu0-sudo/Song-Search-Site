import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signSessionToken,
  verifySessionToken,
  buildSessionCookie,
  buildLogoutCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  getClientIp,
} from './admin-auth.js';

const SECRET = 'test-secret-value';

test('signSessionToken produces a token that verifySessionToken accepts', async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60000);
  assert.equal(await verifySessionToken(SECRET, token), true);
});

test('verifySessionToken rejects a tampered signature', async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60000);
  const [payload] = token.split('.');
  assert.equal(await verifySessionToken(SECRET, `${payload}.not-a-real-signature`), false);
});

test('verifySessionToken rejects a tampered payload', async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60000);
  const [, signature] = token.split('.');
  assert.equal(await verifySessionToken(SECRET, `dGFtcGVyZWQ.${signature}`), false);
});

test('verifySessionToken rejects an expired token', async () => {
  const token = await signSessionToken(SECRET, Date.now() - 1000);
  assert.equal(await verifySessionToken(SECRET, token), false);
});

test('verifySessionToken rejects garbage input', async () => {
  assert.equal(await verifySessionToken(SECRET, 'not-a-token'), false);
  assert.equal(await verifySessionToken(SECRET, ''), false);
});

test('buildSessionCookie and readSessionCookie round-trip the token', () => {
  const cookieHeader = buildSessionCookie('abc.def');
  const nameValue = cookieHeader.split(';')[0];
  assert.equal(nameValue, `${SESSION_COOKIE_NAME}=abc.def`);
  assert.equal(readSessionCookie(nameValue), 'abc.def');
});

test('readSessionCookie finds the session cookie among other cookies', () => {
  assert.equal(readSessionCookie(`foo=bar; ${SESSION_COOKIE_NAME}=xyz; baz=qux`), 'xyz');
});

test('readSessionCookie returns null when the cookie is missing', () => {
  assert.equal(readSessionCookie('foo=bar'), null);
  assert.equal(readSessionCookie(undefined), null);
});

test('buildLogoutCookie sets Max-Age=0', () => {
  assert.match(buildLogoutCookie(), /Max-Age=0/);
});

test('getClientIp reads CF-Connecting-IP and falls back to "unknown"', () => {
  const withIp = new Request('https://example.com', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
  assert.equal(getClientIp(withIp), '1.2.3.4');
  const withoutIp = new Request('https://example.com');
  assert.equal(getClientIp(withoutIp), 'unknown');
});

function fakeKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

test('checkLoginRateLimit allows attempts under the limit and blocks at 10', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) {
    assert.equal(await checkLoginRateLimit(kv, '1.2.3.4'), true);
    await recordFailedLogin(kv, '1.2.3.4');
  }
  assert.equal(await checkLoginRateLimit(kv, '1.2.3.4'), false);
});

test('clearLoginRateLimit resets the counter', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) await recordFailedLogin(kv, '5.6.7.8');
  assert.equal(await checkLoginRateLimit(kv, '5.6.7.8'), false);
  await clearLoginRateLimit(kv, '5.6.7.8');
  assert.equal(await checkLoginRateLimit(kv, '5.6.7.8'), true);
});

test('rate limit is tracked per IP independently', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) await recordFailedLogin(kv, '1.1.1.1');
  assert.equal(await checkLoginRateLimit(kv, '1.1.1.1'), false);
  assert.equal(await checkLoginRateLimit(kv, '2.2.2.2'), true);
});

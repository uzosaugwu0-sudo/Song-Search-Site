const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToBytes(str) {
  const pad = (4 - (str.length % 4)) % 4;
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export const SESSION_COOKIE_NAME = 'admin_session';
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export async function signSessionToken(secret, expiresAt = Date.now() + SESSION_DURATION_MS) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ exp: expiresAt })));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const key = await hmacKey(secret);
  let valid;
  try {
    valid = await crypto.subtle.verify('HMAC', key, base64UrlDecodeToBytes(signature), encoder.encode(payload));
  } catch {
    return false;
  }
  if (!valid) return false;

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(payload)));
  } catch {
    return false;
  }
  return typeof parsed.exp === 'number' && parsed.exp > Date.now();
}

export function buildSessionCookie(token) {
  const maxAgeSeconds = Math.floor(SESSION_DURATION_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function buildLogoutCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

export async function requireAdminSession(request, env) {
  const token = readSessionCookie(request.headers.get('Cookie'));
  if (!token) return false;
  return verifySessionToken(env.ADMIN_SESSION_SECRET, token);
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

function rateLimitKey(ip) {
  return `login-attempts:${ip}`;
}

export async function checkLoginRateLimit(kv, ip) {
  const raw = await kv.get(rateLimitKey(ip));
  const count = raw ? parseInt(raw, 10) : 0;
  return count < RATE_LIMIT_MAX_ATTEMPTS;
}

export async function recordFailedLogin(kv, ip) {
  const raw = await kv.get(rateLimitKey(ip));
  const count = raw ? parseInt(raw, 10) : 0;
  await kv.put(rateLimitKey(ip), String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
}

export async function clearLoginRateLimit(kv, ip) {
  await kv.delete(rateLimitKey(ip));
}

// src/pages/api/admin/login.js
import {
  signSessionToken,
  buildSessionCookie,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  getClientIp,
} from '../../../lib/admin-auth.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return jsonResponse({ error: 'Admin login is not configured' }, 503);
  }
  const ip = getClientIp(request);

  const allowed = await checkLoginRateLimit(env.ADMIN_RATE_LIMIT, ip);
  if (!allowed) {
    return jsonResponse({ error: 'Too many attempts, try again later' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (body.password !== env.ADMIN_PASSWORD) {
    await recordFailedLogin(env.ADMIN_RATE_LIMIT, ip);
    return jsonResponse({ error: 'Incorrect password' }, 401);
  }

  await clearLoginRateLimit(env.ADMIN_RATE_LIMIT, ip);
  const token = await signSessionToken(env.ADMIN_SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': buildSessionCookie(token),
    },
  });
}

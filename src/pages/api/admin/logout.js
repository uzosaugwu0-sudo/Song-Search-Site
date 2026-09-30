// src/pages/api/admin/logout.js
import { buildLogoutCookie } from '../../../lib/admin-auth.js';

export const prerender = false;

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': buildLogoutCookie(),
    },
  });
}

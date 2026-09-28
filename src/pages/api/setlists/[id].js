import { prepareSongIdsForUpdate, prepareSetlistName, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

export async function GET({ params, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const raw = await kv.get(params.id);
  if (raw === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function PUT({ params, request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const existing = await kv.get(params.id);
  if (existing === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const songResult = prepareSongIdsForUpdate(body.songIds, validSongIds);
  if (songResult.error) {
    return jsonResponse({ error: songResult.error }, 400);
  }

  let name;
  if (body.name !== undefined) {
    const nameResult = prepareSetlistName(body.name);
    if (nameResult.error) {
      return jsonResponse({ error: nameResult.error }, 400);
    }
    name = nameResult.name;
  } else {
    name = JSON.parse(existing).name;
  }

  const value = buildSetlistValue(songResult.songIds, name);
  await kv.put(params.id, value);
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

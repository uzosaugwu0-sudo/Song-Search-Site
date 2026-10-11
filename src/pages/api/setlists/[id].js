import { prepareSongIdsForUpdate, prepareSetlistName, putSetlist, parseLiveSetlist, markDeleted, SOFT_DELETE_TTL_SECONDS, jsonResponse } from '../../../lib/setlist.js';
import { loadSongs } from '../../../lib/songs-data.js';

export const prerender = false;

export async function GET({ params, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const raw = await kv.get(params.id);
  if (parseLiveSetlist(raw) === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function PUT({ params, request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const existingData = parseLiveSetlist(await kv.get(params.id));
  if (existingData === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validSongIds = new Set((await loadSongs(locals.runtime.env.SONGS_DATA)).map((s) => s.id));
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
    name = existingData.name;
  }

  const value = await putSetlist(kv, params.id, songResult.songIds, name, {
    createdAt: existingData.createdAt ?? existingData.updatedAt,
  });
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Soft delete: flag the list and let KV expire it after the recovery window.
export async function DELETE({ params, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const raw = await kv.get(params.id);
  if (parseLiveSetlist(raw) === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  await kv.put(params.id, markDeleted(raw), {
    metadata: { deleted: true },
    expirationTtl: SOFT_DELETE_TTL_SECONDS,
  });
  return jsonResponse({ ok: true });
}

import { prepareSongIdsForCreate, generateSetlistId, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

export async function POST({ request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const result = prepareSongIdsForCreate(body.songIds, validSongIds);
  if (result.error) {
    return jsonResponse({ error: result.error }, 400);
  }

  const id = generateSetlistId();
  await kv.put(id, buildSetlistValue(result.songIds));
  return jsonResponse({ id });
}

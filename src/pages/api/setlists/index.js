import { prepareSongIdsForCreate, prepareSetlistName, generateSetlistId, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import { loadSongs } from '../../../lib/songs-data.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validSongIds = new Set((await loadSongs(locals.runtime.env.SONGS_DATA)).map((s) => s.id));
  const songResult = prepareSongIdsForCreate(body.songIds, validSongIds);
  if (songResult.error) {
    return jsonResponse({ error: songResult.error }, 400);
  }

  const nameResult = prepareSetlistName(body.name);
  if (nameResult.error) {
    return jsonResponse({ error: nameResult.error }, 400);
  }

  const id = generateSetlistId();
  await kv.put(id, buildSetlistValue(songResult.songIds, nameResult.name));
  return jsonResponse({ id });
}

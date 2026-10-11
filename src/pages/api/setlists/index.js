import { prepareSongIdsForCreate, prepareSetlistName, generateSetlistId, putSetlist, toListEntries, parseLiveSetlist, jsonResponse } from '../../../lib/setlist.js';
import { loadSongs } from '../../../lib/songs-data.js';

export const prerender = false;

// Public listing of every service list.
// ponytail: one kv.list page (1000 lists); add cursor paging if it ever fills.
export async function GET({ locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const { keys } = await kv.list({ limit: 1000 });
  // Lists saved before metadata existed: read once, rewrite with metadata.
  const legacy = keys.filter((k) => !k.metadata);
  for (const key of legacy) {
    const data = parseLiveSetlist(await kv.get(key.name));
    if (data) {
      await putSetlist(kv, key.name, data.songIds, data.name);
      key.metadata = { name: data.name, count: data.songIds.length, updatedAt: data.updatedAt };
    }
  }
  return jsonResponse(toListEntries(keys));
}

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
  await putSetlist(kv, id, songResult.songIds, nameResult.name);
  return jsonResponse({ id });
}

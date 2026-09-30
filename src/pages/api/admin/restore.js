// src/pages/api/admin/restore.js
import { requireAdminSession } from '../../../lib/admin-auth.js';
import { commitDatabasePair } from '../../../lib/admin-db.js';
import { backupPrefix } from '../../../lib/r2-backup.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.timestamp !== 'string' || body.timestamp.length === 0) {
    return jsonResponse({ error: 'A backup timestamp is required' }, 400);
  }

  const prefix = backupPrefix(body.timestamp);
  const songsObj = await env.SONG_DB_FILES.get(`${prefix}Songs.db`);
  const wordsObj = await env.SONG_DB_FILES.get(`${prefix}SongWords.db`);
  if (!songsObj || !wordsObj) {
    return jsonResponse({ error: 'Backup not found' }, 404);
  }

  const result = await commitDatabasePair({
    r2: env.SONG_DB_FILES,
    kv: env.SONGS_DATA,
    songsDbBytes: new Uint8Array(await songsObj.arrayBuffer()),
    wordsDbBytes: new Uint8Array(await wordsObj.arrayBuffer()),
  });

  if (result.error) {
    return jsonResponse({ error: result.error, details: result.details ?? [] }, 400);
  }
  return jsonResponse({ songCount: result.songCount, duplicateGroups: result.duplicateGroups });
}

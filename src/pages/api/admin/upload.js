// src/pages/api/admin/upload.js
import { requireAdminSession } from '../../../lib/admin-auth.js';
import { commitDatabasePair } from '../../../lib/admin-db.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid form data' }, 400);
  }

  const songsFile = form.get('songsDb');
  const wordsFile = form.get('wordsDb');
  if (!(songsFile instanceof File) || !(wordsFile instanceof File)) {
    return jsonResponse({ error: 'Both songsDb and wordsDb files are required' }, 400);
  }

  const songsDbBytes = new Uint8Array(await songsFile.arrayBuffer());
  const wordsDbBytes = new Uint8Array(await wordsFile.arrayBuffer());

  const result = await commitDatabasePair({
    r2: env.SONG_DB_FILES,
    kv: env.SONGS_DATA,
    songsDbBytes,
    wordsDbBytes,
  });

  if (result.error) {
    return jsonResponse({ error: result.error, details: result.details ?? [] }, 400);
  }
  return jsonResponse({ songCount: result.songCount, duplicateGroups: result.duplicateGroups });
}

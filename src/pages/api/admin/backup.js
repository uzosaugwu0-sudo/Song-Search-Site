// src/pages/api/admin/backup.js
import { requireAdminSession } from '../../../lib/admin-auth.js';
import { backupCurrentPair } from '../../../lib/r2-backup.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const timestamp = await backupCurrentPair(env.SONG_DB_FILES);
  if (!timestamp) {
    return jsonResponse({ error: 'There is no database to back up yet. Upload one first.' }, 404);
  }
  return jsonResponse({ timestamp });
}

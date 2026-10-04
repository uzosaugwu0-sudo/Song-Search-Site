// src/lib/admin-db.js
import { getSqlJs } from './sqlite-worker-init.js';
import { isSqliteFile, parseSongDatabases } from './sqlite-parse.js';
import { backupCurrentPair } from './r2-backup.js';
import { findDuplicateGroups } from './duplicate-groups.js';

export async function commitDatabasePair({ r2, kv, songsDbBytes, wordsDbBytes }) {
  if (!isSqliteFile(songsDbBytes)) {
    return { error: 'Songs.db is not a valid SQLite database file', details: [] };
  }
  if (!isSqliteFile(wordsDbBytes)) {
    return { error: 'SongWords.db is not a valid SQLite database file', details: [] };
  }

  const SQL = await getSqlJs();
  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  if (result.error) {
    return result;
  }

  await backupCurrentPair(r2);

  await r2.put('current/Songs.db', songsDbBytes);
  await r2.put('current/SongWords.db', wordsDbBytes);
  const meta = { uploadedAt: new Date().toISOString(), songCount: result.songs.length };
  await r2.put('current/meta.json', JSON.stringify(meta));
  await kv.put('songs', JSON.stringify(result.songs));

  const duplicateGroups = findDuplicateGroups(result.songs).length;
  return { songCount: result.songs.length, duplicateGroups };
}

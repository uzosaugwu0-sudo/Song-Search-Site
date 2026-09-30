// src/lib/admin-db.js
import { getSqlJs } from './sqlite-worker-init.js';
import { isSqliteFile, parseSongDatabases } from './sqlite-parse.js';
import { formatBackupTimestamp, backupPrefix } from './r2-backup.js';
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

  const currentSongs = await r2.get('current/Songs.db');
  if (currentSongs) {
    const timestamp = formatBackupTimestamp();
    const prefix = backupPrefix(timestamp);
    const currentWords = await r2.get('current/SongWords.db');
    await r2.put(`${prefix}Songs.db`, await currentSongs.arrayBuffer());
    if (currentWords) {
      await r2.put(`${prefix}SongWords.db`, await currentWords.arrayBuffer());
    }
  }

  await r2.put('current/Songs.db', songsDbBytes);
  await r2.put('current/SongWords.db', wordsDbBytes);
  const meta = { uploadedAt: new Date().toISOString(), songCount: result.songs.length };
  await r2.put('current/meta.json', JSON.stringify(meta));
  await kv.put('songs', JSON.stringify(result.songs));

  const duplicateGroups = findDuplicateGroups(result.songs).length;
  return { songCount: result.songs.length, duplicateGroups };
}

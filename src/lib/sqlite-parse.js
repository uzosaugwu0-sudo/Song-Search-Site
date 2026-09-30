import { rtfToPlainText } from '../../scripts/rtf-to-text.js';
import { assignSlugs } from '../../scripts/slugify.js';

const SQLITE_MAGIC = 'SQLite format 3\0';

export function isSqliteFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return false;
  const header = new TextDecoder('utf-8').decode(bytes.slice(0, 16));
  return header === SQLITE_MAGIC;
}

export function parseSongDatabases(SQL, songsDbBytes, wordsDbBytes) {
  const songsDb = new SQL.Database(songsDbBytes);
  const wordsDb = new SQL.Database(wordsDbBytes);

  let songResult, wordResult;
  try {
    songResult = songsDb.exec('SELECT rowid AS rowid, song_uid, title, author FROM song')[0];
    wordResult = wordsDb.exec('SELECT song_id, words FROM word')[0];
  } catch {
    return {
      error: 'Songs.db / SongWords.db is not a ProPresenter song database (expected a "song" and "word" table) — check you selected the right file in each field.',
      details: [],
    };
  } finally {
    songsDb.close();
    wordsDb.close();
  }

  const songColumns = songResult ? songResult.columns : [];
  const songValues = songResult ? songResult.values : [];
  const wordColumns = wordResult ? wordResult.columns : [];
  const wordValues = wordResult ? wordResult.values : [];

  const col = (columns, name) => columns.indexOf(name);
  const wSongIdIdx = col(wordColumns, 'song_id');
  const wWordsIdx = col(wordColumns, 'words');
  const wordsByRowId = new Map();
  for (const row of wordValues) {
    wordsByRowId.set(row[wSongIdIdx], row[wWordsIdx]);
  }

  const rowidIdx = col(songColumns, 'rowid');
  const uidIdx = col(songColumns, 'song_uid');
  const titleIdx = col(songColumns, 'title');
  const authorIdx = col(songColumns, 'author');

  const invalidRows = [];
  const failures = [];
  const songs = [];

  for (const row of songValues) {
    const rowid = row[rowidIdx];
    const songUid = row[uidIdx];
    const title = row[titleIdx];
    const author = row[authorIdx];

    const titleValid = typeof title === 'string' && title.trim().length > 0;
    const uidValid = typeof songUid === 'string' && songUid.length > 0;
    if (!titleValid || !uidValid) {
      const label = titleValid ? `"${title}"` : `row ${rowid}`;
      const problems = [];
      if (!titleValid) problems.push('missing/invalid title');
      if (!uidValid) problems.push('missing/invalid song_uid');
      invalidRows.push(`${label} (row ${rowid}): ${problems.join(', ')}`);
      continue;
    }

    const raw = wordsByRowId.get(rowid);
    const rtf = typeof raw === 'string' ? raw : raw ? new TextDecoder('utf-8').decode(raw) : '';
    const lyrics = rtf ? rtfToPlainText(rtf) : '';
    if (!lyrics.trim()) {
      failures.push(`${title} (song_uid ${songUid})`);
      continue;
    }

    songs.push({ id: songUid, title, author: author ?? '', lyrics });
  }

  if (invalidRows.length > 0) {
    return {
      error: `Import failed: ${invalidRows.length} row(s) have a missing or invalid title/song_uid`,
      details: invalidRows,
    };
  }
  if (failures.length > 0) {
    return {
      error: `Import failed: ${failures.length} song(s) produced empty lyrics`,
      details: failures,
    };
  }

  return { songs: assignSlugs(songs) };
}

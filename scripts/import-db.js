// scripts/import-db.js
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rtfToPlainText } from './rtf-to-text.js';
import { assignSlugs } from './slugify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DEFAULT_SONGS_DB_PATH = join(ROOT, 'data', 'Songs.db');
const DEFAULT_WORDS_DB_PATH = join(ROOT, 'data', 'SongWords.db');
const DEFAULT_OUT_PATH = join(ROOT, 'src', 'data', 'songs.json');

function openDb(path, label) {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (err) {
    throw new Error(`Could not open ${label} at ${path}: ${err.message}`);
  }
}

export function runImport({
  songsDbPath = DEFAULT_SONGS_DB_PATH,
  wordsDbPath = DEFAULT_WORDS_DB_PATH,
  outPath = DEFAULT_OUT_PATH,
} = {}) {
  const songsDb = openDb(songsDbPath, 'Songs.db');
  const wordsDb = openDb(wordsDbPath, 'SongWords.db');

  const songRows = songsDb.prepare('SELECT rowid AS rowid, song_uid, title, author FROM song').all();
  const wordRows = wordsDb.prepare('SELECT song_id, words FROM word').all();
  songsDb.close();
  wordsDb.close();

  const wordsByRowId = new Map(wordRows.map((w) => [w.song_id, w.words]));

  const failures = [];
  const songs = songRows.map((row) => {
    const rtf = wordsByRowId.get(row.rowid);
    const lyrics = rtf ? rtfToPlainText(rtf) : '';
    if (!lyrics.trim()) {
      failures.push(`${row.title} (song_uid ${row.song_uid})`);
    }
    return {
      id: row.song_uid,
      title: row.title,
      author: row.author ?? '',
      lyrics,
    };
  });

  if (failures.length > 0) {
    throw new Error(
      `Import failed: ${failures.length} song(s) produced empty lyrics:\n` +
        failures.map((f) => `  - ${f}`).join('\n')
    );
  }

  const withSlugs = assignSlugs(songs);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(withSlugs, null, 2));
  console.log(`Imported ${withSlugs.length} songs -> ${outPath}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    runImport();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

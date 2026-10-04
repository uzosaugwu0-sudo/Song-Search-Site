// scripts/import-db.js
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSongDatabases } from '../src/lib/sqlite-parse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_SONGS_DB_PATH = join(ROOT, 'data', 'Songs.db');
const DEFAULT_WORDS_DB_PATH = join(ROOT, 'data', 'SongWords.db');
const DEFAULT_OUT_PATH = join(ROOT, 'src', 'data', 'songs.json');

function readDb(path, label) {
  try {
    return new Uint8Array(readFileSync(path));
  } catch (err) {
    throw new Error(`Could not open ${label} at ${path}: ${err.message}`);
  }
}

export async function runImport({
  songsDbPath = DEFAULT_SONGS_DB_PATH,
  wordsDbPath = DEFAULT_WORDS_DB_PATH,
  outPath = DEFAULT_OUT_PATH,
} = {}) {
  const songsBytes = readDb(songsDbPath, 'Songs.db');
  const wordsBytes = readDb(wordsDbPath, 'SongWords.db');

  const result = parseSongDatabases(await initSqlJs(), songsBytes, wordsBytes);
  if (result.error) {
    throw new Error([result.error, ...result.details.map((d) => `  - ${d}`)].join('\n'));
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result.songs, null, 2));
  console.log(`Imported ${result.songs.length} songs -> ${outPath}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await runImport();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// scripts/import-db.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImport } from './import-db.js';

function buildFixtureDbs(dir) {
  const songsPath = join(dir, 'Songs.db');
  const wordsPath = join(dir, 'SongWords.db');

  const songsDb = new DatabaseSync(songsPath);
  songsDb.exec('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
  songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-1', 'Amazing Grace', 'John Newton');
  songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-2', 'Silent Night', 'Joseph Mohr');
  songsDb.close();

  const wordsDb = new DatabaseSync(wordsPath);
  wordsDb.exec('CREATE TABLE word (song_id INTEGER, words TEXT)');
  wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(1, String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound}`);
  wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(2, String.raw`{\rtf1\ansi Silent night\par holy night}`);
  wordsDb.close();

  return { songsPath, wordsPath };
}

test('runImport joins the two DBs and writes slugged songs to outPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'song-import-test-'));
  const { songsPath, wordsPath } = buildFixtureDbs(dir);
  const outPath = join(dir, 'songs.json');

  runImport({ songsDbPath: songsPath, wordsDbPath: wordsPath, outPath });

  const songs = JSON.parse(readFileSync(outPath, 'utf8'));
  rmSync(dir, { recursive: true, force: true });

  assert.equal(songs.length, 2);
  const grace = songs.find((s) => s.id === 'uid-1');
  assert.equal(grace.title, 'Amazing Grace');
  assert.equal(grace.author, 'John Newton');
  assert.equal(grace.lyrics, 'Amazing grace\nhow sweet the sound');
  assert.equal(grace.slug, 'amazing-grace');
});

test('runImport exits with a clear error when a song has empty lyrics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'song-import-test-'));
  const songsPath = join(dir, 'Songs.db');
  const wordsPath = join(dir, 'SongWords.db');

  const songsDb = new DatabaseSync(songsPath);
  songsDb.exec('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
  songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-1', 'Blank Song', 'Nobody');
  songsDb.close();

  const wordsDb = new DatabaseSync(wordsPath);
  wordsDb.exec('CREATE TABLE word (song_id INTEGER, words TEXT)');
  wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(1, String.raw`{\rtf1\ansi }`);
  wordsDb.close();

  const outPath = join(dir, 'songs.json');

  assert.throws(() => {
    runImport({ songsDbPath: songsPath, wordsDbPath: wordsPath, outPath });
  }, /Blank Song/);

  rmSync(dir, { recursive: true, force: true });
});

test('runImport throws a clear error when a DB file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'song-import-test-'));
  assert.throws(() => {
    runImport({
      songsDbPath: join(dir, 'missing-Songs.db'),
      wordsDbPath: join(dir, 'missing-SongWords.db'),
      outPath: join(dir, 'songs.json'),
    });
  }, /Songs\.db/);
  rmSync(dir, { recursive: true, force: true });
});

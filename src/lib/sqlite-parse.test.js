import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { parseSongDatabases, isSqliteFile } from './sqlite-parse.js';

async function buildFixtureDbBytes(build) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  build(db);
  const bytes = db.export();
  db.close();
  return bytes;
}

test('parseSongDatabases joins songs and words, assigns slugs', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-1', 'Amazing Grace', 'John Newton']);
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-2', 'Silent Night', 'Joseph Mohr']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words TEXT)');
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound}`]);
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [2, String.raw`{\rtf1\ansi Silent night\par holy night}`]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.equal(result.error, undefined);
  assert.equal(result.songs.length, 2);
  const grace = result.songs.find((s) => s.id === 'uid-1');
  assert.equal(grace.title, 'Amazing Grace');
  assert.equal(grace.author, 'John Newton');
  assert.equal(grace.lyrics, 'Amazing grace\nhow sweet the sound');
  assert.equal(grace.slug, 'amazing-grace');
});

test('parseSongDatabases reports a row with a missing title/song_uid', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', [null, 'Untitled Hymn', 'Nobody']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words TEXT)');
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, String.raw`{\rtf1\ansi Some lyrics}`]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.match(result.error, /missing or invalid title\/song_uid/);
  assert.equal(result.details.length, 1);
  assert.match(result.details[0], /Untitled Hymn/);
});

test('parseSongDatabases reports a song with empty lyrics', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-1', 'Blank Song', 'Nobody']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words TEXT)');
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, String.raw`{\rtf1\ansi }`]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.match(result.error, /empty lyrics/);
  assert.match(result.details[0], /Blank Song/);
});

test('parseSongDatabases decodes BLOB words instead of treating them as empty', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-1', 'Amazing Grace', 'John Newton']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words BLOB)');
    const rtfBytes = new TextEncoder().encode(String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound}`);
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, rtfBytes]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.equal(result.error, undefined);
  assert.equal(result.songs[0].lyrics, 'Amazing grace\nhow sweet the sound');
});

test('isSqliteFile recognizes a real SQLite file and rejects garbage', async () => {
  const bytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE t (a INT)');
  });
  assert.equal(isSqliteFile(bytes), true);
  assert.equal(isSqliteFile(new TextEncoder().encode('not a database')), false);
  assert.equal(isSqliteFile(new Uint8Array(4)), false);
});

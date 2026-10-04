import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBackupTimestamp, backupPrefix, backupTimestampsFromListing, formatBackupLabel, backupCurrentPair } from './r2-backup.js';

function fakeR2(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const bytes = store.get(key);
      return { arrayBuffer: async () => bytes };
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

test('backupCurrentPair copies both live files into a dated backups/ folder and returns its timestamp', async () => {
  const songs = new Uint8Array([1, 2, 3]).buffer;
  const words = new Uint8Array([4, 5]).buffer;
  const r2 = fakeR2({ 'current/Songs.db': songs, 'current/SongWords.db': words });

  const timestamp = await backupCurrentPair(r2, new Date('2026-10-04T16:20:20.000Z'));

  assert.equal(timestamp, '2026-10-04T16-20-20');
  assert.equal(r2.store.get('backups/2026-10-04T16-20-20/Songs.db'), songs);
  assert.equal(r2.store.get('backups/2026-10-04T16-20-20/SongWords.db'), words);
  assert.ok(r2.store.has('current/Songs.db'), 'the live files are left in place');
});

test('backupCurrentPair returns null and writes nothing when there is nothing to back up', async () => {
  const r2 = fakeR2();
  assert.equal(await backupCurrentPair(r2), null);
  assert.equal(r2.store.size, 0);
});

test('backupCurrentPair refuses to make a half backup when one live file is missing', async () => {
  const r2 = fakeR2({ 'current/Songs.db': new Uint8Array([1]).buffer });
  assert.equal(await backupCurrentPair(r2), null);
  assert.equal(r2.store.size, 1);
});

test('formatBackupTimestamp formats a fixed date as YYYY-MM-DDTHH-mm-ss', () => {
  const date = new Date('2026-09-29T20:30:05.123Z');
  assert.equal(formatBackupTimestamp(date), '2026-09-29T20-30-05');
});

test('backupPrefix builds the backups/<timestamp>/ key prefix', () => {
  assert.equal(backupPrefix('2026-09-29T20-30-05'), 'backups/2026-09-29T20-30-05/');
});

test('backupTimestampsFromListing extracts and dedupes timestamps, sorted newest first', () => {
  const keys = [
    'backups/2026-09-01T10-00-00/Songs.db',
    'backups/2026-09-01T10-00-00/SongWords.db',
    'backups/2026-09-15T08-00-00/Songs.db',
    'backups/2026-09-15T08-00-00/SongWords.db',
    'current/Songs.db',
    'current/meta.json',
  ];
  assert.deepEqual(backupTimestampsFromListing(keys), ['2026-09-15T08-00-00', '2026-09-01T10-00-00']);
});

test('backupTimestampsFromListing returns an empty array when there are no backups', () => {
  assert.deepEqual(backupTimestampsFromListing(['current/Songs.db']), []);
});

test('formatBackupLabel turns a timestamp into a human-readable "date time" string', () => {
  assert.equal(formatBackupLabel('2026-09-29T20-30-05'), '2026-09-29 20:30:05');
});

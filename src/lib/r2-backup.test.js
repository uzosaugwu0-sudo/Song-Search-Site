import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBackupTimestamp, backupPrefix, backupTimestampsFromListing, formatBackupLabel } from './r2-backup.js';

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

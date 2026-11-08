import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSongs } from './song-search.js';

const SONGS = [
  { id: 'a', slug: 'amazing-grace', title: 'Amazing Grace', author: 'John Newton', lyrics: 'Amazing grace how sweet the sound' },
  { id: 'b', slug: 'how-great', title: 'How Great Thou Art', author: 'Carl Boberg', lyrics: 'O Lord my God' },
];

test('searchSongs matches on title, case-insensitively', () => {
  const results = searchSongs(SONGS, 'amazing');
  assert.deepEqual(results.map((r) => r.song.id), ['a']);
});

test('searchSongs matches on lyrics and returns a snippet around the match', () => {
  const results = searchSongs(SONGS, 'sweet the sound');
  assert.equal(results[0].song.id, 'a');
  assert.ok(results[0].snippet);
  assert.match(results[0].snippet.match, /sweet the sound/i);
});

test('searchSongs falls back to a fuzzy title match when nothing matches exactly, with no snippet', () => {
  const results = searchSongs(SONGS, 'Amazin Grase');
  assert.deepEqual(results.map((r) => r.song.id), ['a']);
  assert.equal(results[0].snippet, null);
});

test('searchSongs returns an empty array for a query that matches nothing at all', () => {
  assert.deepEqual(searchSongs(SONGS, 'zzzzzzz'), []);
});

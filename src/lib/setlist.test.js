import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETLIST_SIZE,
  filterValidSongIds,
  generateSetlistId,
  buildSetlistValue,
  prepareSongIdsForCreate,
  prepareSongIdsForUpdate,
  jsonResponse,
} from './setlist.js';

test('MAX_SETLIST_SIZE is 50', () => {
  assert.equal(MAX_SETLIST_SIZE, 50);
});

test('filterValidSongIds keeps only IDs present in the valid set, in order', () => {
  const valid = new Set(['a', 'b', 'c']);
  assert.deepEqual(filterValidSongIds(['a', 'x', 'b', 'y'], valid), ['a', 'b']);
});

test('filterValidSongIds returns an empty array for non-array input', () => {
  const valid = new Set(['a']);
  assert.deepEqual(filterValidSongIds(null, valid), []);
  assert.deepEqual(filterValidSongIds(undefined, valid), []);
  assert.deepEqual(filterValidSongIds('a', valid), []);
});

test('filterValidSongIds ignores non-string entries', () => {
  const valid = new Set(['a']);
  assert.deepEqual(filterValidSongIds(['a', 42, null, {}], valid), ['a']);
});

test('generateSetlistId returns a 10-character alphanumeric string', () => {
  const id = generateSetlistId();
  assert.equal(id.length, 10);
  assert.match(id, /^[A-Za-z0-9]{10}$/);
});

test('generateSetlistId returns different values across calls', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateSetlistId()));
  assert.equal(ids.size, 100);
});

test('buildSetlistValue stores the song ids and an ISO timestamp', () => {
  const value = JSON.parse(buildSetlistValue(['a', 'b']));
  assert.deepEqual(value.songIds, ['a', 'b']);
  assert.equal(new Date(value.updatedAt).toISOString(), value.updatedAt);
});

test('prepareSongIdsForCreate rejects an empty list', () => {
  const valid = new Set(['a', 'b']);
  const result = prepareSongIdsForCreate([], valid);
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate rejects a list of only unknown ids', () => {
  const valid = new Set(['a', 'b']);
  const result = prepareSongIdsForCreate(['x', 'y'], valid);
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate rejects more than MAX_SETLIST_SIZE valid ids', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const requested = Array.from({ length: 51 }, (_, i) => `id${i}`);
  const result = prepareSongIdsForCreate(requested, valid);
  assert.equal(result.error, 'A set list can hold at most 50 songs');
});

test('prepareSongIdsForCreate accepts exactly MAX_SETLIST_SIZE valid ids', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const requested = Array.from({ length: 50 }, (_, i) => `id${i}`);
  const result = prepareSongIdsForCreate(requested, valid);
  assert.equal(result.songIds.length, 50);
  assert.equal(result.error, undefined);
});

test('prepareSongIdsForUpdate allows an empty list', () => {
  const valid = new Set(['a', 'b']);
  const result = prepareSongIdsForUpdate([], valid);
  assert.deepEqual(result.songIds, []);
  assert.equal(result.error, undefined);
});

test('prepareSongIdsForUpdate rejects more than MAX_SETLIST_SIZE valid ids', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const requested = Array.from({ length: 51 }, (_, i) => `id${i}`);
  const result = prepareSongIdsForUpdate(requested, valid);
  assert.equal(result.error, 'A set list can hold at most 50 songs');
});

test('jsonResponse sets the status and Content-Type, and serializes the body as JSON', async () => {
  const response = jsonResponse({ hello: 'world' }, 404);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(await response.json(), { hello: 'world' });
});

test('jsonResponse defaults to status 200', () => {
  const response = jsonResponse({ ok: true });
  assert.equal(response.status, 200);
});

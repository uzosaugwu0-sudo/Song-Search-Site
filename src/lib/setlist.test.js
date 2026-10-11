import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETLIST_SIZE,
  filterValidItems,
  generateSetlistId,
  buildSetlistValue,
  prepareSongIdsForCreate,
  prepareSongIdsForUpdate,
  jsonResponse,
  MAX_SETLIST_NAME_LENGTH,
  prepareSetlistName,
} from './setlist.js';

test('MAX_SETLIST_SIZE is 50', () => {
  assert.equal(MAX_SETLIST_SIZE, 50);
});

test('filterValidItems keeps only IDs present in the valid set, in order', () => {
  const valid = new Set(['a', 'b', 'c']);
  assert.deepEqual(filterValidItems(['a', 'x', 'b', 'y'], valid), ['a', 'b']);
});

test('filterValidItems returns an empty array for non-array input', () => {
  const valid = new Set(['a']);
  assert.deepEqual(filterValidItems(null, valid), []);
  assert.deepEqual(filterValidItems(undefined, valid), []);
  assert.deepEqual(filterValidItems('a', valid), []);
});

test('filterValidItems ignores non-string entries', () => {
  const valid = new Set(['a']);
  assert.deepEqual(filterValidItems(['a', 42, null, {}], valid), ['a']);
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

test('buildSetlistValue stores the song ids, name, and an ISO timestamp', () => {
  const value = JSON.parse(buildSetlistValue(['a', 'b'], 'Sunday Service'));
  assert.deepEqual(value.songIds, ['a', 'b']);
  assert.equal(value.name, 'Sunday Service');
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

test('jsonResponse sets the status, Content-Type, and Cache-Control, and serializes the body as JSON', async () => {
  const response = jsonResponse({ hello: 'world' }, 404);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { hello: 'world' });
});

test('jsonResponse defaults to status 200', () => {
  const response = jsonResponse({ ok: true });
  assert.equal(response.status, 200);
});

test('MAX_SETLIST_NAME_LENGTH is 100', () => {
  assert.equal(MAX_SETLIST_NAME_LENGTH, 100);
});

test('prepareSetlistName rejects an empty string', () => {
  const result = prepareSetlistName('');
  assert.equal(result.error, 'A set list needs a name');
});

test('prepareSetlistName rejects a whitespace-only string', () => {
  const result = prepareSetlistName('   ');
  assert.equal(result.error, 'A set list needs a name');
});

test('prepareSetlistName rejects non-string input', () => {
  assert.equal(prepareSetlistName(undefined).error, 'A set list needs a name');
  assert.equal(prepareSetlistName(null).error, 'A set list needs a name');
  assert.equal(prepareSetlistName(42).error, 'A set list needs a name');
});

test('prepareSetlistName trims and accepts a valid name', () => {
  const result = prepareSetlistName('  Sunday Service — Sept 28  ');
  assert.equal(result.name, 'Sunday Service — Sept 28');
  assert.equal(result.error, undefined);
});

test('prepareSetlistName accepts a name exactly MAX_SETLIST_NAME_LENGTH characters long', () => {
  const name = 'a'.repeat(MAX_SETLIST_NAME_LENGTH);
  const result = prepareSetlistName(name);
  assert.equal(result.name, name);
  assert.equal(result.error, undefined);
});

test('prepareSetlistName rejects a name longer than MAX_SETLIST_NAME_LENGTH characters', () => {
  const name = 'a'.repeat(MAX_SETLIST_NAME_LENGTH + 1);
  const result = prepareSetlistName(name);
  assert.equal(result.error, 'A set list name can be at most 100 characters');
});

import { buildSetlistMetadata, toListEntries, parseLiveSetlist, markDeleted, SOFT_DELETE_TTL_SECONDS } from './setlist.js';

test('buildSetlistMetadata summarises name, song count, createdAt and updatedAt', () => {
  assert.deepEqual(
    buildSetlistMetadata(['a', { section: 'Praise' }, 'b'], 'Sunday', '2026-10-01T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
    { name: 'Sunday', count: 2, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z' },
  );
});

test('toListEntries drops deleted lists and sorts newest first', () => {
  const keys = [
    { name: 'old', metadata: { name: 'Old', count: 1, updatedAt: '2026-01-01T00:00:00.000Z' } },
    { name: 'gone', metadata: { deleted: true } },
    { name: 'new', metadata: { name: 'New', count: 3, updatedAt: '2026-06-01T00:00:00.000Z' } },
  ];
  assert.deepEqual(toListEntries(keys).map((e) => e.id), ['new', 'old']);
});

test('parseLiveSetlist returns null for missing or deleted lists', () => {
  assert.equal(parseLiveSetlist(null), null);
  assert.equal(parseLiveSetlist(JSON.stringify({ songIds: [], name: 'x', deleted: true })), null);
  assert.equal(parseLiveSetlist(JSON.stringify({ songIds: ['a'], name: 'x' })).name, 'x');
});

test('markDeleted flags the list and keeps its songs for the recovery window', () => {
  const value = JSON.parse(markDeleted(JSON.stringify({ songIds: ['a'], name: 'x' })));
  assert.equal(value.deleted, true);
  assert.deepEqual(value.songIds, ['a']);
  assert.equal(SOFT_DELETE_TTL_SECONDS, 30 * 24 * 60 * 60);
});

import { putSetlist, formatListDate } from './setlist.js';

test('filterValidItems keeps headings trimmed, strips extra keys, and drops bad headings', () => {
  const valid = new Set(['a', 'b']);
  const items = ['a', { section: '  Praise  ', extra: 1 }, { section: '   ' }, { section: 'x'.repeat(61) }, 'b'];
  assert.deepEqual(filterValidItems(items, valid), ['a', { section: 'Praise' }, 'b']);
});

test('filterValidItems collapses duplicate song ids but allows duplicate headings', () => {
  const valid = new Set(['a']);
  const items = ['a', { section: 'Praise' }, 'a', { section: 'Praise' }];
  assert.deepEqual(filterValidItems(items, valid), ['a', { section: 'Praise' }, { section: 'Praise' }]);
});

test('prepareSongIdsForCreate rejects a list with headings but no songs', () => {
  const result = prepareSongIdsForCreate([{ section: 'Praise' }], new Set(['a']));
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate accepts songs with headings', () => {
  const result = prepareSongIdsForCreate([{ section: 'Praise' }, 'a'], new Set(['a']));
  assert.deepEqual(result.songIds, [{ section: 'Praise' }, 'a']);
});

test('prepareSongIdsForUpdate rejects an empty or overlong section name', () => {
  const valid = new Set(['a']);
  assert.equal(prepareSongIdsForUpdate(['a', { section: '  ' }], valid).error, 'A section name must be 1-60 characters');
  assert.equal(prepareSongIdsForUpdate(['a', { section: 'x'.repeat(61) }], valid).error, 'A section name must be 1-60 characters');
});

test('prepareSongIdsForUpdate rejects more than 10 sections but allows exactly 10', () => {
  const valid = new Set(['a']);
  const tenHeadings = Array.from({ length: 10 }, (_, i) => ({ section: `S${i}` }));
  assert.equal(prepareSongIdsForUpdate(tenHeadings, valid).error, undefined);
  const elevenHeadings = [...tenHeadings, { section: 'S10' }];
  assert.equal(prepareSongIdsForUpdate(elevenHeadings, valid).error, 'A set list can have at most 10 sections');
});

test('headings do not count toward the 50-song limit', () => {
  const valid = new Set(Array.from({ length: 50 }, (_, i) => `id${i}`));
  const items = [{ section: 'A' }, ...Array.from({ length: 50 }, (_, i) => `id${i}`)];
  assert.equal(prepareSongIdsForUpdate(items, valid).error, undefined);
});

test('buildSetlistValue defaults createdAt to updatedAt and keeps a supplied createdAt', () => {
  const fresh = JSON.parse(buildSetlistValue(['a'], 'X'));
  assert.equal(fresh.createdAt, fresh.updatedAt);
  const edited = JSON.parse(buildSetlistValue(['a'], 'X', '2026-01-01T00:00:00.000Z'));
  assert.equal(edited.createdAt, '2026-01-01T00:00:00.000Z');
  assert.notEqual(edited.updatedAt, edited.createdAt);
});

test('putSetlist writes the value and matching metadata, preserving supplied dates', async () => {
  const calls = [];
  const kv = { put: async (...args) => { calls.push(args); } };
  const value = await putSetlist(kv, 'id1', ['a', { section: 'S' }], 'Name', {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'id1');
  assert.deepEqual(JSON.parse(calls[0][1]), JSON.parse(value));
  assert.deepEqual(calls[0][2].metadata, {
    name: 'Name', count: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z',
  });
});

test('toListEntries falls back to updatedAt for legacy lists and sorts by created date', () => {
  const keys = [
    { name: 'legacy', metadata: { name: 'Legacy', count: 1, updatedAt: '2026-03-01T00:00:00.000Z' } },
    { name: 'newer', metadata: { name: 'Newer', count: 1, createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' } },
    { name: 'edited', metadata: { name: 'Edited', count: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' } },
  ];
  const entries = toListEntries(keys);
  assert.deepEqual(entries.map((e) => e.id), ['newer', 'legacy', 'edited']);
  assert.equal(entries[1].createdAt, '2026-03-01T00:00:00.000Z');
});

test('formatListDate formats an ISO date and returns empty for bad input', () => {
  assert.match(formatListDate('2026-10-12T12:00:00.000Z'), /^Oct 1[12], 2026$/);
  assert.equal(formatListDate(undefined), '');
  assert.equal(formatListDate('not a date'), '');
});

import { needsBackfill } from './setlist.js';

test('needsBackfill is true only for lists with no metadata at all', () => {
  assert.equal(needsBackfill({ name: 'a' }), true);
  assert.equal(needsBackfill({ name: 'a', metadata: null }), true);
  // Pre-createdAt lists already show their updatedAt as the date; rewriting them risks overwriting a fresh edit.
  assert.equal(needsBackfill({ name: 'a', metadata: { name: 'A', count: 1, updatedAt: '2026-01-01T00:00:00.000Z' } }), false);
  assert.equal(needsBackfill({ name: 'a', metadata: { deleted: true } }), false);
});

import { groupListsByDay } from './setlist.js';

// Dates are built from local components so the tests do not depend on the machine's timezone.
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

test('groupListsByDay groups by local calendar day, newest day first, newest list first within a day', () => {
  const lists = [
    { id: 'a', createdAt: at(2026, 10, 12, 9) },
    { id: 'b', createdAt: at(2026, 10, 5, 20) },
    { id: 'c', createdAt: at(2026, 10, 12, 23, 30) },
  ];
  const groups = groupListsByDay(lists, new Date(2026, 9, 20));
  assert.deepEqual(groups.map((g) => g.key), ['2026-10-12', '2026-10-05']);
  assert.deepEqual(groups[0].lists.map((l) => l.id), ['c', 'a']);
  assert.deepEqual(groups[1].lists.map((l) => l.id), ['b']);
});

test('groupListsByDay marks only today as today and labels each day', () => {
  const lists = [{ id: 'a', createdAt: at(2026, 10, 20, 8) }, { id: 'b', createdAt: at(2026, 10, 19, 8) }];
  const groups = groupListsByDay(lists, new Date(2026, 9, 20, 15));
  assert.deepEqual(groups.map((g) => g.isToday), [true, false]);
  assert.equal(groups[0].label, 'Oct 20, 2026');
});

test('groupListsByDay handles no lists and skips entries without a usable date', () => {
  assert.deepEqual(groupListsByDay([], new Date()), []);
  assert.deepEqual(groupListsByDay([{ id: 'x', createdAt: 'nope' }], new Date()), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETLIST_SECTIONS,
  MAX_SECTION_NAME_LENGTH,
  isHeading,
  countSongs,
  addHeading,
  renameHeading,
  removeAt,
  moveItem,
} from './sections.js';

test('limits are 10 sections and 60 characters', () => {
  assert.equal(MAX_SETLIST_SECTIONS, 10);
  assert.equal(MAX_SECTION_NAME_LENGTH, 60);
});

test('isHeading is true only for objects with a string section', () => {
  assert.equal(isHeading({ section: 'Praise' }), true);
  assert.equal(isHeading('song1'), false);
  assert.equal(isHeading(null), false);
  assert.equal(isHeading({ section: 5 }), false);
  assert.equal(isHeading({}), false);
});

test('countSongs ignores headings', () => {
  assert.equal(countSongs(['a', { section: 'Praise' }, 'b']), 2);
  assert.equal(countSongs([]), 0);
});

test('addHeading appends a heading without mutating the input', () => {
  const items = ['a'];
  const next = addHeading(items, 'Praise');
  assert.deepEqual(next, ['a', { section: 'Praise' }]);
  assert.deepEqual(items, ['a']);
});

test('renameHeading renames only a heading at that index', () => {
  const items = ['a', { section: 'Old' }];
  assert.deepEqual(renameHeading(items, 1, 'New'), ['a', { section: 'New' }]);
  assert.deepEqual(renameHeading(items, 0, 'New'), items);
});

test('removeAt drops one item and keeps the rest in order', () => {
  const items = ['a', { section: 'Praise' }, 'b'];
  assert.deepEqual(removeAt(items, 1), ['a', 'b']);
  assert.equal(items.length, 3);
});

test('moveItem swaps with the neighbour, including across a heading', () => {
  const items = ['a', { section: 'Praise' }, 'b'];
  assert.deepEqual(moveItem(items, 2, -1), ['a', 'b', { section: 'Praise' }]);
  assert.deepEqual(moveItem(items, 0, 1), [{ section: 'Praise' }, 'a', 'b']);
});

test('moveItem returns an unchanged copy when the move is out of range', () => {
  const items = ['a', 'b'];
  assert.deepEqual(moveItem(items, 0, -1), ['a', 'b']);
  assert.deepEqual(moveItem(items, 1, 1), ['a', 'b']);
});

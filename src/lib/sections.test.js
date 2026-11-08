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

import { cleanSectionName } from './sections.js';

test('cleanSectionName trims, caps at 60 characters, and returns null for empty or cancelled input', () => {
  assert.equal(cleanSectionName('  Praise  '), 'Praise');
  assert.equal(cleanSectionName('x'.repeat(70)), 'x'.repeat(60));
  assert.equal(cleanSectionName('   '), null);
  assert.equal(cleanSectionName(null), null);
});

import { groupBySection } from './sections.js';

test('groupBySection keeps unheaded songs first, then one group per heading with original indexes', () => {
  const items = ['a', { section: 'Praise' }, 'b', 'c', { section: 'Closing' }];
  assert.deepEqual(groupBySection(items), [
    { heading: null, headingIndex: -1, entries: [{ item: 'a', index: 0 }] },
    { heading: { section: 'Praise' }, headingIndex: 1, entries: [{ item: 'b', index: 2 }, { item: 'c', index: 3 }] },
    { heading: { section: 'Closing' }, headingIndex: 4, entries: [] },
  ]);
});

test('groupBySection of an empty list is one empty unheaded group', () => {
  assert.deepEqual(groupBySection([]), [{ heading: null, headingIndex: -1, entries: [] }]);
});

import { countUnsorted, placeInSection, moveToAdjacentSection } from './sections.js';

test('countUnsorted counts only the songs before the first heading', () => {
  assert.equal(countUnsorted(['a', 'b', { section: 'Praise' }, 'c']), 2);
  assert.equal(countUnsorted([{ section: 'Praise' }, 'a']), 0);
  assert.equal(countUnsorted([]), 0);
});

test('placeInSection appends a new song to the end of a named section', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(placeInSection(['a', H1, 'b'], 'c', H1), ['a', H1, 'b', 'c']);
});

test('placeInSection appends a new song to Unsorted when targetHeading is null', () => {
  assert.deepEqual(placeInSection(['a', 'b'], 'c', null), ['a', 'b', 'c']);
});

test('placeInSection inserts before the next heading, not at the end of the array', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(placeInSection(['a', H1, 'b', H2, 'c'], 'd', H1), ['a', H1, 'b', 'd', H2, 'c']);
});

test('placeInSection moves an already-placed song: removes it from its old spot first', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(placeInSection(['a', H1, 'b', H2, 'c'], 'b', H2), ['a', H1, H2, 'c', 'b']);
});

test('placeInSection can move a placed song back into Unsorted', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(placeInSection(['a', H1, 'b'], 'b', null), ['a', 'b', H1]);
});

test('placeInSection into a section that currently has no songs still lands correctly', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(placeInSection(['a', H1, H2, 'b'], 'c', H1), ['a', H1, 'c', H2, 'b']);
});

test('placeInSection falls back to appending at the end if targetHeading is not found in items', () => {
  const stray = { section: 'Nowhere' };
  assert.deepEqual(placeInSection(['a', { section: 'Opening' }], 'c', stray), ['a', { section: 'Opening' }, 'c']);
});

test('moveToAdjacentSection moves a song to the previous section', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, H2, 'b'], 'b', -1), ['a', H1, 'b', H2]);
});

test('moveToAdjacentSection moves a song to the next section', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b', H2], 'b', 1), ['a', H1, H2, 'b']);
});

test('moveToAdjacentSection moving up from the first section lands in Unsorted', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b'], 'b', -1), ['a', 'b', H1]);
});

test('moveToAdjacentSection is a no-op past the last section or before Unsorted', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b'], 'b', 1), ['a', H1, 'b']);
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b'], 'a', -1), ['a', H1, 'b']);
});

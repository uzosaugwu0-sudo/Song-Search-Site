import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups } from './duplicate-groups.js';

test('groups songs whose titles match after normalizing punctuation, case, and spacing', () => {
  const songs = [
    { id: '1', title: 'Amazing Grace', slug: 'amazing-grace-1' },
    { id: '2', title: 'amazing_grace', slug: 'amazing-grace-2' },
    { id: '3', title: 'AMAZING  GRACE!', slug: 'amazing-grace-3' },
    { id: '4', title: 'Way Maker', slug: 'way-maker' },
  ];

  const groups = findDuplicateGroups(songs);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
  assert.deepEqual(groups[0].map((s) => s.id), ['1', '2', '3']);
});

test('does not group songs with genuinely different titles', () => {
  const songs = [
    { id: '1', title: 'Amazing Grace', slug: 'amazing-grace' },
    { id: '2', title: 'Amazing Grace 2', slug: 'amazing-grace-2' },
  ];

  assert.equal(findDuplicateGroups(songs).length, 0);
});

test('returns an empty array when there are no duplicates', () => {
  const songs = [
    { id: '1', title: 'Amazing Grace', slug: 'amazing-grace' },
    { id: '2', title: 'Way Maker', slug: 'way-maker' },
  ];

  assert.deepEqual(findDuplicateGroups(songs), []);
});

test('ignores songs whose title normalizes to empty (non-Latin/punctuation-only)', () => {
  const songs = [
    { id: '1', title: '...', slug: 'a' },
    { id: '2', title: '!!!', slug: 'b' },
  ];

  assert.deepEqual(findDuplicateGroups(songs), []);
});

test('sorts groups alphabetically by the first song\'s title', () => {
  const songs = [
    { id: '1', title: 'Way Maker', slug: 'way-maker-1' },
    { id: '2', title: 'way maker', slug: 'way-maker-2' },
    { id: '3', title: 'Amazing Grace', slug: 'amazing-grace-1' },
    { id: '4', title: 'amazing grace', slug: 'amazing-grace-2' },
  ];

  const groups = findDuplicateGroups(songs);

  assert.equal(groups.length, 2);
  assert.equal(groups[0][0].title, 'Amazing Grace');
  assert.equal(groups[1][0].title, 'Way Maker');
});

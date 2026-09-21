import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, assignSlugs } from './slugify.js';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Amazing Grace'), 'amazing-grace');
});

test('slugify strips punctuation', () => {
  assert.equal(slugify('How Great Thou Art (Reprise)'), 'how-great-thou-art-reprise');
});

test('slugify collapses repeated separators and trims leading/trailing hyphens', () => {
  assert.equal(slugify('  Holy, Holy, Holy!!  '), 'holy-holy-holy');
});

test('assignSlugs keeps the base slug when there is no title collision', () => {
  const songs = [{ id: 'uid-1', title: 'Amazing Grace' }];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'amazing-grace');
});

test('assignSlugs appends song_uid to disambiguate colliding titles', () => {
  const songs = [
    { id: 'uid-1', title: 'Alleluia' },
    { id: 'uid-2', title: 'Alleluia' },
  ];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'alleluia-uid-1');
  assert.equal(result[1].slug, 'alleluia-uid-2');
});

test('assignSlugs preserves all other song fields', () => {
  const songs = [{ id: 'uid-1', title: 'Amazing Grace', author: 'John Newton', lyrics: '...' }];
  const result = assignSlugs(songs);
  assert.equal(result[0].author, 'John Newton');
  assert.equal(result[0].lyrics, '...');
});

test('slugify returns empty string for non-Latin/punctuation-only titles', () => {
  assert.equal(slugify('奇異恩典'), '');
  assert.equal(slugify('!!!'), '');
});

test('assignSlugs gives a non-empty fallback slug when the title slugifies to empty', () => {
  const songs = [{ id: 'uid-1', title: '奇異恩典' }];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'song');
  assert.ok(result[0].slug.length > 0);
});

test('assignSlugs gives distinct, non-empty, non-leading-hyphen slugs for two colliding non-Latin titles', () => {
  const songs = [
    { id: 'uid-1', title: '奇異恩典' },
    { id: 'uid-2', title: '!!!' },
  ];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'song-uid-1');
  assert.equal(result[1].slug, 'song-uid-2');
  assert.notEqual(result[0].slug, result[1].slug);
  for (const song of result) {
    assert.ok(song.slug.length > 0);
    assert.ok(!song.slug.startsWith('-'));
    assert.ok(!song.slug.endsWith('-'));
  }
});

test('assignSlugs sanitizes song ids containing spaces/slashes when disambiguating', () => {
  const songs = [
    { id: 'uid 1/a', title: 'Alleluia' },
    { id: 'uid 2/b', title: 'Alleluia' },
  ];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'alleluia-uid-1-a');
  assert.equal(result[1].slug, 'alleluia-uid-2-b');
  for (const song of result) {
    assert.ok(!/[\s/]/.test(song.slug));
  }
});

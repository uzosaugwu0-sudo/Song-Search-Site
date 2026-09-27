import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle } from './normalize.js';

test('lowercases and collapses whitespace', () => {
  assert.equal(normalizeTitle('Amazing  Grace'), 'amazing grace');
});

test('treats underscores as a word separator, not a deletion', () => {
  assert.equal(normalizeTitle('amazing_grace'), normalizeTitle('Amazing Grace'));
});

test('treats punctuation as a word separator', () => {
  assert.equal(normalizeTitle('AMAZING  GRACE!'), 'amazing grace');
});

test('returns empty string for punctuation-only input', () => {
  assert.equal(normalizeTitle('...'), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECENT_LIMIT, RECENT_RESET_AFTER_VIEWS, nextRecentState, recordView } from './recent.js';

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
}

test('limits are 20 songs and a reset after 50 views', () => {
  assert.equal(RECENT_LIMIT, 20);
  assert.equal(RECENT_RESET_AFTER_VIEWS, 50);
});

test('nextRecentState puts the newest song first and counts the view', () => {
  const next = nextRecentState({ recent: ['a', 'b'], views: 3 }, 'c');
  assert.deepEqual(next, { recent: ['c', 'a', 'b'], views: 4 });
});

test('nextRecentState moves a repeated song to the front without duplicating it', () => {
  const next = nextRecentState({ recent: ['a', 'b', 'c'], views: 1 }, 'c');
  assert.deepEqual(next.recent, ['c', 'a', 'b']);
});

test('nextRecentState keeps at most RECENT_LIMIT songs', () => {
  const recent = Array.from({ length: RECENT_LIMIT }, (_, i) => `s${i}`);
  const next = nextRecentState({ recent, views: 1 }, 'new');
  assert.equal(next.recent.length, RECENT_LIMIT);
  assert.equal(next.recent[0], 'new');
  assert.ok(!next.recent.includes(`s${RECENT_LIMIT - 1}`));
});

test('the 50th view still keeps the history', () => {
  const next = nextRecentState({ recent: ['a'], views: RECENT_RESET_AFTER_VIEWS - 1 }, 'b');
  assert.deepEqual(next, { recent: ['b', 'a'], views: RECENT_RESET_AFTER_VIEWS });
});

test('the view after the limit resets the history to just that song and restarts the count', () => {
  const next = nextRecentState({ recent: ['a', 'b'], views: RECENT_RESET_AFTER_VIEWS }, 'c');
  assert.deepEqual(next, { recent: ['c'], views: 1 });
});

test('recordView reads and writes the saved list and counter', () => {
  const storage = fakeStorage({ songSearchRecent: '["a"]', songSearchViews: '2' });
  recordView('b', storage);
  assert.equal(storage.getItem('songSearchRecent'), '["b","a"]');
  assert.equal(storage.getItem('songSearchViews'), '3');
});

test('recordView starts fresh when nothing is saved or the saved data is corrupt', () => {
  const empty = fakeStorage();
  recordView('a', empty);
  assert.equal(empty.getItem('songSearchRecent'), '["a"]');
  assert.equal(empty.getItem('songSearchViews'), '1');

  const corrupt = fakeStorage({ songSearchRecent: '{not json', songSearchViews: 'abc' });
  recordView('z', corrupt);
  assert.equal(corrupt.getItem('songSearchRecent'), '["z"]');
  assert.equal(corrupt.getItem('songSearchViews'), '1');
});

test('recordView never throws when storage is unavailable', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => recordView('a', broken));
});

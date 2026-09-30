import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSongs } from './songs-data.js';

test('loadSongs returns the parsed array when the KV key exists', async () => {
  const kv = { async get() { return JSON.stringify([{ id: '1', title: 'A' }]); } };
  assert.deepEqual(await loadSongs(kv), [{ id: '1', title: 'A' }]);
});

test('loadSongs returns an empty array when the KV key is missing', async () => {
  const kv = { async get() { return null; } };
  assert.deepEqual(await loadSongs(kv), []);
});

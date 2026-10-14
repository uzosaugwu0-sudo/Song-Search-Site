import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_BYTES, exceedsUploadLimit } from './upload-limits.js';

test('exceedsUploadLimit is false at and under the cap, true just over it', () => {
  assert.equal(exceedsUploadLimit(new Uint8Array(MAX_UPLOAD_BYTES)), false);
  assert.equal(exceedsUploadLimit(new Uint8Array(MAX_UPLOAD_BYTES + 1)), true);
});

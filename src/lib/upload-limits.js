// Pure, dependency-free so it can be unit-tested without pulling in sql.js's
// wasm loader (see sqlite-worker-init.js), which only resolves under a bundler
// or the Workers runtime, not plain `node --test`.

// Cloudflare Workers already cap memory and CPU time, but failing fast on an
// oversized upload avoids wasting either on a file we're going to reject anyway.
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function exceedsUploadLimit(bytes) {
  return bytes.length > MAX_UPLOAD_BYTES;
}

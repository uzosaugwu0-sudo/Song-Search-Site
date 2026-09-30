# Admin Panel for Song Database Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dev team upload new `Songs.db`/`SongWords.db` files directly on the site through a password-gated `/admin/` panel, with server-side parsing, immediate go-live (no redeploy), timestamped R2 backups, and one-click restore.

**Architecture:** Song data moves from a build-time-bundled JSON file to a Cloudflare KV value (`SONGS_DATA`) read at request time by four pages, which therefore switch from prerendered (static) to server-rendered. Raw `.db` files and their timestamped backups live in a new R2 bucket (`SONG_DB_FILES`). Parsing happens inside the Worker using `sql.js` (WASM SQLite) via a proven `instantiateWasm` + `globalThis.location` polyfill recipe, validated end-to-end against a real `wrangler dev` run before this plan was written. Auth is a single shared password plus an HMAC-signed session cookie, no accounts/database.

**Tech Stack:** Astro 5 (`output: 'server'`), `@astrojs/cloudflare`, Cloudflare Workers/KV/R2, `sql.js`, Web Crypto (`crypto.subtle`).

**Spec:** `docs/superpowers/specs/2026-09-29-admin-db-panel-design.md`

## Global Constraints

- `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are Cloudflare Worker secrets (`wrangler secret put`), never committed to the repo.
- Session cookie name: `admin_session`. Flags: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`. Duration: 12 hours (`SESSION_DURATION_MS = 12 * 60 * 60 * 1000`).
- Login rate limit: 10 failed attempts per 15-minute window (`RATE_LIMIT_MAX_ATTEMPTS = 10`, `RATE_LIMIT_WINDOW_SECONDS = 900`), keyed on the `CF-Connecting-IP` request header, stored in a new KV namespace bound as `ADMIN_RATE_LIMIT`.
- R2 bucket binding: `SONG_DB_FILES`. Keys: `current/Songs.db`, `current/SongWords.db`, `current/meta.json` (`{ uploadedAt, songCount }`), `backups/<timestamp>/Songs.db`, `backups/<timestamp>/SongWords.db`.
- Backup timestamp format: `YYYY-MM-DDTHH-mm-ss` (colons replaced with hyphens), produced by `new Date().toISOString().slice(0, 19).replace(/:/g, '-')`.
- KV namespace binding: `SONGS_DATA`. Single key `songs` holds `JSON.stringify(songs)` where each song is `{ id, title, author, lyrics, slug }` — the same shape `src/data/songs.json` has today.
- No backup pruning — every backup is kept forever.
- Upload validation ported from `scripts/import-db.js`: reject if any row has a missing/empty `title` or `song_uid`; reject if any song's parsed lyrics are empty after RTF-to-text conversion. Both failure classes return `{ error: string, details: string[] }`.
- SQLite magic-byte check: first 16 bytes of a valid file equal the literal string `SQLite format 3\0`.
- `sql.js` runs inside the Worker via `@astrojs/cloudflare`'s `cloudflareModules: true` option (static `.wasm` import → `WebAssembly.Module`), sql.js's `instantiateWasm` hook, and a `globalThis.location` polyfill (sql.js's browser build reads `self.location.href` when `WorkerGlobalScope` exists, which Cloudflare Workers doesn't provide by default) — this exact combination was verified working against a real `wrangler dev` process before this plan was written.
- No Co-Authored-By trailers on commits (per this session's established convention).
- `npm test` must stay green after every task.

---

### Task 1: Provision Cloudflare resources (orchestrator-run, not a subagent task)

This task creates real Cloudflare account resources and must be run directly by
whoever is executing this plan, with the user's explicit go-ahead first — never
dispatched to a subagent. It has no code to review, so it skips the usual
task-review step; just run the commands, then commit the resulting
`wrangler.jsonc` diff.

**Files:**
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: `env.SONGS_DATA` (KV binding), `env.ADMIN_RATE_LIMIT` (KV binding), `env.SONG_DB_FILES` (R2 binding) — consumed by every later task's Worker-side code. `env.ADMIN_PASSWORD`, `env.ADMIN_SESSION_SECRET` (Worker secrets, not in `wrangler.jsonc`) — consumed by Task 4/5.

- [ ] **Step 1: Confirm with the user before running anything**

These commands create billable-tier-eligible (though free-tier-covered at this
site's scale) Cloudflare resources and set account secrets. Ask the user to
confirm before proceeding, same as this session's precedent of confirming
before `wrangler deploy`.

- [ ] **Step 2: Create the two new KV namespaces, auto-updating `wrangler.jsonc`**

```bash
npx wrangler kv namespace create SONGS_DATA --binding SONGS_DATA --update-config
npx wrangler kv namespace create ADMIN_RATE_LIMIT --binding ADMIN_RATE_LIMIT --update-config
```

Each command prints the created namespace's id and, because of
`--update-config`, adds an entry to the `kv_namespaces` array in
`wrangler.jsonc` automatically. Verify by reading the file afterward — it
should now list `SETLISTS`, `SONGS_DATA`, and `ADMIN_RATE_LIMIT`.

- [ ] **Step 3: Create the R2 bucket**

```bash
npx wrangler r2 bucket create song-search-site-db-files
```

This has no `--update-config` flag, so add the binding to `wrangler.jsonc`
by hand — add this top-level key (alongside `kv_namespaces`):

```jsonc
  "r2_buckets": [
    { "binding": "SONG_DB_FILES", "bucket_name": "song-search-site-db-files" }
  ],
```

- [ ] **Step 4: Set the two secrets**

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

Each prompts interactively for a value (the user should supply these, not
the agent). `ADMIN_PASSWORD` is the shared dev-team password.
`ADMIN_SESSION_SECRET` should be a long random string (e.g. generate one
locally with `openssl rand -base64 32` and paste it in) — it's never typed
by a human day-to-day, only used to sign/verify session cookies.

- [ ] **Step 5: Commit the `wrangler.jsonc` change**

```bash
git add wrangler.jsonc
git commit -m "chore: provision KV namespaces and R2 bucket for admin db panel"
```

---

### Task 2: `src/lib/sqlite-parse.js` — pure SQLite parsing/validation logic

**Files:**
- Create: `src/lib/sqlite-parse.js`
- Test: `src/lib/sqlite-parse.test.js`
- Modify: `package.json` (add `sql.js` dependency)

**Interfaces:**
- Consumes: `rtfToPlainText` from `scripts/rtf-to-text.js` (existing, unchanged), `assignSlugs` from `scripts/slugify.js` (existing, unchanged).
- Produces: `isSqliteFile(bytes: Uint8Array): boolean`, `parseSongDatabases(SQL, songsDbBytes: Uint8Array, wordsDbBytes: Uint8Array): { songs: Array<{id, title, author, lyrics, slug}> } | { error: string, details: string[] }` — `SQL` is an initialized `sql.js` module object (the caller supplies it; this file never loads WASM itself, which is what keeps it plain-Node-testable). Consumed by Task 6's `src/lib/admin-db.js`.

This file takes an already-initialized `SQL` object as a parameter rather
than loading `sql.js`'s WASM itself, specifically so it can be unit-tested
under plain `node --test` without needing Cloudflare's Worker-specific WASM
loading path (that path lives in Task 6's `sqlite-worker-init.js` instead).
Tests here use `sql.js`'s ordinary Node build (the package's default
export), which loads its WASM via `fs` and works in plain Node with no
special flags — a completely different code path from the Worker's
`instantiateWasm` trick, but sql.js's public API (`db.exec`, `db.run`) is
identical either way, so `parseSongDatabases` doesn't care which build
initialized its `SQL` argument.

- [ ] **Step 1: Install the `sql.js` dependency**

```bash
npm install sql.js
```

- [ ] **Step 2: Write the failing tests**

```js
// src/lib/sqlite-parse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { parseSongDatabases, isSqliteFile } from './sqlite-parse.js';

async function buildFixtureDbBytes(build) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  build(db);
  const bytes = db.export();
  db.close();
  return bytes;
}

test('parseSongDatabases joins songs and words, assigns slugs', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-1', 'Amazing Grace', 'John Newton']);
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-2', 'Silent Night', 'Joseph Mohr']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words TEXT)');
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound}`]);
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [2, String.raw`{\rtf1\ansi Silent night\par holy night}`]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.equal(result.error, undefined);
  assert.equal(result.songs.length, 2);
  const grace = result.songs.find((s) => s.id === 'uid-1');
  assert.equal(grace.title, 'Amazing Grace');
  assert.equal(grace.author, 'John Newton');
  assert.equal(grace.lyrics, 'Amazing grace\nhow sweet the sound');
  assert.equal(grace.slug, 'amazing-grace');
});

test('parseSongDatabases reports a row with a missing title/song_uid', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', [null, 'Untitled Hymn', 'Nobody']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words TEXT)');
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, String.raw`{\rtf1\ansi Some lyrics}`]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.match(result.error, /missing or invalid title\/song_uid/);
  assert.equal(result.details.length, 1);
  assert.match(result.details[0], /Untitled Hymn/);
});

test('parseSongDatabases reports a song with empty lyrics', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-1', 'Blank Song', 'Nobody']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words TEXT)');
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, String.raw`{\rtf1\ansi }`]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.match(result.error, /empty lyrics/);
  assert.match(result.details[0], /Blank Song/);
});

test('parseSongDatabases decodes BLOB words instead of treating them as empty', async () => {
  const SQL = await initSqlJs();
  const songsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
    db.run('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)', ['uid-1', 'Amazing Grace', 'John Newton']);
  });
  const wordsDbBytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE word (song_id INTEGER, words BLOB)');
    const rtfBytes = new TextEncoder().encode(String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound}`);
    db.run('INSERT INTO word (song_id, words) VALUES (?, ?)', [1, rtfBytes]);
  });

  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  assert.equal(result.error, undefined);
  assert.equal(result.songs[0].lyrics, 'Amazing grace\nhow sweet the sound');
});

test('isSqliteFile recognizes a real SQLite file and rejects garbage', async () => {
  const bytes = await buildFixtureDbBytes((db) => {
    db.run('CREATE TABLE t (a INT)');
  });
  assert.equal(isSqliteFile(bytes), true);
  assert.equal(isSqliteFile(new TextEncoder().encode('not a database')), false);
  assert.equal(isSqliteFile(new Uint8Array(4)), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test src/lib/sqlite-parse.test.js`
Expected: FAIL with "Cannot find module './sqlite-parse.js'" (the file doesn't exist yet).

- [ ] **Step 4: Implement `src/lib/sqlite-parse.js`**

```js
// src/lib/sqlite-parse.js
import { rtfToPlainText } from '../../scripts/rtf-to-text.js';
import { assignSlugs } from '../../scripts/slugify.js';

const SQLITE_MAGIC = 'SQLite format 3\0';

export function isSqliteFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return false;
  const header = new TextDecoder('utf-8').decode(bytes.slice(0, 16));
  return header === SQLITE_MAGIC;
}

export function parseSongDatabases(SQL, songsDbBytes, wordsDbBytes) {
  const songsDb = new SQL.Database(songsDbBytes);
  const wordsDb = new SQL.Database(wordsDbBytes);

  let songResult, wordResult;
  try {
    songResult = songsDb.exec('SELECT rowid AS rowid, song_uid, title, author FROM song')[0];
    wordResult = wordsDb.exec('SELECT song_id, words FROM word')[0];
  } finally {
    songsDb.close();
    wordsDb.close();
  }

  const songColumns = songResult ? songResult.columns : [];
  const songValues = songResult ? songResult.values : [];
  const wordColumns = wordResult ? wordResult.columns : [];
  const wordValues = wordResult ? wordResult.values : [];

  const col = (columns, name) => columns.indexOf(name);
  const wSongIdIdx = col(wordColumns, 'song_id');
  const wWordsIdx = col(wordColumns, 'words');
  const wordsByRowId = new Map();
  for (const row of wordValues) {
    wordsByRowId.set(row[wSongIdIdx], row[wWordsIdx]);
  }

  const rowidIdx = col(songColumns, 'rowid');
  const uidIdx = col(songColumns, 'song_uid');
  const titleIdx = col(songColumns, 'title');
  const authorIdx = col(songColumns, 'author');

  const invalidRows = [];
  const failures = [];
  const songs = [];

  for (const row of songValues) {
    const rowid = row[rowidIdx];
    const songUid = row[uidIdx];
    const title = row[titleIdx];
    const author = row[authorIdx];

    const titleValid = typeof title === 'string' && title.trim().length > 0;
    const uidValid = typeof songUid === 'string' && songUid.length > 0;
    if (!titleValid || !uidValid) {
      const label = titleValid ? `"${title}"` : `row ${rowid}`;
      const problems = [];
      if (!titleValid) problems.push('missing/invalid title');
      if (!uidValid) problems.push('missing/invalid song_uid');
      invalidRows.push(`${label} (row ${rowid}): ${problems.join(', ')}`);
      continue;
    }

    const raw = wordsByRowId.get(rowid);
    const rtf = typeof raw === 'string' ? raw : raw ? new TextDecoder('utf-8').decode(raw) : '';
    const lyrics = rtf ? rtfToPlainText(rtf) : '';
    if (!lyrics.trim()) {
      failures.push(`${title} (song_uid ${songUid})`);
      continue;
    }

    songs.push({ id: songUid, title, author: author ?? '', lyrics });
  }

  if (invalidRows.length > 0) {
    return {
      error: `Import failed: ${invalidRows.length} row(s) have a missing or invalid title/song_uid`,
      details: invalidRows,
    };
  }
  if (failures.length > 0) {
    return {
      error: `Import failed: ${failures.length} song(s) produced empty lyrics`,
      details: failures,
    };
  }

  return { songs: assignSlugs(songs) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/lib/sqlite-parse.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS, 61 tests (56 existing + 5 new).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/sqlite-parse.js src/lib/sqlite-parse.test.js
git commit -m "feat: add server-side SQLite database parsing/validation"
```

---

### Task 3: `src/lib/r2-backup.js` — backup key naming and listing helpers

**Files:**
- Create: `src/lib/r2-backup.js`
- Test: `src/lib/r2-backup.test.js`

**Interfaces:**
- Produces: `formatBackupTimestamp(date?: Date): string`, `backupPrefix(timestamp: string): string`, `backupTimestampsFromListing(objectKeys: string[]): string[]` (sorted newest-first), `formatBackupLabel(timestamp: string): string`. Consumed by Task 6's `admin-db.js`, Task 7's restore route, and Task 8's dashboard page.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/r2-backup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBackupTimestamp, backupPrefix, backupTimestampsFromListing, formatBackupLabel } from './r2-backup.js';

test('formatBackupTimestamp formats a fixed date as YYYY-MM-DDTHH-mm-ss', () => {
  const date = new Date('2026-09-29T20:30:05.123Z');
  assert.equal(formatBackupTimestamp(date), '2026-09-29T20-30-05');
});

test('backupPrefix builds the backups/<timestamp>/ key prefix', () => {
  assert.equal(backupPrefix('2026-09-29T20-30-05'), 'backups/2026-09-29T20-30-05/');
});

test('backupTimestampsFromListing extracts and dedupes timestamps, sorted newest first', () => {
  const keys = [
    'backups/2026-09-01T10-00-00/Songs.db',
    'backups/2026-09-01T10-00-00/SongWords.db',
    'backups/2026-09-15T08-00-00/Songs.db',
    'backups/2026-09-15T08-00-00/SongWords.db',
    'current/Songs.db',
    'current/meta.json',
  ];
  assert.deepEqual(backupTimestampsFromListing(keys), ['2026-09-15T08-00-00', '2026-09-01T10-00-00']);
});

test('backupTimestampsFromListing returns an empty array when there are no backups', () => {
  assert.deepEqual(backupTimestampsFromListing(['current/Songs.db']), []);
});

test('formatBackupLabel turns a timestamp into a human-readable "date time" string', () => {
  assert.equal(formatBackupLabel('2026-09-29T20-30-05'), '2026-09-29 20:30:05');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/r2-backup.test.js`
Expected: FAIL with "Cannot find module './r2-backup.js'".

- [ ] **Step 3: Implement `src/lib/r2-backup.js`**

```js
// src/lib/r2-backup.js
export function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/:/g, '-');
}

export function backupPrefix(timestamp) {
  return `backups/${timestamp}/`;
}

export function backupTimestampsFromListing(objectKeys) {
  const timestamps = new Set();
  for (const key of objectKeys) {
    const match = key.match(/^backups\/([^/]+)\//);
    if (match) timestamps.add(match[1]);
  }
  return [...timestamps].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function formatBackupLabel(timestamp) {
  const [datePart, timePart] = timestamp.split('T');
  return `${datePart} ${timePart.replace(/-/g, ':')}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/r2-backup.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 66 tests (61 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/r2-backup.js src/lib/r2-backup.test.js
git commit -m "feat: add R2 backup key naming and listing helpers"
```

---

### Task 4: `src/lib/admin-auth.js` — session tokens, cookies, rate limiting

**Files:**
- Create: `src/lib/admin-auth.js`
- Test: `src/lib/admin-auth.test.js`

**Interfaces:**
- Produces: `SESSION_COOKIE_NAME`, `SESSION_DURATION_MS`, `signSessionToken(secret, expiresAt?): Promise<string>`, `verifySessionToken(secret, token): Promise<boolean>`, `buildSessionCookie(token): string`, `buildLogoutCookie(): string`, `readSessionCookie(cookieHeader: string|null|undefined): string|null`, `requireAdminSession(request, env): Promise<boolean>`, `getClientIp(request): string`, `checkLoginRateLimit(kv, ip): Promise<boolean>`, `recordFailedLogin(kv, ip): Promise<void>`, `clearLoginRateLimit(kv, ip): Promise<void>`. Consumed by Task 5's login/logout routes, Task 6/7's upload/restore routes (`requireAdminSession`), Task 8's dashboard page (`requireAdminSession`).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/admin-auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signSessionToken,
  verifySessionToken,
  buildSessionCookie,
  buildLogoutCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  getClientIp,
} from './admin-auth.js';

const SECRET = 'test-secret-value';

test('signSessionToken produces a token that verifySessionToken accepts', async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60000);
  assert.equal(await verifySessionToken(SECRET, token), true);
});

test('verifySessionToken rejects a tampered signature', async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60000);
  const [payload] = token.split('.');
  assert.equal(await verifySessionToken(SECRET, `${payload}.not-a-real-signature`), false);
});

test('verifySessionToken rejects a tampered payload', async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60000);
  const [, signature] = token.split('.');
  assert.equal(await verifySessionToken(SECRET, `dGFtcGVyZWQ.${signature}`), false);
});

test('verifySessionToken rejects an expired token', async () => {
  const token = await signSessionToken(SECRET, Date.now() - 1000);
  assert.equal(await verifySessionToken(SECRET, token), false);
});

test('verifySessionToken rejects garbage input', async () => {
  assert.equal(await verifySessionToken(SECRET, 'not-a-token'), false);
  assert.equal(await verifySessionToken(SECRET, ''), false);
});

test('buildSessionCookie and readSessionCookie round-trip the token', () => {
  const cookieHeader = buildSessionCookie('abc.def');
  const nameValue = cookieHeader.split(';')[0];
  assert.equal(nameValue, `${SESSION_COOKIE_NAME}=abc.def`);
  assert.equal(readSessionCookie(nameValue), 'abc.def');
});

test('readSessionCookie finds the session cookie among other cookies', () => {
  assert.equal(readSessionCookie(`foo=bar; ${SESSION_COOKIE_NAME}=xyz; baz=qux`), 'xyz');
});

test('readSessionCookie returns null when the cookie is missing', () => {
  assert.equal(readSessionCookie('foo=bar'), null);
  assert.equal(readSessionCookie(undefined), null);
});

test('buildLogoutCookie sets Max-Age=0', () => {
  assert.match(buildLogoutCookie(), /Max-Age=0/);
});

test('getClientIp reads CF-Connecting-IP and falls back to "unknown"', () => {
  const withIp = new Request('https://example.com', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
  assert.equal(getClientIp(withIp), '1.2.3.4');
  const withoutIp = new Request('https://example.com');
  assert.equal(getClientIp(withoutIp), 'unknown');
});

function fakeKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

test('checkLoginRateLimit allows attempts under the limit and blocks at 10', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) {
    assert.equal(await checkLoginRateLimit(kv, '1.2.3.4'), true);
    await recordFailedLogin(kv, '1.2.3.4');
  }
  assert.equal(await checkLoginRateLimit(kv, '1.2.3.4'), false);
});

test('clearLoginRateLimit resets the counter', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) await recordFailedLogin(kv, '5.6.7.8');
  assert.equal(await checkLoginRateLimit(kv, '5.6.7.8'), false);
  await clearLoginRateLimit(kv, '5.6.7.8');
  assert.equal(await checkLoginRateLimit(kv, '5.6.7.8'), true);
});

test('rate limit is tracked per IP independently', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) await recordFailedLogin(kv, '1.1.1.1');
  assert.equal(await checkLoginRateLimit(kv, '1.1.1.1'), false);
  assert.equal(await checkLoginRateLimit(kv, '2.2.2.2'), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/admin-auth.test.js`
Expected: FAIL with "Cannot find module './admin-auth.js'".

- [ ] **Step 3: Implement `src/lib/admin-auth.js`**

```js
// src/lib/admin-auth.js
const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToBytes(str) {
  const pad = (4 - (str.length % 4)) % 4;
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export const SESSION_COOKIE_NAME = 'admin_session';
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export async function signSessionToken(secret, expiresAt = Date.now() + SESSION_DURATION_MS) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ exp: expiresAt })));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const key = await hmacKey(secret);
  let valid;
  try {
    valid = await crypto.subtle.verify('HMAC', key, base64UrlDecodeToBytes(signature), encoder.encode(payload));
  } catch {
    return false;
  }
  if (!valid) return false;

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(payload)));
  } catch {
    return false;
  }
  return typeof parsed.exp === 'number' && parsed.exp > Date.now();
}

export function buildSessionCookie(token) {
  const maxAgeSeconds = Math.floor(SESSION_DURATION_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function buildLogoutCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

export async function requireAdminSession(request, env) {
  const token = readSessionCookie(request.headers.get('Cookie'));
  if (!token) return false;
  return verifySessionToken(env.ADMIN_SESSION_SECRET, token);
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

function rateLimitKey(ip) {
  return `login-attempts:${ip}`;
}

export async function checkLoginRateLimit(kv, ip) {
  const raw = await kv.get(rateLimitKey(ip));
  const count = raw ? parseInt(raw, 10) : 0;
  return count < RATE_LIMIT_MAX_ATTEMPTS;
}

export async function recordFailedLogin(kv, ip) {
  const raw = await kv.get(rateLimitKey(ip));
  const count = raw ? parseInt(raw, 10) : 0;
  await kv.put(rateLimitKey(ip), String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
}

export async function clearLoginRateLimit(kv, ip) {
  await kv.delete(rateLimitKey(ip));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/admin-auth.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 79 tests (66 + 13 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin-auth.js src/lib/admin-auth.test.js
git commit -m "feat: add admin session tokens, cookies, and login rate limiting"
```

---

### Task 5: Login/logout API routes and the `/admin/login` page

**Files:**
- Create: `src/pages/api/admin/login.js`
- Create: `src/pages/api/admin/logout.js`
- Create: `src/pages/admin/login.astro`

**Interfaces:**
- Consumes: `signSessionToken`, `buildSessionCookie`, `buildLogoutCookie`, `checkLoginRateLimit`, `recordFailedLogin`, `clearLoginRateLimit`, `getClientIp` from `src/lib/admin-auth.js` (Task 4); `jsonResponse` from `src/lib/setlist.js` (existing).
- Produces: `POST /api/admin/login` (body `{ password }`, sets the session cookie on success), `POST /api/admin/logout` (clears the cookie). No route-level unit tests — this codebase has none for its existing API routes either (only the pure `lib/` functions are tested); this route is exercised in Task 12's manual verification.

- [ ] **Step 1: Implement `src/pages/api/admin/login.js`**

```js
// src/pages/api/admin/login.js
import {
  signSessionToken,
  buildSessionCookie,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  getClientIp,
} from '../../../lib/admin-auth.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  const ip = getClientIp(request);

  const allowed = await checkLoginRateLimit(env.ADMIN_RATE_LIMIT, ip);
  if (!allowed) {
    return jsonResponse({ error: 'Too many attempts, try again later' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (body.password !== env.ADMIN_PASSWORD) {
    await recordFailedLogin(env.ADMIN_RATE_LIMIT, ip);
    return jsonResponse({ error: 'Incorrect password' }, 401);
  }

  await clearLoginRateLimit(env.ADMIN_RATE_LIMIT, ip);
  const token = await signSessionToken(env.ADMIN_SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': buildSessionCookie(token),
    },
  });
}
```

- [ ] **Step 2: Implement `src/pages/api/admin/logout.js`**

```js
// src/pages/api/admin/logout.js
import { buildLogoutCookie } from '../../../lib/admin-auth.js';

export const prerender = false;

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': buildLogoutCookie(),
    },
  });
}
```

- [ ] **Step 3: Implement `src/pages/admin/login.astro`**

```astro
---
import Layout from '../../layouts/Layout.astro';

export const prerender = false;
---
<Layout title="Admin Login — Song Search">
  <div class="page">
    <h1>Admin Login</h1>
    <form id="login-form">
      <input type="password" id="password" placeholder="Password" autofocus required />
      <button type="submit">Log in</button>
    </form>
    <p id="status"></p>
  </div>

  <style>
    .page { max-width: 420px; margin: 60px auto 0; }
    #login-form { display: flex; gap: 10px; }
    #password {
      flex: 1;
      padding: 12px 14px;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      background: var(--color-card);
      color: var(--color-card-foreground);
    }
    button {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border: none;
      border-radius: 12px;
      padding: 12px 20px;
      cursor: pointer;
    }
    #status { color: var(--color-muted-foreground); margin-top: 12px; white-space: pre-line; }
  </style>

  <script>
    const form = document.getElementById('login-form');
    const status = document.getElementById('status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      status.textContent = 'Logging in…';
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          status.textContent = data.error || 'Login failed';
          return;
        }
        window.location.href = '/admin/';
      } catch {
        status.textContent = 'Could not reach the server. Check your connection and try again.';
      }
    });
  </script>
</Layout>
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 79 tests (no new automated tests this task — see Interfaces note).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/admin/login.js src/pages/api/admin/logout.js src/pages/admin/login.astro
git commit -m "feat: add admin login/logout routes and login page"
```

---

### Task 6: `sql.js` Worker bootstrap, shared commit logic, and the upload route

**Files:**
- Create: `src/lib/sqlite-worker-init.js`
- Create: `src/lib/admin-db.js`
- Create: `src/pages/api/admin/upload.js`
- Modify: `astro.config.mjs`

**Interfaces:**
- Consumes: `isSqliteFile`, `parseSongDatabases` from `src/lib/sqlite-parse.js` (Task 2); `formatBackupTimestamp`, `backupPrefix` from `src/lib/r2-backup.js` (Task 3); `requireAdminSession` from `src/lib/admin-auth.js` (Task 4); `jsonResponse` from `src/lib/setlist.js`; `findDuplicateGroups` from `src/lib/duplicate-groups.js` (existing, unchanged).
- Produces: `getSqlJs(): Promise<SqlJsStatic>` (`sqlite-worker-init.js`); `commitDatabasePair({ r2, kv, songsDbBytes, wordsDbBytes }): Promise<{songCount, duplicateGroups} | {error, details}>` (`admin-db.js`) — consumed by Task 7's restore route; `POST /api/admin/upload`.

This task has no automated test of its own — `sqlite-worker-init.js`'s WASM
loading can only run in a real Workers-like environment (Node can't load a
Cloudflare-module-style `.wasm` import), and `commitDatabasePair` needs live
R2/KV bindings. Both are exercised by the manual verification in Step 4
below and again in Task 12's full end-to-end pass. This is the same
"integration point verified live, not via `node --test`" pattern already
used for `src/pages/api/setlists/*.js` in this codebase.

- [ ] **Step 1: Enable Cloudflare module imports**

Edit `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    cloudflareModules: true,
  }),
});
```

- [ ] **Step 2: Implement `src/lib/sqlite-worker-init.js`**

```js
// src/lib/sqlite-worker-init.js
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { href: 'https://worker.local/' };
}

import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmModule from 'sql.js/dist/sql-wasm-browser.wasm';

let sqlPromise;

export function getSqlJs() {
  sqlPromise ??= initSqlJs({
    instantiateWasm(imports, successCallback) {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => {
        successCallback(instance, wasmModule);
      });
      return {};
    },
  });
  return sqlPromise;
}
```

The `globalThis.location` polyfill exists because `sql.js`'s browser build
detects `globalThis.WorkerGlobalScope` (which Cloudflare Workers defines)
and, when found, unconditionally reads `self.location.href` — which
crashes with `Cannot read properties of undefined (reading 'href')` in the
Workers runtime, since Workers don't provide a `location` global. This was
confirmed against a real `wrangler dev` run before this plan was written;
without the polyfill, every call to `getSqlJs()` throws immediately.

- [ ] **Step 3: Implement `src/lib/admin-db.js`**

```js
// src/lib/admin-db.js
import { getSqlJs } from './sqlite-worker-init.js';
import { isSqliteFile, parseSongDatabases } from './sqlite-parse.js';
import { formatBackupTimestamp, backupPrefix } from './r2-backup.js';
import { findDuplicateGroups } from './duplicate-groups.js';

export async function commitDatabasePair({ r2, kv, songsDbBytes, wordsDbBytes }) {
  if (!isSqliteFile(songsDbBytes)) {
    return { error: 'Songs.db is not a valid SQLite database file', details: [] };
  }
  if (!isSqliteFile(wordsDbBytes)) {
    return { error: 'SongWords.db is not a valid SQLite database file', details: [] };
  }

  const SQL = await getSqlJs();
  const result = parseSongDatabases(SQL, songsDbBytes, wordsDbBytes);
  if (result.error) {
    return result;
  }

  const currentSongs = await r2.get('current/Songs.db');
  if (currentSongs) {
    const timestamp = formatBackupTimestamp();
    const prefix = backupPrefix(timestamp);
    const currentWords = await r2.get('current/SongWords.db');
    await r2.put(`${prefix}Songs.db`, await currentSongs.arrayBuffer());
    if (currentWords) {
      await r2.put(`${prefix}SongWords.db`, await currentWords.arrayBuffer());
    }
  }

  await r2.put('current/Songs.db', songsDbBytes);
  await r2.put('current/SongWords.db', wordsDbBytes);
  const meta = { uploadedAt: new Date().toISOString(), songCount: result.songs.length };
  await r2.put('current/meta.json', JSON.stringify(meta));
  await kv.put('songs', JSON.stringify(result.songs));

  const duplicateGroups = findDuplicateGroups(result.songs).length;
  return { songCount: result.songs.length, duplicateGroups };
}
```

- [ ] **Step 4: Implement `src/pages/api/admin/upload.js`**

```js
// src/pages/api/admin/upload.js
import { requireAdminSession } from '../../../lib/admin-auth.js';
import { commitDatabasePair } from '../../../lib/admin-db.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid form data' }, 400);
  }

  const songsFile = form.get('songsDb');
  const wordsFile = form.get('wordsDb');
  if (!(songsFile instanceof File) || !(wordsFile instanceof File)) {
    return jsonResponse({ error: 'Both songsDb and wordsDb files are required' }, 400);
  }

  const songsDbBytes = new Uint8Array(await songsFile.arrayBuffer());
  const wordsDbBytes = new Uint8Array(await wordsFile.arrayBuffer());

  const result = await commitDatabasePair({
    r2: env.SONG_DB_FILES,
    kv: env.SONGS_DATA,
    songsDbBytes,
    wordsDbBytes,
  });

  if (result.error) {
    return jsonResponse({ error: result.error, details: result.details ?? [] }, 400);
  }
  return jsonResponse({ songCount: result.songCount, duplicateGroups: result.duplicateGroups });
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 79 tests (unchanged — this task's new code is integration-only, see Interfaces note).

- [ ] **Step 6: Manually verify the upload path against `wrangler dev`**

This is this task's actual test cycle. Build and run against a real Worker:

```bash
npm run import && npm run build
npx wrangler dev --port 8793
```

In another terminal, log in and upload the repo's own sample files (after
Task 1's secrets are set):

```bash
curl -s -c /tmp/cookies.txt -X POST http://localhost:8793/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"<your ADMIN_PASSWORD>"}'
curl -s -b /tmp/cookies.txt -X POST http://localhost:8793/api/admin/upload \
  -F songsDb=@data/Songs.db -F wordsDb=@data/SongWords.db
```

Expected: the login call sets a cookie and returns `{"ok":true}`; the
upload call returns `{"songCount": <N>, "duplicateGroups": <M>}` matching
`npm run import`'s reported song count. Stop `wrangler dev` afterward.

- [ ] **Step 7: Commit**

```bash
git add astro.config.mjs src/lib/sqlite-worker-init.js src/lib/admin-db.js src/pages/api/admin/upload.js
git commit -m "feat: add sql.js Worker bootstrap and the database upload route"
```

---

### Task 7: Restore API route

**Files:**
- Create: `src/pages/api/admin/restore.js`

**Interfaces:**
- Consumes: `requireAdminSession` from `src/lib/admin-auth.js`; `commitDatabasePair` from `src/lib/admin-db.js` (Task 6); `backupPrefix` from `src/lib/r2-backup.js`; `jsonResponse` from `src/lib/setlist.js`.
- Produces: `POST /api/admin/restore` (body `{ timestamp }`).

- [ ] **Step 1: Implement `src/pages/api/admin/restore.js`**

```js
// src/pages/api/admin/restore.js
import { requireAdminSession } from '../../../lib/admin-auth.js';
import { commitDatabasePair } from '../../../lib/admin-db.js';
import { backupPrefix } from '../../../lib/r2-backup.js';
import { jsonResponse } from '../../../lib/setlist.js';

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals.runtime.env;
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.timestamp !== 'string' || body.timestamp.length === 0) {
    return jsonResponse({ error: 'A backup timestamp is required' }, 400);
  }

  const prefix = backupPrefix(body.timestamp);
  const songsObj = await env.SONG_DB_FILES.get(`${prefix}Songs.db`);
  const wordsObj = await env.SONG_DB_FILES.get(`${prefix}SongWords.db`);
  if (!songsObj || !wordsObj) {
    return jsonResponse({ error: 'Backup not found' }, 404);
  }

  const result = await commitDatabasePair({
    r2: env.SONG_DB_FILES,
    kv: env.SONGS_DATA,
    songsDbBytes: new Uint8Array(await songsObj.arrayBuffer()),
    wordsDbBytes: new Uint8Array(await wordsObj.arrayBuffer()),
  });

  if (result.error) {
    return jsonResponse({ error: result.error, details: result.details ?? [] }, 400);
  }
  return jsonResponse({ songCount: result.songCount, duplicateGroups: result.duplicateGroups });
}
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS, 79 tests.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/admin/restore.js
git commit -m "feat: add database restore-from-backup route"
```

---

### Task 8: `/admin/` dashboard page

**Files:**
- Create: `src/pages/admin/index.astro`

**Interfaces:**
- Consumes: `requireAdminSession` from `src/lib/admin-auth.js`; `backupTimestampsFromListing`, `formatBackupLabel` from `src/lib/r2-backup.js`.

- [ ] **Step 1: Implement `src/pages/admin/index.astro`**

```astro
---
import Layout from '../../layouts/Layout.astro';
import { requireAdminSession } from '../../lib/admin-auth.js';
import { backupTimestampsFromListing, formatBackupLabel } from '../../lib/r2-backup.js';

export const prerender = false;

const env = Astro.locals.runtime.env;
const authed = await requireAdminSession(Astro.request, env);
if (!authed) {
  return Astro.redirect('/admin/login');
}

const metaObj = await env.SONG_DB_FILES.get('current/meta.json');
const meta = metaObj ? JSON.parse(await metaObj.text()) : null;

const listing = await env.SONG_DB_FILES.list({ prefix: 'backups/' });
const backups = backupTimestampsFromListing(listing.objects.map((o) => o.key))
  .map((timestamp) => ({ timestamp, label: formatBackupLabel(timestamp) }));
---
<Layout title="Admin — Song Search">
  <div class="page">
    <p><a href="/">← Back to search</a></p>
    <h1>Admin</h1>

    <section class="status-box">
      {meta ? (
        <p>{meta.songCount} songs live. Last updated {new Date(meta.uploadedAt).toLocaleString()}.</p>
      ) : (
        <p>No database uploaded yet.</p>
      )}
    </section>

    <section>
      <h2>Upload new database</h2>
      <form id="upload-form">
        <label>Songs.db <input type="file" id="songs-file" accept=".db" required /></label>
        <label>SongWords.db <input type="file" id="words-file" accept=".db" required /></label>
        <button type="submit">Upload</button>
      </form>
      <p id="upload-status"></p>
    </section>

    <section>
      <h2>Backup history</h2>
      {backups.length === 0 ? (
        <p class="status">No backups yet.</p>
      ) : (
        <ul id="backup-list">
          {backups.map(({ timestamp, label }) => (
            <li>
              <span>{label}</span>
              <button type="button" class="restore-btn" data-timestamp={timestamp}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </section>

    <button id="logout-btn" type="button">Log out</button>
  </div>

  <style>
    .page { max-width: 680px; margin: 0 auto; }
    section { margin-bottom: 32px; }
    .status-box {
      padding: 16px 20px;
      background: var(--color-card);
      border: 1px solid var(--color-border);
      border-radius: 14px;
    }
    #upload-form { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
    #upload-status { white-space: pre-line; color: var(--color-muted-foreground); }
    #backup-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    #backup-list li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: var(--color-card);
      border: 1px solid var(--color-border);
      border-radius: 10px;
    }
    button {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border: none;
      border-radius: 10px;
      padding: 8px 16px;
      cursor: pointer;
    }
    #logout-btn {
      background: var(--color-card);
      color: var(--color-card-foreground);
      border: 1px solid var(--color-border);
    }
  </style>

  <script>
    const uploadForm = document.getElementById('upload-form');
    const uploadStatus = document.getElementById('upload-status');

    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const songsFile = document.getElementById('songs-file').files[0];
      const wordsFile = document.getElementById('words-file').files[0];
      const formData = new FormData();
      formData.append('songsDb', songsFile);
      formData.append('wordsDb', wordsFile);
      uploadStatus.textContent = 'Uploading…';
      try {
        const res = await fetch('/api/admin/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
          const details = Array.isArray(data.details) && data.details.length > 0
            ? '\n' + data.details.map((d) => `- ${d}`).join('\n')
            : '';
          uploadStatus.textContent = `${data.error}${details}`;
          return;
        }
        uploadStatus.textContent = `Imported ${data.songCount} songs. ${data.duplicateGroups} possible duplicate group(s) — check /duplicates/.`;
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        uploadStatus.textContent = 'Could not reach the server. Check your connection and try again.';
      }
    });

    document.querySelectorAll('.restore-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const timestamp = btn.dataset.timestamp;
        if (!window.confirm(`Replace the live database with the backup from ${timestamp}?`)) return;
        uploadStatus.textContent = 'Restoring…';
        try {
          const res = await fetch('/api/admin/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp }),
          });
          const data = await res.json();
          if (!res.ok) {
            uploadStatus.textContent = data.error;
            return;
          }
          uploadStatus.textContent = `Restored. ${data.songCount} songs live.`;
          setTimeout(() => window.location.reload(), 1500);
        } catch {
          uploadStatus.textContent = 'Could not reach the server. Check your connection and try again.';
        }
      });
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST' });
      window.location.href = '/admin/login';
    });
  </script>
</Layout>
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS, 79 tests.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "feat: add admin dashboard with upload form and backup history"
```

---

### Task 9: Convert `index.astro`, `duplicates.astro`, and `song/[slug].astro` to runtime KV reads

**Files:**
- Create: `src/lib/songs-data.js`
- Test: `src/lib/songs-data.test.js`
- Modify: `src/pages/index.astro:1-7`
- Modify: `src/pages/duplicates.astro:1-9`
- Modify: `src/pages/song/[slug].astro` (frontmatter and template)
- Modify: `wrangler.jsonc` (`run_worker_first`)

**Interfaces:**
- Produces: `loadSongs(kv): Promise<Array<{id, title, author, lyrics, slug}>>` — consumed by all three pages.

This is the task that makes admin uploads go live without a redeploy: these
three pages stop reading the build-time `src/data/songs.json` bundle and
start reading the `SONGS_DATA` KV key on every request, which means they
must switch from `prerender = true` (static HTML generated at build time)
to `prerender = false` (rendered per-request, same as `src/pages/set/[id].astro`
already is).

- [ ] **Step 1: Write the failing test for `songs-data.js`**

```js
// src/lib/songs-data.test.js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/songs-data.test.js`
Expected: FAIL with "Cannot find module './songs-data.js'".

- [ ] **Step 3: Implement `src/lib/songs-data.js`**

```js
// src/lib/songs-data.js
export async function loadSongs(kv) {
  const raw = await kv.get('songs');
  if (raw === null) return [];
  return JSON.parse(raw);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/songs-data.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Convert `src/pages/index.astro`**

Replace lines 1-7 (current content, verify against the live file before
editing since it may have shifted):

```astro
---
import Layout from '../layouts/Layout.astro';
import songs from '../data/songs.json';

export const prerender = true;

const songsJson = JSON.stringify(songs).replace(/</g, '\\u003c');
---
```

with:

```astro
---
import Layout from '../layouts/Layout.astro';
import { loadSongs } from '../lib/songs-data.js';

export const prerender = false;

const songs = await loadSongs(Astro.locals.runtime.env.SONGS_DATA);
const songsJson = JSON.stringify(songs).replace(/</g, '\\u003c');
---
```

Nothing else in this file references `songs` outside this frontmatter
block (the template only uses `songsJson` via the `#songs-data` script
island), so no further edits are needed in this file.

- [ ] **Step 6: Convert `src/pages/duplicates.astro`**

Replace lines 1-9:

```astro
---
import Layout from '../layouts/Layout.astro';
import songs from '../data/songs.json';
import { findDuplicateGroups } from '../lib/duplicate-groups.js';

export const prerender = true;

const duplicateGroups = findDuplicateGroups(songs);
const totalDuplicateSongs = duplicateGroups.reduce((sum, group) => sum + group.length, 0);
---
```

with:

```astro
---
import Layout from '../layouts/Layout.astro';
import { loadSongs } from '../lib/songs-data.js';
import { findDuplicateGroups } from '../lib/duplicate-groups.js';

export const prerender = false;

const songs = await loadSongs(Astro.locals.runtime.env.SONGS_DATA);
const duplicateGroups = findDuplicateGroups(songs);
const totalDuplicateSongs = duplicateGroups.reduce((sum, group) => sum + group.length, 0);
---
```

- [ ] **Step 7: Convert `src/pages/song/[slug].astro`**

This file currently uses `getStaticPaths()` (static-only API, incompatible
with `prerender = false`) and assumes `song` always exists. Replace its
frontmatter (lines 1-23) with:

```astro
---
import Layout from '../../layouts/Layout.astro';
import { loadSongs } from '../../lib/songs-data.js';

export const prerender = false;

const songs = await loadSongs(Astro.locals.runtime.env.SONGS_DATA);
const song = songs.find((s) => s.slug === Astro.params.slug);

const LABEL_RE = /^\[?(verse|chorus|bridge|pre-?chorus|tag|ending|outro|intro|refrain|interlude)\s*\d*\]?:?$/i;

const stanzas = song
  ? song.lyrics.split(/\n\s*\n/).map((stanza) => stanza.split('\n').filter((line) => line.trim()))
  : [];

const firstLine = song ? stanzas.flat().find((line) => !LABEL_RE.test(line.trim())) ?? song.title : '';
const description = song
  ? (firstLine.length > 140 ? `${firstLine.slice(0, 140)}…` : firstLine)
  : undefined;
---
```

Then wrap the existing template (everything from `<Layout title={...}>` to
the closing `</Layout>`, i.e. the current lines 25-195) in a not-found
branch — replace the opening tag line:

```astro
<Layout title={`${song.title} — Song Search`} description={description}>
```

with:

```astro
{!song ? (
  <Layout title="Song not found">
    <h1>Song not found</h1>
    <p>We couldn't find that song.</p>
    <p><a href="/">← Back to search</a></p>
  </Layout>
) : (
<Layout title={`${song.title} — Song Search`} description={description}>
```

and add one closing `)}` after the existing final `</Layout>` line. The
rest of the template (lyrics rendering, buttons, both `<script>` blocks)
is unchanged — it only runs in the `song` branch, where `song` is
guaranteed defined.

- [ ] **Step 8: Update `wrangler.jsonc`'s `run_worker_first`**

All real pages are now server-rendered (only `404.astro` stays static).
Change:

```jsonc
    "run_worker_first": ["/set/*", "/api/*"]
```

to:

```jsonc
    "run_worker_first": ["/*"]
```

This deliberately avoids re-introducing the asset-routing precedence bug
this project already hit once (`Sec-Fetch-Mode: navigate` bypassing
`run_worker_first` for a path not in the allowlist) — rather than
enumerating every new dynamic path (`/`, `/song/*`, `/duplicates/*`,
`/admin/*`), routing everything through the Worker first removes the
allowlist-drift risk entirely. `@astrojs/cloudflare`'s generated Worker
entry already falls back to the `ASSETS` binding for any request Astro
has no route for (e.g. `/logo.png`), which is exactly how `/set/*` and
`/api/*` already work today.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, 81 tests (79 + 2 new).

- [ ] **Step 10: Manually verify against `wrangler dev`**

```bash
npx wrangler kv key put --binding=SONGS_DATA --local songs --path=src/data/songs.json
npm run build
npx wrangler dev --port 8793
```

Visit `http://localhost:8793/`, `http://localhost:8793/song/<a-real-slug>/`,
and `http://localhost:8793/duplicates/` — all three should render with the
seeded song data. Visit `http://localhost:8793/song/not-a-real-slug/` and
confirm the "Song not found" message appears instead of a crash. Visit
`http://localhost:8793/logo.png` and confirm the image still loads (proves
the `run_worker_first: ["/*"]` change didn't break static asset serving).
Stop `wrangler dev` afterward.

- [ ] **Step 11: Commit**

```bash
git add src/lib/songs-data.js src/lib/songs-data.test.js src/pages/index.astro src/pages/duplicates.astro "src/pages/song/[slug].astro" wrangler.jsonc
git commit -m "feat: serve song data from KV at request time instead of build-time bundling"
```

---

### Task 10: Local dev seeding

**Files:**
- Modify: `package.json` (add `seed-local-kv` script)
- Modify: `README.md` ("Develop" section)

**Interfaces:**
- Consumes: `src/data/songs.json` (produced by the existing `npm run import`), the local `SONGS_DATA` KV namespace (Wrangler's local emulation, no production access).

- [ ] **Step 1: Add the `seed-local-kv` script to `package.json`**

Add to the `"scripts"` object (after `"import"`):

```json
    "seed-local-kv": "wrangler kv key put --binding=SONGS_DATA --local songs --path=src/data/songs.json",
```

- [ ] **Step 2: Update `README.md`'s "Develop" section**

Replace:

```markdown
## Develop

    npm install
    npm run import   # data/Songs.db + data/SongWords.db -> src/data/songs.json
    npm run dev
```

with:

```markdown
## Develop

    npm install
    npm run import         # data/Songs.db + data/SongWords.db -> src/data/songs.json
    npm run seed-local-kv  # loads src/data/songs.json into local KV, so `dev` has data to read
    npm run dev
```

- [ ] **Step 3: Verify the script works**

```bash
npm run import
npm run seed-local-kv
```

Expected: the second command prints a success message from `wrangler kv key put` and exits 0.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 81 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md
git commit -m "docs: add local KV seeding step to the dev workflow"
```

---

### Task 11: Documentation — rewrite the update-songs guide and README sections

**Files:**
- Modify: `HOW-TO-UPDATE-SONGS.md` (full rewrite)
- Modify: `README.md` ("Update the song database" and "Deployment" sections)

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Rewrite `HOW-TO-UPDATE-SONGS.md`**

```markdown
# How to update the songs on the website

No technical knowledge needed — just two files, a password, and a few clicks.

## What you'll need

- The two files from ProPresenter: **Songs.db** and **SongWords.db**
- The admin panel password (ask for it if you don't have it)

## Steps

1. **Export from ProPresenter** — export the updated `Songs.db` and
   `SongWords.db` files.

2. **Open the admin panel**: go to
   [song-search-site.uzosaugwu0.workers.dev/admin/](https://song-search-site.uzosaugwu0.workers.dev/admin/)
   and log in with the admin password.

3. **Upload both files** using the "Upload new database" form — choose
   `Songs.db` and `SongWords.db` in their matching fields, then click
   **Upload**.

That's it. The site updates itself immediately — no waiting, and nothing
else to do. The page will show you how many songs were imported.

## Checking for duplicate songs

After an update, you can visit `/duplicates/` on the website (for example,
`https://song-search-site.uzosaugwu0.workers.dev/duplicates/`) to see a list
of songs that might be the same song entered twice, so you know what to
clean up in ProPresenter next time. The admin panel also shows a duplicate
count right after you upload.

## If something looks wrong afterward

If the upload shows an error message, it'll tell you exactly which song
has a problem (most often: a song with no lyrics, or a missing title) —
fix that song in ProPresenter and re-export.

If you uploaded the wrong file, or something looks wrong on the live site
even though the upload succeeded, open the admin panel's "Backup history"
list and click **Restore** next to the last known-good upload — this
reverts the site to that database immediately.
```

- [ ] **Step 2: Update `README.md`'s "Update the song database" section**

Replace:

```markdown
## Update the song database

Replace `data/Songs.db` and `data/SongWords.db` with fresh ProPresenter
exports, commit, and push, then deploy manually — see
[Deployment](#deployment) below.

For a non-technical, no-git-required version of this (drag-and-drop via
GitHub's web UI), see [`HOW-TO-UPDATE-SONGS.md`](HOW-TO-UPDATE-SONGS.md).

After updating, check `/duplicates/` on the live site for a report of songs
that may be duplicates (same title once case/punctuation/spacing are
ignored) — it's not linked from the home page, so visit it directly.
```

with:

```markdown
## Update the song database

The song database is updated through the admin panel at `/admin/` — log in
with the shared admin password, upload `Songs.db` and `SongWords.db`, and
the site updates immediately, no redeploy needed. See
[`HOW-TO-UPDATE-SONGS.md`](HOW-TO-UPDATE-SONGS.md) for the non-technical
version of these steps.

The two files in `data/` and `npm run import` remain useful for local
development (see [Develop](#develop) above) but are no longer how
production data gets updated.

After updating, check `/duplicates/` on the live site for a report of songs
that may be duplicates (same title once case/punctuation/spacing are
ignored) — it's not linked from the home page, so visit it directly. The
admin panel also shows a duplicate-group count right after each upload.
```

- [ ] **Step 3: Add an "Admin panel setup" section to `README.md`**

Add this new section directly before the existing "## Deployment" heading:

```markdown
## Admin panel setup

The admin panel needs three Cloudflare resources beyond the ones this repo
already uses (see [Deployment](#deployment) for the base setup):

- Two KV namespaces, bound as `SONGS_DATA` and `ADMIN_RATE_LIMIT`
- One R2 bucket, bound as `SONG_DB_FILES`
- Two Worker secrets, `ADMIN_PASSWORD` (the shared dev-team login) and
  `ADMIN_SESSION_SECRET` (a long random string used to sign session
  cookies — not something anyone types in day-to-day)

These are one-time setup steps, already run for this project's Cloudflare
account. To rotate the admin password, run `npx wrangler secret put
ADMIN_PASSWORD` and enter a new value.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 81 tests (documentation-only task, no test changes).

- [ ] **Step 5: Commit**

```bash
git add HOW-TO-UPDATE-SONGS.md README.md
git commit -m "docs: rewrite database-update instructions for the admin panel"
```

---

### Task 12: End-to-end verification

**Files:** None (verification only, no code changes expected).

**Interfaces:** None.

This task exercises the full feature against a real `wrangler dev` (or
`wrangler deploy` to a preview) run, the same live-verification pattern
used for the earlier set-list-playlists feature in this project. No
automated test replaces this — it needs Task 1's real secrets and a real
multi-request session (cookies, file uploads) that `node --test` can't
drive against a live Worker.

- [ ] **Step 1: Start a clean local environment**

```bash
npm run import
npm run seed-local-kv
npm run build
npx wrangler dev --port 8793
```

- [ ] **Step 2: Verify auth**

- Visit `http://localhost:8793/admin/` while logged out — confirm it
  redirects to `/admin/login`.
- Submit the wrong password — confirm "Incorrect password" is shown and
  you stay on the login page.
- Submit the correct password (Task 1's `ADMIN_PASSWORD`) — confirm you
  land on `/admin/` and see "No database uploaded yet" (or a prior count,
  if Task 6's manual verification already uploaded something).

- [ ] **Step 3: Verify rate limiting**

Submit the wrong password 10 times in a row (via the form or `curl` in a
loop), then an 11th time — confirm the 11th attempt returns "Too many
attempts, try again later" even with the correct password.

- [ ] **Step 4: Verify a valid upload goes live immediately**

Upload `data/Songs.db` + `data/SongWords.db` through the dashboard form.
Confirm:
- The success message shows a song count matching `npm run import`'s
  earlier output.
- Without restarting `wrangler dev` or rebuilding, visiting `/` shows the
  updated song count and search works.
- `/duplicates/` reflects the same data.

- [ ] **Step 5: Verify an invalid upload is rejected cleanly**

Craft a small invalid pair (e.g. a `Songs.db` copy with one row's `title`
column blanked out via any SQLite tool, or reuse a fixture from Task 2's
tests exported to disk) and upload it. Confirm:
- A clear error message with row details is shown.
- `/` still shows the previous (valid) data — nothing was overwritten.

- [ ] **Step 6: Verify restore**

In "Backup history," click **Restore** on an older entry, confirm the
native confirm dialog appears, accept it, and confirm the song count and
`/` both reflect that older backup afterward.

- [ ] **Step 7: Verify routing didn't regress**

Visit `/`, `/song/<slug>/`, `/duplicates/`, `/set/<any-existing-id>/`, and
a static asset (`/logo.png`) — all must load correctly. This specifically
re-checks for the `Sec-Fetch-Mode: navigate` class of asset-routing bug
this project hit once before, now that `run_worker_first` covers `/*`.

- [ ] **Step 8: Verify logout**

Click "Log out," confirm you're redirected to `/admin/login`, and confirm
visiting `/admin/` again redirects back to login (the session cookie is
gone).

- [ ] **Step 9: Run the full suite one last time**

Run: `npm test`
Expected: PASS, 81 tests.

- [ ] **Step 10: Stop `wrangler dev`**

No commit for this task — it's verification-only. If any step above
surfaces a bug, fix it as a small follow-up commit and re-run the failing
step before considering this task done.

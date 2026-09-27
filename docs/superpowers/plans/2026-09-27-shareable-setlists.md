# Shareable Set Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user build a list of songs on the site, share it as one link, and have anyone with that link view and edit the same live list (add/remove/reorder songs).

**Architecture:** This site has been 100% static (`output: 'static'`, no server code, no storage) through every prior feature. This plan adds the smallest possible live backend: switch to Astro's `output: 'server'` with the `@astrojs/cloudflare` adapter, keep every existing page statically prerendered (`export const prerender = true`), and add exactly three new server-rendered routes (a small JSON API under `/api/setlists/` plus one page, `/set/[id]/`) backed by one Cloudflare KV namespace. Set lists are referenced by song ID only — no song data is duplicated into KV.

**Tech Stack:** Astro 5, `@astrojs/cloudflare` adapter, Cloudflare Workers + KV, vanilla JS (no new client-side dependencies), `node --test`, Playwright (dev-only, uninstalled after use, per this project's established pattern).

**Spec:** `docs/superpowers/specs/2026-09-27-shareable-setlists-design.md`

## Global Constraints

- No new npm dependency beyond `@astrojs/cloudflare` — set-list IDs are generated with the Web Crypto API (`crypto.getRandomValues`), not a package like `nanoid`.
- A set list holds at most 50 song IDs (`MAX_SETLIST_SIZE` in `src/lib/setlist.js`) — enforced server-side on every create/update, independent of what any client sends.
- `POST /api/setlists` rejects an empty (post-filtering) song list with `400`; `PUT /api/setlists/:id` allows an empty list (removing every song from an existing set is a legitimate edit).
- Unknown song IDs in a request are silently dropped, never rejected outright — a direct API call is the only realistic way to send one.
- One link per set list; whoever has it can view and edit it. No separate read-only link, no ownership concept.
- Every existing page (`index.astro`, `song/[slug].astro`, `duplicates.astro`) must keep `export const prerender = true` and build to the exact same static HTML as before — this plan must not change their existing behavior.
- Commit messages follow this repo's existing style (plain, no `Co-Authored-By` trailers — see the system-level instruction already in effect for this project).
- `npm test` must stay green (`node --test scripts/*.test.js src/lib/*.test.js`) after every task.

---

## Task 1: Server output + Cloudflare adapter, existing pages stay static

**Files:**
- Modify: `package.json`
- Modify: `astro.config.mjs`
- Modify: `wrangler.jsonc`
- Modify: `src/pages/index.astro:1-6`
- Modify: `src/pages/song/[slug].astro:1-10`
- Modify: `src/pages/duplicates.astro:1-7`

**Interfaces:**
- Produces: an Astro build that outputs `dist/_worker.js/index.js` (the Worker entry) alongside the same static HTML files as today, so every later task can add server-rendered routes without touching this setup again.

- [ ] **Step 1: Install the Cloudflare adapter**

Run: `npm install @astrojs/cloudflare`

Expected: `@astrojs/cloudflare` appears under `dependencies` in `package.json`, and `package-lock.json` updates accordingly.

- [ ] **Step 2: Switch to server output**

Replace the full contents of `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
});
```

(`platformProxy: { enabled: true }` is what makes `astro dev` simulate Cloudflare bindings — including the KV namespace added in Task 2 — locally, isolated from production data.)

- [ ] **Step 3: Keep every existing page static**

In `src/pages/index.astro`, the frontmatter currently starts:

```astro
---
import Layout from '../layouts/Layout.astro';
import songs from '../data/songs.json';

const songsJson = JSON.stringify(songs).replace(/</g, '\\u003c');
---
```

Change it to:

```astro
---
import Layout from '../layouts/Layout.astro';
import songs from '../data/songs.json';

export const prerender = true;

const songsJson = JSON.stringify(songs).replace(/</g, '\\u003c');
---
```

In `src/pages/song/[slug].astro`, the frontmatter currently starts:

```astro
---
import Layout from '../../layouts/Layout.astro';
import songs from '../../data/songs.json';

export function getStaticPaths() {
```

Change it to:

```astro
---
import Layout from '../../layouts/Layout.astro';
import songs from '../../data/songs.json';

export const prerender = true;

export function getStaticPaths() {
```

In `src/pages/duplicates.astro`, the frontmatter currently starts:

```astro
---
import Layout from '../layouts/Layout.astro';
import songs from '../data/songs.json';
import { findDuplicateGroups } from '../lib/duplicate-groups.js';

const duplicateGroups = findDuplicateGroups(songs);
```

Change it to:

```astro
---
import Layout from '../layouts/Layout.astro';
import songs from '../data/songs.json';
import { findDuplicateGroups } from '../lib/duplicate-groups.js';

export const prerender = true;

const duplicateGroups = findDuplicateGroups(songs);
```

- [ ] **Step 4: Update the Wrangler deploy config for a Worker-based deploy**

Replace the full contents of `wrangler.jsonc`:

```jsonc
{
  "name": "song-search-site",
  "compatibility_date": "2026-09-21",
  "main": "./dist/_worker.js/index.js",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page"
  }
}
```

- [ ] **Step 5: Build and verify existing pages are still static**

Run:
```bash
npm run import
npm run build
```

Expected: the build succeeds. Then check the output shape:

```bash
ls dist/_worker.js/
test -f dist/index.html && echo "index.html: OK"
test -f dist/duplicates/index.html && echo "duplicates: OK"
test -d dist/song && echo "song pages: OK"
```

**If `dist/_worker.js/index.js` does not exist**, run `find dist -name "*.js" | grep -i work` (or on Windows PowerShell: `Get-ChildItem -Recurse dist | Where-Object { $_.Name -like "*worker*" }`) to find the actual entry file the installed adapter version produced, and update the `main` path in `wrangler.jsonc` to match exactly. Re-run this step after adjusting.

- [ ] **Step 6: Confirm existing tests and dev server still work**

Run: `npm test`
Expected: all existing tests still pass (34 tests, matching the count before this task).

Run: `npm run dev`, then in another terminal: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/`
Expected: `200`. Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json astro.config.mjs wrangler.jsonc src/pages/index.astro "src/pages/song/[slug].astro" src/pages/duplicates.astro
git commit -m "Switch to server output with the Cloudflare adapter, keep existing pages static"
```

---

## Task 2: Provision the Cloudflare KV namespace

**This task creates a real resource on the Cloudflare account tied to this project. Confirm with the user before running Step 1** — it's low-risk and free-tier, but it's still a real, persistent cloud resource, consistent with this project's practice of confirming before any action with a footprint outside the repo itself.

**Files:**
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: a `SETLISTS` KV binding available as `locals.runtime.env.SETLISTS` in every server-rendered route from Task 4 onward.

- [ ] **Step 1: Create the namespace** (confirm with the user first)

Run: `npx wrangler kv namespace create SETLISTS`

Expected output includes a JSON snippet like:
```json
{ "kv_namespaces": [ { "binding": "SETLISTS", "id": "<a real id>" } ] }
```

- [ ] **Step 2: Wire the binding into `wrangler.jsonc`**

Add a `kv_namespaces` array to `wrangler.jsonc` (from Task 1's version), pasting in the real `id` from Step 1's output:

```jsonc
{
  "name": "song-search-site",
  "compatibility_date": "2026-09-21",
  "main": "./dist/_worker.js/index.js",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page"
  },
  "kv_namespaces": [
    {
      "binding": "SETLISTS",
      "id": "PASTE_THE_REAL_ID_FROM_STEP_1_HERE"
    }
  ]
}
```

- [ ] **Step 3: Verify the namespace is reachable**

Run:
```bash
npx wrangler kv namespace list
```
Expected: the output includes an entry with `"title": "song-search-site-SETLISTS"` (or similar, matching what Step 1 printed).

Run a manual roundtrip (replace `<id>` with the real id from Step 1):
```bash
npx wrangler kv key put --namespace-id=<id> "healthcheck" "ok"
npx wrangler kv key get --namespace-id=<id> "healthcheck"
npx wrangler kv key delete --namespace-id=<id> "healthcheck"
```
Expected: the `get` prints `ok`; the final `delete` removes the test key so nothing test-related is left behind.

**If `astro dev` later fails to find the `SETLISTS` binding locally** (checked in Task 4): run `npx wrangler kv namespace create SETLISTS --preview` and add its returned id as a `"preview_id"` field alongside `"id"` in the same binding entry in `wrangler.jsonc`.

- [ ] **Step 4: Commit**

```bash
git add wrangler.jsonc
git commit -m "Add the SETLISTS Cloudflare KV namespace binding"
```

---

## Task 3: Set list validation logic (`src/lib/setlist.js`)

**Files:**
- Create: `src/lib/setlist.js`
- Test: `src/lib/setlist.test.js`

**Interfaces:**
- Produces:
  - `MAX_SETLIST_SIZE: number` (50)
  - `filterValidSongIds(songIds: unknown, validIds: Set<string>): string[]`
  - `generateSetlistId(): string` — 10 characters, alphabet `[A-Za-z0-9]`
  - `buildSetlistValue(songIds: string[]): string` — JSON string `{ songIds, updatedAt }`
  - `prepareSongIdsForCreate(requestedIds: unknown, validIds: Set<string>): { songIds: string[] } | { error: string }`
  - `prepareSongIdsForUpdate(requestedIds: unknown, validIds: Set<string>): { songIds: string[] } | { error: string }`
- Consumed by: Task 4's API routes (both `prepare...` functions plus `generateSetlistId`/`buildSetlistValue`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/setlist.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETLIST_SIZE,
  filterValidSongIds,
  generateSetlistId,
  buildSetlistValue,
  prepareSongIdsForCreate,
  prepareSongIdsForUpdate,
} from './setlist.js';

test('MAX_SETLIST_SIZE is 50', () => {
  assert.equal(MAX_SETLIST_SIZE, 50);
});

test('filterValidSongIds keeps only IDs present in the valid set, in order', () => {
  const valid = new Set(['a', 'b', 'c']);
  assert.deepEqual(filterValidSongIds(['a', 'x', 'b', 'y'], valid), ['a', 'b']);
});

test('filterValidSongIds returns an empty array for non-array input', () => {
  const valid = new Set(['a']);
  assert.deepEqual(filterValidSongIds(null, valid), []);
  assert.deepEqual(filterValidSongIds(undefined, valid), []);
  assert.deepEqual(filterValidSongIds('a', valid), []);
});

test('filterValidSongIds ignores non-string entries', () => {
  const valid = new Set(['a']);
  assert.deepEqual(filterValidSongIds(['a', 42, null, {}], valid), ['a']);
});

test('generateSetlistId returns a 10-character alphanumeric string', () => {
  const id = generateSetlistId();
  assert.equal(id.length, 10);
  assert.match(id, /^[A-Za-z0-9]{10}$/);
});

test('generateSetlistId returns different values across calls', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateSetlistId()));
  assert.equal(ids.size, 100);
});

test('buildSetlistValue stores the song ids and an ISO timestamp', () => {
  const value = JSON.parse(buildSetlistValue(['a', 'b']));
  assert.deepEqual(value.songIds, ['a', 'b']);
  assert.equal(new Date(value.updatedAt).toISOString(), value.updatedAt);
});

test('prepareSongIdsForCreate rejects an empty list', () => {
  const valid = new Set(['a', 'b']);
  const result = prepareSongIdsForCreate([], valid);
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate rejects a list of only unknown ids', () => {
  const valid = new Set(['a', 'b']);
  const result = prepareSongIdsForCreate(['x', 'y'], valid);
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate rejects more than MAX_SETLIST_SIZE valid ids', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const requested = Array.from({ length: 51 }, (_, i) => `id${i}`);
  const result = prepareSongIdsForCreate(requested, valid);
  assert.equal(result.error, 'A set list can hold at most 50 songs');
});

test('prepareSongIdsForCreate accepts exactly MAX_SETLIST_SIZE valid ids', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const requested = Array.from({ length: 50 }, (_, i) => `id${i}`);
  const result = prepareSongIdsForCreate(requested, valid);
  assert.equal(result.songIds.length, 50);
  assert.equal(result.error, undefined);
});

test('prepareSongIdsForUpdate allows an empty list', () => {
  const valid = new Set(['a', 'b']);
  const result = prepareSongIdsForUpdate([], valid);
  assert.deepEqual(result.songIds, []);
  assert.equal(result.error, undefined);
});

test('prepareSongIdsForUpdate rejects more than MAX_SETLIST_SIZE valid ids', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const requested = Array.from({ length: 51 }, (_, i) => `id${i}`);
  const result = prepareSongIdsForUpdate(requested, valid);
  assert.equal(result.error, 'A set list can hold at most 50 songs');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/setlist.test.js`
Expected: FAIL — `Cannot find module './setlist.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/setlist.js`:

```js
export const MAX_SETLIST_SIZE = 50;

export function filterValidSongIds(songIds, validIds) {
  if (!Array.isArray(songIds)) return [];
  return songIds.filter((id) => typeof id === 'string' && validIds.has(id));
}

export function generateSetlistId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }
  return id;
}

export function buildSetlistValue(songIds) {
  return JSON.stringify({ songIds, updatedAt: new Date().toISOString() });
}

export function prepareSongIdsForCreate(requestedIds, validIds) {
  const songIds = filterValidSongIds(requestedIds, validIds);
  if (songIds.length === 0) {
    return { error: 'A set list needs at least one song' };
  }
  if (songIds.length > MAX_SETLIST_SIZE) {
    return { error: `A set list can hold at most ${MAX_SETLIST_SIZE} songs` };
  }
  return { songIds };
}

export function prepareSongIdsForUpdate(requestedIds, validIds) {
  const songIds = filterValidSongIds(requestedIds, validIds);
  if (songIds.length > MAX_SETLIST_SIZE) {
    return { error: `A set list can hold at most ${MAX_SETLIST_SIZE} songs` };
  }
  return { songIds };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/setlist.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setlist.js src/lib/setlist.test.js
git commit -m "Add set list validation logic with unit tests"
```

---

## Task 4: Set list API routes

**Files:**
- Create: `src/pages/api/setlists/index.js`
- Create: `src/pages/api/setlists/[id].js`

**Interfaces:**
- Consumes: `prepareSongIdsForCreate`, `prepareSongIdsForUpdate`, `generateSetlistId`, `buildSetlistValue` from `../../../lib/setlist.js` (Task 3); `locals.runtime.env.SETLISTS` (Task 2).
- Produces: `POST /api/setlists` → `{ id: string }`; `GET /api/setlists/:id` → `{ songIds: string[], updatedAt: string }` or 404; `PUT /api/setlists/:id` → same shape as GET, or 404. Consumed by Task 5's client helper and Task 6's page.

- [ ] **Step 1: Create the collection route**

Create `src/pages/api/setlists/index.js`:

```js
import { prepareSongIdsForCreate, generateSetlistId, buildSetlistValue } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const result = prepareSongIdsForCreate(body.songIds, validSongIds);
  if (result.error) {
    return jsonResponse({ error: result.error }, 400);
  }

  const id = generateSetlistId();
  await kv.put(id, buildSetlistValue(result.songIds));
  return jsonResponse({ id });
}
```

- [ ] **Step 2: Create the item route**

Create `src/pages/api/setlists/[id].js`:

```js
import { prepareSongIdsForUpdate, buildSetlistValue } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET({ params, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const raw = await kv.get(params.id);
  if (raw === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function PUT({ params, request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const existing = await kv.get(params.id);
  if (existing === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const result = prepareSongIdsForUpdate(body.songIds, validSongIds);
  if (result.error) {
    return jsonResponse({ error: result.error }, 400);
  }

  const value = buildSetlistValue(result.songIds);
  await kv.put(params.id, value);
  return new Response(value, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 3: Verify against a real dev server**

These routes touch the Cloudflare KV binding, which only exists under the Astro/Wrangler runtime — verify with a scripted integration check rather than `node --test`.

Run (this starts the dev server in the background, tests it, then stops it):

```bash
npm run import
npx astro dev &
DEV_PID=$!
sleep 3

SONG_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('./src/data/songs.json'))[0].id)")
echo "Using song id: $SONG_ID"

CREATE_RESPONSE=$(curl -s -X POST http://localhost:4321/api/setlists \
  -H "Content-Type: application/json" \
  -d "{\"songIds\":[\"$SONG_ID\"]}")
echo "Create response: $CREATE_RESPONSE"
SET_ID=$(echo "$CREATE_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
echo "Created set id: $SET_ID"

echo "GET:"
curl -s http://localhost:4321/api/setlists/$SET_ID

echo ""
echo "PUT (clear the list):"
curl -s -X PUT http://localhost:4321/api/setlists/$SET_ID \
  -H "Content-Type: application/json" \
  -d "{\"songIds\":[]}"

echo ""
echo "GET nonexistent id (expect 404):"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/api/setlists/doesnotexist1

kill $DEV_PID
```

Expected: the create response contains a 10-character `id`; the first `GET` returns `{"songIds":["<SONG_ID>"],"updatedAt":"..."}`; the `PUT` returns `{"songIds":[],"updatedAt":"..."}`; the nonexistent-id `GET` prints `404`.

**If the dev server errors on the KV binding** (e.g. `locals.runtime.env.SETLISTS is undefined`): confirm Task 1 Step 2's `platformProxy: { enabled: true }` is in `astro.config.mjs`, and confirm `wrangler.jsonc` has the `kv_namespaces` entry from Task 2 — `astro dev` reads bindings from `wrangler.jsonc` via the platform proxy.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/setlists/
git commit -m "Add set list API routes (create, read, update)"
```

---

## Task 5: Client-side set list helper (`src/lib/setlist-client.js`)

This module is browser-only (uses `localStorage` and `fetch` against a real server), so it's exercised through Playwright in Tasks 7–9 rather than `node --test` — see the note at the end of this task for why.

**Files:**
- Create: `src/lib/setlist-client.js`

**Interfaces:**
- Consumes: `POST /api/setlists`, `GET /api/setlists/:id`, `PUT /api/setlists/:id` (Task 4).
- Produces (explicit-ID, used directly by Task 6's `/set/[id]/` page):
  - `fetchSetlist(id: string): Promise<{ songIds: string[], updatedAt: string } | null>`
  - `updateSetlist(id: string, songIds: string[]): Promise<{ songIds: string[], updatedAt: string }>`
  - `createSetlist(songIds: string[]): Promise<{ id: string }>`
- Produces (draft-vs-live, used by Task 7's home page and Task 8's song page):
  - `getLiveSetId(): string | null`
  - `getDraftIds(): string[]`
  - `getCurrentSetIds(): Promise<string[]>`
  - `addSongToSet(songId: string): Promise<string[]>`
  - `removeSongFromSet(songId: string): Promise<string[]>`
  - `reorderSongInSet(songId: string, direction: -1 | 1): Promise<string[]>`
  - `shareSet(): Promise<string>` — id of the newly created set
  - `startNewSet(): void`

- [ ] **Step 1: Write the module**

Create `src/lib/setlist-client.js`:

```js
const DRAFT_KEY = 'songSearchSetDraft';
const LIVE_ID_KEY = 'songSearchSetId';

function readIds(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function writeIds(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
}

// --- Explicit-ID API calls, used directly by the /set/[id]/ page ---

export async function fetchSetlist(id) {
  const response = await fetch(`/api/setlists/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function updateSetlist(id, songIds) {
  const response = await fetch(`/api/setlists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds }),
  });
  if (!response.ok) throw new Error('Failed to update set list');
  return response.json();
}

export async function createSetlist(songIds) {
  const response = await fetch('/api/setlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds }),
  });
  if (!response.ok) throw new Error('Failed to create set list');
  return response.json();
}

// --- Draft-vs-live helpers, used by the home page "My Set" tab and add-to-set buttons ---

export function getLiveSetId() {
  try { return localStorage.getItem(LIVE_ID_KEY); }
  catch { return null; }
}

export function getDraftIds() {
  return readIds(DRAFT_KEY);
}

export async function getCurrentSetIds() {
  const liveId = getLiveSetId();
  if (!liveId) return getDraftIds();
  const data = await fetchSetlist(liveId);
  return data ? data.songIds : [];
}

export async function addSongToSet(songId) {
  const liveId = getLiveSetId();
  if (!liveId) {
    const ids = getDraftIds();
    if (ids.includes(songId)) return ids;
    const next = [...ids, songId];
    writeIds(DRAFT_KEY, next);
    return next;
  }
  const current = await getCurrentSetIds();
  if (current.includes(songId)) return current;
  const result = await updateSetlist(liveId, [...current, songId]);
  return result.songIds;
}

export async function removeSongFromSet(songId) {
  const liveId = getLiveSetId();
  if (!liveId) {
    const next = getDraftIds().filter((id) => id !== songId);
    writeIds(DRAFT_KEY, next);
    return next;
  }
  const current = await getCurrentSetIds();
  const result = await updateSetlist(liveId, current.filter((id) => id !== songId));
  return result.songIds;
}

export async function reorderSongInSet(songId, direction) {
  const liveId = getLiveSetId();
  const ids = liveId ? await getCurrentSetIds() : getDraftIds();
  const index = ids.indexOf(songId);
  if (index === -1) return ids;
  const target = index + direction;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  if (!liveId) {
    writeIds(DRAFT_KEY, next);
    return next;
  }
  const result = await updateSetlist(liveId, next);
  return result.songIds;
}

export async function shareSet() {
  const ids = getDraftIds();
  const data = await createSetlist(ids);
  try {
    localStorage.setItem(LIVE_ID_KEY, data.id);
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
  return data.id;
}

export function startNewSet() {
  try { localStorage.removeItem(LIVE_ID_KEY); } catch {}
}
```

**Why no `node --test` file here:** every exported function either reads/writes `localStorage` or calls `fetch` against a real running server — both are browser/runtime concerns this project doesn't mock (consistent with how `getFavorites`/`setFavorites` in `index.astro` and `song/[slug].astro` were never unit-tested either — they were verified live via Playwright). The pure validation logic this module depends on (cap enforcement, unknown-ID filtering) is already fully unit-tested in Task 3. This module's own behavior is verified end-to-end in Tasks 7–9.

- [ ] **Step 2: Commit**

```bash
git add src/lib/setlist-client.js
git commit -m "Add client-side set list helper"
```

---

## Task 6: Set list page (`/set/[id]/`)

**Files:**
- Create: `src/pages/set/[id].astro`

**Interfaces:**
- Consumes: `Astro.locals.runtime.env.SETLISTS` directly (server-side read on load, more efficient than the page fetching its own API); `updateSetlist` from `../../lib/setlist-client.js` (client-side, for edits after load — `fetchSetlist` isn't needed here since SSR already did the initial read).
- Produces: the `/set/<id>/` URL every shared link points to.

- [ ] **Step 1: Create the page**

Create `src/pages/set/[id].astro`:

```astro
---
import Layout from '../../layouts/Layout.astro';
import songs from '../../data/songs.json';

export const prerender = false;

const { id } = Astro.params;
const kv = Astro.locals.runtime.env.SETLISTS;
const raw = await kv.get(id);
const songById = new Map(songs.map((song) => [song.id, song]));

let initialSongIds = [];
if (raw) {
  initialSongIds = JSON.parse(raw).songIds;
}

const songsJson = JSON.stringify(songs).replace(/</g, '\\u003c');
---
<Layout title="Set List — Song Search" description="A shared, editable list of songs.">
  <div class="page">
    <p><a href="/">← Back to search</a></p>

    {raw === null ? (
      <div>
        <h1>Set List Not Found</h1>
        <p class="status">This set list doesn't exist. It may have been mistyped, or the link is wrong.</p>
      </div>
    ) : (
      <div id="set-app">
        <h1>Set List</h1>
        <div class="actions">
          <button id="copy-link">Copy link</button>
        </div>
        <p id="status"></p>
        <ul id="set-songs"></ul>

        <h2>Add a song</h2>
        <input type="search" id="add-search" placeholder="Search by title or lyrics..." />
        <ul id="add-results"></ul>
      </div>
    )}
  </div>

  <style>
    .page {
      max-width: 680px;
      margin: 0 auto;
    }
    .status {
      color: var(--color-muted-foreground);
      margin: 16px 0;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }
    #copy-link {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border: none;
      border-radius: 12px;
      padding: 10px 18px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: opacity 150ms ease;
    }
    #copy-link:hover { opacity: 0.85; }
    #set-songs, #add-results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .set-song {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      background: var(--color-card);
    }
    .set-song a {
      font-weight: 600;
      text-decoration: none;
    }
    .set-song a:hover { text-decoration: underline; }
    .set-song .author {
      color: var(--color-muted-foreground);
      font-size: 0.9rem;
    }
    .set-song .controls {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }
    .set-song .controls button {
      border: 1px solid var(--color-border);
      background: var(--color-card);
      border-radius: 8px;
      padding: 4px 10px;
      cursor: pointer;
    }
    .set-song .controls button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    #add-search {
      width: 100%;
      padding: 12px 16px;
      font-size: 1rem;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      background: var(--color-card);
      color: var(--color-card-foreground);
      margin-top: 8px;
    }
    #add-results button {
      width: 100%;
      text-align: left;
      padding: 10px 14px;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      background: var(--color-card);
      cursor: pointer;
    }
  </style>

  <script type="application/json" id="songs-data" set:html={songsJson} />
  <script define:vars={{ setId: id, initialSongIds }}>
    import { updateSetlist } from '../../lib/setlist-client.js';

    const setSongsList = document.getElementById('set-songs');

    if (setSongsList) {
      const data = JSON.parse(document.getElementById('songs-data').textContent);
      const songById = new Map(data.map((song) => [song.id, song]));
      let currentIds = initialSongIds;
      const statusEl = document.getElementById('status');

      function renderSetSongs() {
        setSongsList.replaceChildren();
        if (currentIds.length === 0) {
          statusEl.textContent = 'No songs in this set yet — add some below.';
        } else {
          statusEl.textContent = `${currentIds.length} song${currentIds.length === 1 ? '' : 's'} in this set`;
        }

        currentIds.forEach((songId, index) => {
          const song = songById.get(songId);
          if (!song) return;

          const li = document.createElement('li');
          li.className = 'set-song';

          const link = document.createElement('a');
          link.href = `/song/${song.slug}/`;
          link.textContent = song.title;
          li.appendChild(link);

          if (song.author) {
            const author = document.createElement('span');
            author.className = 'author';
            author.textContent = song.author;
            li.appendChild(author);
          }

          const controls = document.createElement('span');
          controls.className = 'controls';

          const upBtn = document.createElement('button');
          upBtn.type = 'button';
          upBtn.textContent = '↑';
          upBtn.disabled = index === 0;
          upBtn.addEventListener('click', () => reorder(index, -1));
          controls.appendChild(upBtn);

          const downBtn = document.createElement('button');
          downBtn.type = 'button';
          downBtn.textContent = '↓';
          downBtn.disabled = index === currentIds.length - 1;
          downBtn.addEventListener('click', () => reorder(index, 1));
          controls.appendChild(downBtn);

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => removeAt(index));
          controls.appendChild(removeBtn);

          li.appendChild(controls);
          setSongsList.appendChild(li);
        });
      }

      async function persist(nextIds) {
        currentIds = nextIds;
        renderSetSongs();
        try {
          await updateSetlist(setId, currentIds);
        } catch {
          statusEl.textContent = 'Could not save that change. Check your connection and try again.';
        }
      }

      function reorder(index, direction) {
        const target = index + direction;
        if (target < 0 || target >= currentIds.length) return;
        const next = [...currentIds];
        [next[index], next[target]] = [next[target], next[index]];
        persist(next);
      }

      function removeAt(index) {
        persist(currentIds.filter((_, i) => i !== index));
      }

      function addSong(songId) {
        if (currentIds.includes(songId)) return;
        persist([...currentIds, songId]);
      }

      renderSetSongs();

      const addInput = document.getElementById('add-search');
      const addResults = document.getElementById('add-results');
      addInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        addResults.replaceChildren();
        if (!q) return;
        const matches = data
          .filter((song) => !currentIds.includes(song.id) && song.title.toLowerCase().includes(q))
          .slice(0, 8);
        for (const song of matches) {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = `+ ${song.title}`;
          btn.addEventListener('click', () => {
            addSong(song.id);
            addInput.value = '';
            addResults.replaceChildren();
          });
          li.appendChild(btn);
          addResults.appendChild(li);
        }
      });

      const copyBtn = document.getElementById('copy-link');
      const defaultCopyText = copyBtn.textContent;
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          copyBtn.textContent = 'Copied!';
        } catch {
          copyBtn.textContent = 'Copy failed';
        }
        setTimeout(() => { copyBtn.textContent = defaultCopyText; }, 1500);
      });
    }
  </script>
</Layout>
```

Note on structure: the executable `<script>` tag is always present in the template (never wrapped in the `{raw === null ? ... : ...}` conditional) — only the DOM it operates on is conditional. The script itself guards all its logic behind `if (setSongsList) { ... }`, which is `null` on the not-found page. This avoids relying on how Astro's compiler handles a `<script>` tag nested inside a conditional JSX-like expression, which isn't a pattern used anywhere else in this codebase.

- [ ] **Step 2: Manual verification against the dev server**

Run:
```bash
npx astro dev &
DEV_PID=$!
sleep 3

curl -s http://localhost:4321/set/doesnotexist1/ | grep -o "Set List Not Found"

SONG_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('./src/data/songs.json'))[0].id)")
SET_ID=$(curl -s -X POST http://localhost:4321/api/setlists -H "Content-Type: application/json" -d "{\"songIds\":[\"$SONG_ID\"]}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
curl -s http://localhost:4321/set/$SET_ID/ | grep -o "Set List</h1>"

kill $DEV_PID
```

Expected: the first `grep` prints `Set List Not Found`; the second prints `Set List</h1>` (confirming the found-state page rendered).

- [ ] **Step 3: Commit**

```bash
git add "src/pages/set/[id].astro"
git commit -m "Add the /set/[id]/ page for viewing and editing a shared set list"
```

---

## Task 7: Home page — add-to-set buttons and "My Set" tab

**Files:**
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `addSongToSet`, `removeSongFromSet`, `reorderSongInSet`, `getLiveSetId`, `getCurrentSetIds`, `shareSet`, `startNewSet` from `../lib/setlist-client.js` (Task 5).

- [ ] **Step 1: Add the import and a fourth tab**

In `src/pages/index.astro`, the script currently starts:

```js
  <script>
    import { normalizeTitle } from '../lib/normalize.js';
```

Change to:

```js
  <script>
    import { normalizeTitle } from '../lib/normalize.js';
    import { addSongToSet, removeSongFromSet, reorderSongInSet, getLiveSetId, getCurrentSetIds, shareSet, startNewSet } from '../lib/setlist-client.js';
```

The tab bar currently reads:

```astro
  <div id="tabs">
    <button type="button" class="tab active" data-tab="all">All Songs</button>
    <button type="button" class="tab" data-tab="favorites">Favorites</button>
    <button type="button" class="tab" data-tab="recent">Recently Used</button>
  </div>
```

Change to:

```astro
  <div id="tabs">
    <button type="button" class="tab active" data-tab="all">All Songs</button>
    <button type="button" class="tab" data-tab="favorites">Favorites</button>
    <button type="button" class="tab" data-tab="recent">Recently Used</button>
    <button type="button" class="tab" data-tab="set">My Set</button>
  </div>
```

- [ ] **Step 2: Restructure result cards so the "+" button isn't nested inside the link**

`buildCard` currently reads:

```js
    function buildCard(song, query, page) {
      const li = document.createElement('li');
      li.dataset.songId = song.id;
      const a = document.createElement('a');
      a.className = 'result-card';
```

Change to (adds the `.result-item` class to the `<li>`, so it can be positioned relative to the new corner button — the `<a>` setup below stays exactly the same):

```js
    function buildCard(song, query, page) {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.dataset.songId = song.id;
      const a = document.createElement('a');
      a.className = 'result-card';
```

At the end of `buildCard`, this currently reads:

```js
      li.appendChild(a);
      return li;
    }
```

Change to:

```js
      li.appendChild(a);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'add-to-set-btn';
      addBtn.title = 'Add to set';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          cachedSetIds = await addSongToSet(song.id);
          updateTabLabels();
          showTransientStatus(`Added "${song.title}" to your set`);
          if (currentTab === 'set') renderSetTab();
        } catch {
          showTransientStatus('Could not add that song — check your connection.');
        }
      });
      li.appendChild(addBtn);

      return li;
    }
```

- [ ] **Step 3: Add the CSS for the restructured card and the new tab**

The stylesheet currently has:

```css
    #results {
      list-style: none;
      margin: 24px 0 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
```

Add directly after it:

```css
    .result-item {
      position: relative;
    }
    .add-to-set-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1px solid var(--color-border);
      background: var(--color-card);
      color: var(--color-primary);
      font-size: 1.1rem;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .add-to-set-btn:hover {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
    .set-controls {
      display: flex;
      gap: 10px;
      align-items: center;
      grid-column: 1 / -1;
    }
    .set-controls button, .set-controls a {
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid var(--color-border);
      background: var(--color-card);
      color: var(--color-card-foreground);
      text-decoration: none;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .set-controls button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .set-song-row {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      background: var(--color-card);
    }
    .set-song-row a {
      font-weight: 600;
      text-decoration: none;
      color: var(--color-card-foreground);
    }
    .set-song-row a:hover {
      text-decoration: underline;
    }
    .row-controls {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }
    .row-controls button {
      border: 1px solid var(--color-border);
      background: var(--color-card);
      border-radius: 8px;
      padding: 4px 10px;
      cursor: pointer;
    }
    .row-controls button:disabled {
      opacity: 0.4;
      cursor: default;
    }
```

- [ ] **Step 4: Track the current set's song IDs and extend the tab label logic**

This currently reads:

```js
    const tabs = document.getElementById('tabs');
    const tabButtons = Array.from(tabs.querySelectorAll('.tab'));
    let currentTab = 'all';
    let selectedIndex = -1;
```

Change to:

```js
    const tabs = document.getElementById('tabs');
    const tabButtons = Array.from(tabs.querySelectorAll('.tab'));
    let currentTab = 'all';
    let selectedIndex = -1;
    let cachedSetIds = [];
```

This currently reads:

```js
    function updateTabLabels() {
      const favCount = getFavorites().length;
      const recentCount = getRecent().length;
      for (const btn of tabButtons) {
        const type = btn.dataset.tab;
        const label = type === 'all' ? 'All Songs' : type === 'favorites' ? 'Favorites' : 'Recently Used';
        const count = type === 'favorites' ? favCount : type === 'recent' ? recentCount : null;
        btn.textContent = count ? `${label} (${count})` : label;
      }
    }
```

Change to:

```js
    function updateTabLabels() {
      const favCount = getFavorites().length;
      const recentCount = getRecent().length;
      const setCount = cachedSetIds.length;
      for (const btn of tabButtons) {
        const type = btn.dataset.tab;
        const label = type === 'all' ? 'All Songs'
          : type === 'favorites' ? 'Favorites'
          : type === 'recent' ? 'Recently Used'
          : 'My Set';
        const count = type === 'favorites' ? favCount
          : type === 'recent' ? recentCount
          : type === 'set' ? setCount
          : null;
        btn.textContent = count ? `${label} (${count})` : label;
      }
    }
```

- [ ] **Step 5: Add `renderSetTab` and wire it into tab switching**

This currently reads:

```js
    function renderCurrentTab() {
      if (currentTab === 'favorites') renderFavoritesTab();
      else if (currentTab === 'recent') renderRecentTab();
      else renderBrowse(1);
    }
```

Change to:

```js
    async function renderSetTab() {
      showTabs();
      pagination.style.display = 'none';
      results.replaceChildren();
      selectedIndex = -1;

      cachedSetIds = await getCurrentSetIds();
      updateTabLabels();

      const setSongs = cachedSetIds.map((id) => songById.get(id)).filter(Boolean);

      if (setSongs.length === 0) {
        status.textContent = 'No songs in your set yet — use the + button on any song to add one.';
      } else {
        status.textContent = `${setSongs.length} song${setSongs.length === 1 ? '' : 's'} in your set`;
      }

      const controlsLi = document.createElement('li');
      controlsLi.className = 'set-controls';

      if (!getLiveSetId()) {
        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.textContent = 'Share this set';
        shareBtn.disabled = setSongs.length === 0;
        shareBtn.addEventListener('click', async () => {
          const id = await shareSet();
          location.href = `/set/${id}/`;
        });
        controlsLi.appendChild(shareBtn);
      } else {
        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.textContent = 'Start a new set';
        newBtn.addEventListener('click', () => {
          startNewSet();
          renderSetTab();
        });
        controlsLi.appendChild(newBtn);

        const viewLink = document.createElement('a');
        viewLink.href = `/set/${getLiveSetId()}/`;
        viewLink.textContent = 'Open shared set list';
        controlsLi.appendChild(viewLink);
      }
      results.appendChild(controlsLi);

      setSongs.forEach((song, index) => {
        const li = document.createElement('li');
        li.className = 'set-song-row';

        const link = document.createElement('a');
        link.href = `/song/${song.slug}/`;
        link.textContent = song.title;
        li.appendChild(link);

        if (song.author) {
          const author = document.createElement('span');
          author.className = 'result-author';
          author.textContent = song.author;
          li.appendChild(author);
        }

        const controls = document.createElement('span');
        controls.className = 'row-controls';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.textContent = '↑';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', async () => {
          cachedSetIds = await reorderSongInSet(song.id, -1);
          renderSetTab();
        });
        controls.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.textContent = '↓';
        downBtn.disabled = index === setSongs.length - 1;
        downBtn.addEventListener('click', async () => {
          cachedSetIds = await reorderSongInSet(song.id, 1);
          renderSetTab();
        });
        controls.appendChild(downBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', async () => {
          cachedSetIds = await removeSongFromSet(song.id);
          renderSetTab();
        });
        controls.appendChild(removeBtn);

        li.appendChild(controls);
        results.appendChild(li);
      });
    }

    function renderCurrentTab() {
      if (currentTab === 'favorites') renderFavoritesTab();
      else if (currentTab === 'recent') renderRecentTab();
      else if (currentTab === 'set') renderSetTab();
      else renderBrowse(1);
    }
```

- [ ] **Step 6: Refresh the set count on initial load**

This currently reads (near the bottom of the script):

```js
    updateTabLabels();

    const params = new URLSearchParams(location.search);
```

Change to:

```js
    updateTabLabels();
    getCurrentSetIds().then((ids) => {
      cachedSetIds = ids;
      updateTabLabels();
    });

    const params = new URLSearchParams(location.search);
```

- [ ] **Step 7: Manual verification against the dev server**

Run `npx astro dev`, then in a browser:
1. Click the "+" button on any result card. Confirm a transient status message like `Added "..." to your set` appears.
2. Click the "My Set" tab. Confirm the song appears as a row with ↑/↓/Remove buttons, and the tab label now reads `My Set (1)`.
3. Add a second song via "+", then in the "My Set" tab use the ↑/↓ buttons to reorder them, and Remove to delete one. Confirm the list and tab count update correctly each time.
4. Add a song back, then click "Share this set". Confirm the page navigates to `/set/<id>/` and the song appears there too.
5. Go back to `/`, click "My Set" again. Confirm it now shows "Start a new set" and "Open shared set list" instead of "Share this set" (since a live set id is now remembered), and that ↑/↓/Remove there now edit the live shared set (verify by opening `/set/<id>/` in a second tab and confirming a change made via the "My Set" tab shows up there after a reload).

Stop the dev server afterward.

- [ ] **Step 8: Commit**

```bash
git add src/pages/index.astro
git commit -m "Add add-to-set buttons and a My Set tab to the home page"
```

---

## Task 8: Song page — "Add to Set" button

**Files:**
- Modify: `src/pages/song/[slug].astro`

**Interfaces:**
- Consumes: `addSongToSet` from `../../lib/setlist-client.js` (Task 5).

- [ ] **Step 1: Add the button next to Favorite**

This currently reads:

```astro
    <div class="actions">
      <button id="copy-link">Copy link</button>
      <button id="favorite-toggle" aria-pressed="false">
        <span id="favorite-star">☆</span> Favorite
      </button>
    </div>
```

Change to:

```astro
    <div class="actions">
      <button id="copy-link">Copy link</button>
      <button id="favorite-toggle" aria-pressed="false">
        <span id="favorite-star">☆</span> Favorite
      </button>
      <button id="add-to-set">Add to Set</button>
    </div>
```

- [ ] **Step 2: Style it like the Favorite button**

This currently reads:

```css
    #favorite-toggle[aria-pressed="true"] {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
  </style>
```

Change to:

```css
    #favorite-toggle[aria-pressed="true"] {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
    #add-to-set {
      background: var(--color-card);
      color: var(--color-card-foreground);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 10px 18px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    #add-to-set:hover {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
  </style>
```

- [ ] **Step 3: Wire up the click handler**

The script currently starts:

```js
  <script define:vars={{ songId: song.id }}>
    const params = new URLSearchParams(location.search);
```

Change to:

```js
  <script define:vars={{ songId: song.id }}>
    import { addSongToSet } from '../../lib/setlist-client.js';

    const params = new URLSearchParams(location.search);
```

The script currently ends:

```js
    favBtn.addEventListener('click', () => {
      const favs = getFavorites();
      const isFav = favs.includes(songId);
      setFavorites(isFav ? favs.filter((x) => x !== songId) : [...favs, songId]);
      updateFavButton(!isFav);
    });
  </script>
```

Change to:

```js
    favBtn.addEventListener('click', () => {
      const favs = getFavorites();
      const isFav = favs.includes(songId);
      setFavorites(isFav ? favs.filter((x) => x !== songId) : [...favs, songId]);
      updateFavButton(!isFav);
    });

    const addToSetBtn = document.getElementById('add-to-set');
    const addToSetDefaultText = addToSetBtn.textContent;
    addToSetBtn.addEventListener('click', async () => {
      addToSetBtn.disabled = true;
      try {
        await addSongToSet(songId);
        addToSetBtn.textContent = 'Added!';
      } catch {
        addToSetBtn.textContent = 'Failed — try again';
      }
      setTimeout(() => {
        addToSetBtn.textContent = addToSetDefaultText;
        addToSetBtn.disabled = false;
      }, 1500);
    });
  </script>
```

- [ ] **Step 4: Manual verification against the dev server**

Run `npx astro dev`, open any song page, click "Add to Set". Confirm the button briefly reads "Added!" then reverts. Go to the home page's "My Set" tab and confirm the song appears there. Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
git add "src/pages/song/[slug].astro"
git commit -m "Add an Add to Set button to the song page"
```

---

## Task 9: End-to-end verification of shared mutability

This is the task that actually proves the point of the feature: a set list edited from one device/browser is visible from another. It also proves the cap and not-found handling work through the real UI, not just the API directly.

**Files:**
- None created (temporary Playwright script only, written to the job scratch directory and removed after use, per this project's established testing pattern).

- [ ] **Step 1: Install Playwright**

Run: `npm install --no-save playwright`

- [ ] **Step 2: Build, then run the dev server**

```bash
npm run import
npx astro dev &
DEV_PID=$!
sleep 3
```

- [ ] **Step 3: Write and run the end-to-end script**

Write a script (adapt the path to this project's scratch-directory convention) with this content:

```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const base = 'http://localhost:4321';

  // Context A: build and share a 3-song set
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto(base + '/');
  await pageA.waitForSelector('#results li');

  const addButtons = await pageA.$$('.add-to-set-btn');
  await addButtons[0].click();
  await addButtons[1].click();
  await addButtons[2].click();
  await pageA.waitForTimeout(300);

  await pageA.click('.tab[data-tab="set"]');
  await pageA.waitForTimeout(200);
  const titlesBeforeShare = await pageA.$$eval('.set-song-row a', (els) => els.map((e) => e.textContent));
  console.log('Set before share:', titlesBeforeShare);

  await Promise.all([
    pageA.waitForNavigation(),
    pageA.click('button:has-text("Share this set")'),
  ]);
  const setUrl = pageA.url();
  console.log('Shared at:', setUrl);

  // Context B: a different browser context opens the same link
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(setUrl);
  const titlesInB = await pageB.$$eval('.set-song a', (els) => els.map((e) => e.textContent));
  console.log('Context B sees:', titlesInB);

  // Context B removes the first song
  await pageB.click('.set-song:first-child button:has-text("Remove")');
  await pageB.waitForTimeout(300);
  const titlesAfterRemove = await pageB.$$eval('.set-song a', (els) => els.map((e) => e.textContent));
  console.log('Context B after remove:', titlesAfterRemove);

  // Context A reloads the same set page and should see the removal
  await pageA.goto(setUrl);
  const titlesInAAfterReload = await pageA.$$eval('.set-song a', (els) => els.map((e) => e.textContent));
  console.log('Context A after reload:', titlesInAAfterReload);
  console.log('Mutability proven:', JSON.stringify(titlesInAAfterReload) === JSON.stringify(titlesAfterRemove));

  // Cap enforcement: try to create a set with 51 songs directly against the API
  const homeSongIds = await (async () => {
    const p = await contextA.newPage();
    await p.goto(base + '/');
    const ids = await p.evaluate(() => JSON.parse(document.getElementById('songs-data').textContent).map((s) => s.id));
    await p.close();
    return ids;
  })();
  const capResponse = await pageA.evaluate(async (ids) => {
    const res = await fetch('/api/setlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songIds: ids.slice(0, 51) }),
    });
    return res.status;
  }, homeSongIds);
  console.log('51-song create status (expect 400):', capResponse);

  // Not-found page
  await pageA.goto(base + '/set/doesnotexist12/');
  const notFoundText = await pageA.$eval('h1', (el) => el.textContent);
  console.log('Not-found page h1:', notFoundText);

  await browser.close();
})();
```

Run it with Node, then check the printed output for:
- `Set before share:` lists 3 titles
- `Context B sees:` matches those same 3 titles
- `Context B after remove:` has 2 titles
- `Context A after reload:` matches `Context B after remove:` exactly, and `Mutability proven: true`
- `51-song create status (expect 400): 400`
- `Not-found page h1: Set List Not Found`

- [ ] **Step 4: Stop the dev server and clean up**

```bash
kill $DEV_PID
```

Remove the temporary Playwright script file (it was written to job scratch, not the repo).

- [ ] **Step 5: Uninstall Playwright and revert lockfile drift**

```bash
npm uninstall playwright
git checkout -- package-lock.json
git status --porcelain
```

Expected: clean working tree (no leftover Playwright/test-script changes).

- [ ] **Step 6: Re-run the full test suite one more time**

Run: `npm test`
Expected: all unit tests still pass (49 tests: 34 from before this feature + 15 new from Task 3).

No commit for this task — it produces no source changes, only verification.

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature and the new deploy shape**

In `README.md`, after the existing "Keyboard shortcuts" section (before "## Develop"), add:

```markdown
## Set lists

Build a list of songs (e.g. for a Sunday service) using the "+" button
on any search result or the "Add to Set" button on a song page, then
open the "My Set" tab and click "Share this set" to get a link like
`/set/<id>/`. Anyone with that link can view it and add, remove, or
reorder songs — changes are visible to everyone who has the link, since
the set list lives in a Cloudflare KV store, not in the URL itself.
```

In `README.md`, under the existing "## Cloudflare Pages settings" section, after the last bullet, add:

```markdown
- This site now deploys a real Worker (not pure static assets) to
  support set lists — `wrangler deploy` ships `dist/_worker.js/` as
  the Worker entry, with everything else served as static assets. A
  Cloudflare KV namespace bound as `SETLISTS` is required; see
  `wrangler.jsonc`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document set lists and the Worker-based deploy shape"
```

---

## Deploying (not a task — do this once implementation is reviewed and approved)

1. `npm run import && npm run build`
2. `npx wrangler deploy`
3. Verify live with a cache-busted fetch, same pattern as every prior feature this session: create a set list via the live `/api/setlists` endpoint, confirm `GET`ting it back works, and confirm `/set/<a real id>/` renders correctly — not just that the deploy "succeeded."

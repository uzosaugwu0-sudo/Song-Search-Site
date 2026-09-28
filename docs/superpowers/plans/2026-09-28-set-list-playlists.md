# Set List Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn set lists into named, personally-savable playlists — each one has a name, and every playlist you create or open via a link can be saved into a local "My Playlists" library, without adding any account/login system.

**Architecture:** Extends the existing set-list feature (one Cloudflare KV entry per set list, edited via `POST`/`GET`/`PUT /api/setlists`) with a `name` field, and replaces the client's "one live set at a time" model with a "local library of many saved playlists" model (`localStorage` array, no server changes needed for the library itself).

**Tech Stack:** Astro 5 (server output, `@astrojs/cloudflare` adapter — already in place), Cloudflare Workers + KV, vanilla JS, `node --test`, Playwright (dev-only, per this project's established pattern).

**Spec:** `docs/superpowers/specs/2026-09-28-set-list-playlists-design.md`

## Global Constraints

- `MAX_SETLIST_SIZE` stays 50 (unchanged) — server-side cap on songs per playlist.
- `MAX_SETLIST_NAME_LENGTH = 100` — server-side cap on playlist name length.
- `POST /api/setlists` requires both a non-empty `songIds` (existing rule) and a non-empty, trimmed `name` (new) — rejects with `400` if either is invalid.
- `PUT /api/setlists/:id` keeps `songIds` as a required full replace (existing rule, empty array allowed). `name` is **optional** on `PUT`: omitted → existing stored name is kept; present → validated the same way as on create (non-empty, ≤100 chars) and replaces it.
- The old `songSearchSetId` `localStorage` key and the old draft-vs-live functions (`getLiveSetId`, `getCurrentSetIds`, `addSongToSet`, `removeSongFromSet`, `reorderSongInSet`, `shareSet`, `startNewSet`) are removed, not deprecated-in-place. Any leftover `songSearchSetId` value in an existing visitor's browser is simply never read again — no migration code needed.
- Existing production set lists created before this change have no stored `name` — every place a name is displayed must fall back to `"Untitled Set"` when the stored value is falsy.
- Commit messages follow this repo's existing style (plain, no `Co-Authored-By` trailers).
- `npm test` (`node --test scripts/*.test.js src/lib/*.test.js`) must stay green after every task.

---

## Task 1: Name validation in `src/lib/setlist.js`

**Files:**
- Modify: `src/lib/setlist.js`
- Modify: `src/lib/setlist.test.js`

**Interfaces:**
- Produces: `MAX_SETLIST_NAME_LENGTH: number` (100); `prepareSetlistName(requestedName: unknown): { name: string } | { error: string }` — always requires a non-empty result; callers decide whether to call it at all (that's how "optional on PUT" is implemented in Task 2, not inside this function).
- Modifies: `buildSetlistValue(songIds: string[], name: string): string` gains a second required parameter and includes `name` in its JSON output.
- Consumed by: Task 2's API routes.

- [ ] **Step 1: Write the failing tests**

In `src/lib/setlist.test.js`, add `prepareSetlistName` to the import list:

```js
import {
  MAX_SETLIST_SIZE,
  filterValidSongIds,
  generateSetlistId,
  buildSetlistValue,
  prepareSongIdsForCreate,
  prepareSongIdsForUpdate,
  jsonResponse,
  MAX_SETLIST_NAME_LENGTH,
  prepareSetlistName,
} from './setlist.js';
```

Update the existing `buildSetlistValue` test — it currently calls the function
with only one argument. This test currently reads:

```js
test('buildSetlistValue stores the song ids and an ISO timestamp', () => {
  const value = JSON.parse(buildSetlistValue(['a', 'b']));
  assert.deepEqual(value.songIds, ['a', 'b']);
  assert.equal(new Date(value.updatedAt).toISOString(), value.updatedAt);
});
```

Change it to:

```js
test('buildSetlistValue stores the song ids, name, and an ISO timestamp', () => {
  const value = JSON.parse(buildSetlistValue(['a', 'b'], 'Sunday Service'));
  assert.deepEqual(value.songIds, ['a', 'b']);
  assert.equal(value.name, 'Sunday Service');
  assert.equal(new Date(value.updatedAt).toISOString(), value.updatedAt);
});
```

Add these new tests at the end of the file:

```js
test('MAX_SETLIST_NAME_LENGTH is 100', () => {
  assert.equal(MAX_SETLIST_NAME_LENGTH, 100);
});

test('prepareSetlistName rejects an empty string', () => {
  const result = prepareSetlistName('');
  assert.equal(result.error, 'A set list needs a name');
});

test('prepareSetlistName rejects a whitespace-only string', () => {
  const result = prepareSetlistName('   ');
  assert.equal(result.error, 'A set list needs a name');
});

test('prepareSetlistName rejects non-string input', () => {
  assert.equal(prepareSetlistName(undefined).error, 'A set list needs a name');
  assert.equal(prepareSetlistName(null).error, 'A set list needs a name');
  assert.equal(prepareSetlistName(42).error, 'A set list needs a name');
});

test('prepareSetlistName trims and accepts a valid name', () => {
  const result = prepareSetlistName('  Sunday Service — Sept 28  ');
  assert.equal(result.name, 'Sunday Service — Sept 28');
  assert.equal(result.error, undefined);
});

test('prepareSetlistName accepts a name exactly MAX_SETLIST_NAME_LENGTH characters long', () => {
  const name = 'a'.repeat(MAX_SETLIST_NAME_LENGTH);
  const result = prepareSetlistName(name);
  assert.equal(result.name, name);
  assert.equal(result.error, undefined);
});

test('prepareSetlistName rejects a name longer than MAX_SETLIST_NAME_LENGTH characters', () => {
  const name = 'a'.repeat(MAX_SETLIST_NAME_LENGTH + 1);
  const result = prepareSetlistName(name);
  assert.equal(result.error, 'A set list name can be at most 100 characters');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/setlist.test.js`
Expected: FAIL — `prepareSetlistName`/`MAX_SETLIST_NAME_LENGTH` are not exported yet, and the updated `buildSetlistValue` test fails because `name` is `undefined` in the current implementation's output.

- [ ] **Step 3: Write the implementation**

In `src/lib/setlist.js`, change `buildSetlistValue` (currently takes one argument) to:

```js
export function buildSetlistValue(songIds, name) {
  return JSON.stringify({ songIds, name, updatedAt: new Date().toISOString() });
}
```

Add, anywhere after `MAX_SETLIST_SIZE`:

```js
export const MAX_SETLIST_NAME_LENGTH = 100;

export function prepareSetlistName(requestedName) {
  const name = typeof requestedName === 'string' ? requestedName.trim() : '';
  if (name.length === 0) {
    return { error: 'A set list needs a name' };
  }
  if (name.length > MAX_SETLIST_NAME_LENGTH) {
    return { error: `A set list name can be at most ${MAX_SETLIST_NAME_LENGTH} characters` };
  }
  return { name };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/setlist.test.js`
Expected: PASS, 22 tests (15 existing + 7 new; the `buildSetlistValue` test is a modification, not an addition, so the net new count is 7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/setlist.js src/lib/setlist.test.js
git commit -m "Add set list name validation"
```

---

## Task 2: API routes accept and preserve the name

**Files:**
- Modify: `src/pages/api/setlists/index.js`
- Modify: `src/pages/api/setlists/[id].js`

**Interfaces:**
- Consumes: `prepareSetlistName` from Task 1, alongside the already-imported `prepareSongIdsForCreate`/`prepareSongIdsForUpdate`/`generateSetlistId`/`buildSetlistValue`/`jsonResponse`.
- Produces: `POST /api/setlists` now requires `{ songIds, name }` in the body (was `{ songIds }`); `PUT /api/setlists/:id` accepts `{ songIds, name? }` (was `{ songIds }`) — `name` is optional and preserves the existing stored name when omitted. Response shapes from `GET`/`PUT` now include `name` (no route code change needed for `GET` — it already returns the raw stored value).

- [ ] **Step 1: Update the collection route**

In `src/pages/api/setlists/index.js`, this currently reads:

```js
import { prepareSongIdsForCreate, generateSetlistId, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

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

Change to:

```js
import { prepareSongIdsForCreate, prepareSetlistName, generateSetlistId, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

export async function POST({ request, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const songResult = prepareSongIdsForCreate(body.songIds, validSongIds);
  if (songResult.error) {
    return jsonResponse({ error: songResult.error }, 400);
  }

  const nameResult = prepareSetlistName(body.name);
  if (nameResult.error) {
    return jsonResponse({ error: nameResult.error }, 400);
  }

  const id = generateSetlistId();
  await kv.put(id, buildSetlistValue(songResult.songIds, nameResult.name));
  return jsonResponse({ id });
}
```

- [ ] **Step 2: Update the item route**

In `src/pages/api/setlists/[id].js`, this currently reads:

```js
import { prepareSongIdsForUpdate, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

export async function GET({ params, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const raw = await kv.get(params.id);
  if (raw === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

`GET` is unchanged (it already returns the raw stored JSON, which will include
`name` once `POST`/`PUT` start storing it). Change only the imports and `PUT`:

```js
import { prepareSongIdsForUpdate, prepareSetlistName, buildSetlistValue, jsonResponse } from '../../../lib/setlist.js';
import songs from '../../../data/songs.json';

export const prerender = false;

const validSongIds = new Set(songs.map((s) => s.id));

export async function GET({ params, locals }) {
  const kv = locals.runtime.env.SETLISTS;
  const raw = await kv.get(params.id);
  if (raw === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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

  const songResult = prepareSongIdsForUpdate(body.songIds, validSongIds);
  if (songResult.error) {
    return jsonResponse({ error: songResult.error }, 400);
  }

  let name;
  if (body.name !== undefined) {
    const nameResult = prepareSetlistName(body.name);
    if (nameResult.error) {
      return jsonResponse({ error: nameResult.error }, 400);
    }
    name = nameResult.name;
  } else {
    name = JSON.parse(existing).name;
  }

  const value = buildSetlistValue(songResult.songIds, name);
  await kv.put(params.id, value);
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 3: Verify against a real dev server**

```bash
npm run import
npx astro dev &
DEV_PID=$!
sleep 3

SONG_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('./src/data/songs.json'))[0].id)")

echo "Create without a name (expect 400):"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4321/api/setlists \
  -H "Content-Type: application/json" -d "{\"songIds\":[\"$SONG_ID\"]}"

echo "Create with a name:"
CREATE_RESPONSE=$(curl -s -X POST http://localhost:4321/api/setlists \
  -H "Content-Type: application/json" \
  -d "{\"songIds\":[\"$SONG_ID\"],\"name\":\"Sunday Service\"}")
echo "$CREATE_RESPONSE"
SET_ID=$(echo "$CREATE_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

echo "GET shows the name:"
curl -s http://localhost:4321/api/setlists/$SET_ID

echo ""
echo "PUT without a name preserves it:"
curl -s -X PUT http://localhost:4321/api/setlists/$SET_ID \
  -H "Content-Type: application/json" -d "{\"songIds\":[\"$SONG_ID\"]}"

echo ""
echo "PUT with a new name changes it:"
curl -s -X PUT http://localhost:4321/api/setlists/$SET_ID \
  -H "Content-Type: application/json" -d "{\"songIds\":[\"$SONG_ID\"],\"name\":\"Renamed\"}"

echo ""
echo "PUT with an empty name is rejected (expect 400), and name stays \"Renamed\":"
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:4321/api/setlists/$SET_ID \
  -H "Content-Type: application/json" -d "{\"songIds\":[\"$SONG_ID\"],\"name\":\"\"}"
curl -s http://localhost:4321/api/setlists/$SET_ID

kill $DEV_PID
```

Expected: create-without-name is `400`; create-with-name returns a 10-char
`id`; `GET` includes `"name":"Sunday Service"`; `PUT` without a name still
shows `"name":"Sunday Service"` afterward; `PUT` with a new name shows
`"name":"Renamed"`; `PUT` with an empty name is `400` and the final `GET`-via-body
still shows `"name":"Renamed"` (unchanged by the rejected request).

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/setlists/
git commit -m "Accept and preserve set list names in the API routes"
```

---

## Task 3: Rewrite the client-side set list helper for the library model

**Files:**
- Modify: `src/lib/setlist-client.js`

**Interfaces:**
- Removes: `getLiveSetId`, `getCurrentSetIds`, `addSongToSet`, `removeSongFromSet`, `reorderSongInSet`, `shareSet`, `startNewSet`, and the `enqueue`/`mutationQueue` machinery that only existed to serialize those now-removed live-set mutations.
- Produces:
  - `fetchSetlist(id: string): Promise<{songIds, name, updatedAt} | null>` — unchanged signature.
  - `updateSetlist(id: string, songIds: string[], name?: string): Promise<{songIds, name, updatedAt}>` — gains an optional third parameter; the request body omits `name` entirely when not provided, so the server preserves the existing name (Task 2's contract).
  - `createSetlist(songIds: string[], name: string): Promise<{id: string}>` — gains a required second parameter.
  - `getDraftIds(): string[]` — unchanged.
  - `addToDraft(songId: string): string[]` — new, synchronous, replaces `addSongToSet`'s draft branch. No network call.
  - `removeFromDraft(songId: string): string[]` — new, synchronous, replaces `removeSongFromSet`'s draft branch.
  - `reorderInDraft(songId: string, direction: -1 | 1): string[]` — new, synchronous, replaces `reorderSongInSet`'s draft branch.
  - `getPlaylists(): {id: string, name: string}[]` — new, reads the local library.
  - `isInLibrary(id: string): boolean` — new.
  - `addPlaylistToLibrary(id: string, name: string): {id, name}[]` — new, no-op if already present.
  - `removePlaylistFromLibrary(id: string): {id, name}[]` — new, local-only.
  - `updatePlaylistNameInLibrary(id: string, name: string): {id, name}[]` — new.
  - `saveDraftAsPlaylist(name: string): Promise<string>` — new; creates the set list via `createSetlist`, adds it to the library, clears the draft, returns the new id.
- Consumed by: Task 4 (home page), Task 5 (song page), Task 6 (`/set/[id]/` page).

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/lib/setlist-client.js` (currently 140 lines)
with:

```js
const DRAFT_KEY = 'songSearchSetDraft';
const PLAYLISTS_KEY = 'songSearchPlaylists';

function readIds(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function writeIds(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
}

function readPlaylists() {
  try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); }
  catch { return []; }
}

function writePlaylists(playlists) {
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists)); } catch {}
}

// --- Explicit-ID API calls, used directly by the /set/[id]/ page ---

export async function fetchSetlist(id) {
  const response = await fetch(`/api/setlists/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function updateSetlist(id, songIds, name) {
  const body = name === undefined ? { songIds } : { songIds, name };
  const response = await fetch(`/api/setlists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Failed to update set list');
  return response.json();
}

export async function createSetlist(songIds, name) {
  const response = await fetch('/api/setlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds, name }),
  });
  if (!response.ok) throw new Error('Failed to create set list');
  return response.json();
}

// --- Draft helpers: the playlist currently being built. Always local-only
// (localStorage, no network), so there's no read-modify-write race to
// guard against — unlike the old "live set" model this replaces. ---

export function getDraftIds() {
  return readIds(DRAFT_KEY);
}

export function addToDraft(songId) {
  const ids = getDraftIds();
  if (ids.includes(songId)) return ids;
  const next = [...ids, songId];
  writeIds(DRAFT_KEY, next);
  return next;
}

export function removeFromDraft(songId) {
  const next = getDraftIds().filter((id) => id !== songId);
  writeIds(DRAFT_KEY, next);
  return next;
}

export function reorderInDraft(songId, direction) {
  const ids = getDraftIds();
  const index = ids.indexOf(songId);
  if (index === -1) return ids;
  const target = index + direction;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  writeIds(DRAFT_KEY, next);
  return next;
}

// --- Library helpers: the local "My Playlists" list, keyed by playlist id.
// This is purely a per-browser bookmark list — it never affects the
// underlying set list stored server-side, which keeps existing and stays
// reachable by its link regardless of what's in anyone's local library. ---

export function getPlaylists() {
  return readPlaylists();
}

export function isInLibrary(id) {
  return readPlaylists().some((p) => p.id === id);
}

export function addPlaylistToLibrary(id, name) {
  const playlists = readPlaylists();
  if (playlists.some((p) => p.id === id)) return playlists;
  const next = [{ id, name }, ...playlists];
  writePlaylists(next);
  return next;
}

export function removePlaylistFromLibrary(id) {
  const next = readPlaylists().filter((p) => p.id !== id);
  writePlaylists(next);
  return next;
}

export function updatePlaylistNameInLibrary(id, name) {
  const next = readPlaylists().map((p) => (p.id === id ? { ...p, name } : p));
  writePlaylists(next);
  return next;
}

export async function saveDraftAsPlaylist(name) {
  const songIds = getDraftIds();
  const data = await createSetlist(songIds, name);
  addPlaylistToLibrary(data.id, name);
  writeIds(DRAFT_KEY, []);
  return data.id;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/setlist-client.js
git commit -m "Replace the live-set client model with a local playlist library"
```

---

## Task 4: Home page — "My Playlists" tab

**Files:**
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `addToDraft`, `removeFromDraft`, `reorderInDraft`, `getDraftIds`, `getPlaylists`, `removePlaylistFromLibrary`, `saveDraftAsPlaylist` from `../lib/setlist-client.js` (Task 3).

- [ ] **Step 1: Update the import line**

This currently reads:

```js
    import { normalizeTitle } from '../lib/normalize.js';
    import { addSongToSet, removeSongFromSet, reorderSongInSet, getLiveSetId, getCurrentSetIds, shareSet, startNewSet } from '../lib/setlist-client.js';
```

Change to:

```js
    import { normalizeTitle } from '../lib/normalize.js';
    import { addToDraft, removeFromDraft, reorderInDraft, getDraftIds, getPlaylists, removePlaylistFromLibrary, saveDraftAsPlaylist } from '../lib/setlist-client.js';
```

- [ ] **Step 2: Rename the tab label**

This currently reads:

```astro
    <button type="button" class="tab" data-tab="set">My Set</button>
```

Change to:

```astro
    <button type="button" class="tab" data-tab="set">My Playlists</button>
```

(The `data-tab="set"` attribute value is left as-is — it's an internal
identifier with no user-visible effect; only the label text changes.)

- [ ] **Step 3: Add CSS for the new sections**

This currently reads:

```css
    .set-controls button:disabled {
      opacity: 0.5;
      cursor: default;
    }
```

Add directly after it:

```css
    .playlist-section-label {
      grid-column: 1 / -1;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-weight: 700;
      font-size: 0.95rem;
      margin: 8px 0 -4px;
      color: var(--color-muted-foreground);
    }
    .playlist-name-input {
      flex: 1;
      min-width: 200px;
      padding: 10px 14px;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      background: var(--color-card);
      color: var(--color-card-foreground);
      font-size: 0.9rem;
    }
```

- [ ] **Step 4: Track playlists instead of set ids, and update the tab label logic**

This currently reads:

```js
    let currentTab = 'all';
    let selectedIndex = -1;
    let cachedSetIds = [];
```

Change to:

```js
    let currentTab = 'all';
    let selectedIndex = -1;
    let cachedPlaylists = [];
    let draftNameValue = '';
```

This currently reads:

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

Change to:

```js
    function updateTabLabels() {
      const favCount = getFavorites().length;
      const recentCount = getRecent().length;
      const playlistCount = cachedPlaylists.length;
      for (const btn of tabButtons) {
        const type = btn.dataset.tab;
        const label = type === 'all' ? 'All Songs'
          : type === 'favorites' ? 'Favorites'
          : type === 'recent' ? 'Recently Used'
          : 'My Playlists';
        const count = type === 'favorites' ? favCount
          : type === 'recent' ? recentCount
          : type === 'set' ? playlistCount
          : null;
        btn.textContent = count ? `${label} (${count})` : label;
      }
    }
```

(The count next to "My Playlists" is now how many playlists are saved in
the library — not how many songs are in the current draft.)

- [ ] **Step 5: Add a shared row-builder for playlist songs**

This currently reads:

```js
    function renderCurrentTab() {
```

Add directly before it:

```js
    function buildPlaylistSongRow(song, { showUp, showDown, onUp, onDown, onRemove }) {
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
      upBtn.disabled = !showUp;
      upBtn.addEventListener('click', onUp);
      controls.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = '↓';
      downBtn.disabled = !showDown;
      downBtn.addEventListener('click', onDown);
      controls.appendChild(downBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', onRemove);
      controls.appendChild(removeBtn);

      li.appendChild(controls);
      return li;
    }
```

- [ ] **Step 6: Replace `renderSetTab` with `renderPlaylistsTab`**

This entire function currently reads (from `async function renderSetTab() {`
through its closing `}`, just before `function renderCurrentTab() {`):

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
          shareBtn.disabled = true;
          try {
            const id = await shareSet();
            location.href = `/set/${id}/`;
          } catch {
            shareBtn.disabled = setSongs.length === 0;
            showTransientStatus('Could not share this set — check your connection and try again.');
          }
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
          try {
            cachedSetIds = await reorderSongInSet(song.id, -1);
            renderSetTab();
          } catch {
            showTransientStatus('Could not save that change — check your connection and try again.');
          }
        });
        controls.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.textContent = '↓';
        downBtn.disabled = index === setSongs.length - 1;
        downBtn.addEventListener('click', async () => {
          try {
            cachedSetIds = await reorderSongInSet(song.id, 1);
            renderSetTab();
          } catch {
            showTransientStatus('Could not save that change — check your connection and try again.');
          }
        });
        controls.appendChild(downBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', async () => {
          try {
            cachedSetIds = await removeSongFromSet(song.id);
            renderSetTab();
          } catch {
            showTransientStatus('Could not save that change — check your connection and try again.');
          }
        });
        controls.appendChild(removeBtn);

        li.appendChild(controls);
        results.appendChild(li);
      });
    }
```

Replace the entire function with:

```js
    function renderPlaylistsTab() {
      showTabs();
      pagination.style.display = 'none';
      results.replaceChildren();
      selectedIndex = -1;

      cachedPlaylists = getPlaylists();
      updateTabLabels();

      const draftIds = getDraftIds();
      const draftSongs = draftIds.map((id) => songById.get(id)).filter(Boolean);

      if (draftSongs.length === 0 && cachedPlaylists.length === 0) {
        status.textContent = 'No songs in your draft yet — use the + button on any song to add one.';
      } else {
        status.textContent = `${draftSongs.length} song${draftSongs.length === 1 ? '' : 's'} in your current draft`;
      }

      const buildingLabel = document.createElement('li');
      buildingLabel.className = 'playlist-section-label';
      buildingLabel.textContent = 'Currently building';
      results.appendChild(buildingLabel);

      const controlsLi = document.createElement('li');
      controlsLi.className = 'set-controls';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Name this playlist (e.g. Sunday Service — Sept 28)';
      nameInput.className = 'playlist-name-input';
      nameInput.value = draftNameValue;

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save';

      function updateSaveDisabled() {
        saveBtn.disabled = draftSongs.length === 0 || nameInput.value.trim().length === 0;
      }
      updateSaveDisabled();

      nameInput.addEventListener('input', () => {
        draftNameValue = nameInput.value;
        updateSaveDisabled();
      });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          await saveDraftAsPlaylist(nameInput.value.trim());
          draftNameValue = '';
          renderPlaylistsTab();
        } catch {
          updateSaveDisabled();
          showTransientStatus('Could not save this playlist — check your connection and try again.');
        }
      });

      controlsLi.appendChild(nameInput);
      controlsLi.appendChild(saveBtn);
      results.appendChild(controlsLi);

      draftSongs.forEach((song, index) => {
        const li = buildPlaylistSongRow(song, {
          showUp: index > 0,
          showDown: index < draftSongs.length - 1,
          onUp: () => { reorderInDraft(song.id, -1); renderPlaylistsTab(); },
          onDown: () => { reorderInDraft(song.id, 1); renderPlaylistsTab(); },
          onRemove: () => { removeFromDraft(song.id); renderPlaylistsTab(); },
        });
        results.appendChild(li);
      });

      const libraryLabel = document.createElement('li');
      libraryLabel.className = 'playlist-section-label';
      libraryLabel.textContent = 'Your Playlists';
      results.appendChild(libraryLabel);

      if (cachedPlaylists.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'set-controls';
        emptyLi.textContent = "You haven't saved any playlists yet.";
        results.appendChild(emptyLi);
      } else {
        for (const playlist of cachedPlaylists) {
          const li = document.createElement('li');
          li.className = 'set-controls';

          const link = document.createElement('a');
          link.href = `/set/${playlist.id}/`;
          link.textContent = playlist.name;
          li.appendChild(link);

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => {
            removePlaylistFromLibrary(playlist.id);
            renderPlaylistsTab();
          });
          li.appendChild(removeBtn);

          results.appendChild(li);
        }
      }
    }
```

- [ ] **Step 7: Update `renderCurrentTab` to call the renamed function**

This currently reads:

```js
    function renderCurrentTab() {
      if (currentTab === 'favorites') renderFavoritesTab();
      else if (currentTab === 'recent') renderRecentTab();
      else if (currentTab === 'set') renderSetTab();
      else renderBrowse(1);
    }
```

Change to:

```js
    function renderCurrentTab() {
      if (currentTab === 'favorites') renderFavoritesTab();
      else if (currentTab === 'recent') renderRecentTab();
      else if (currentTab === 'set') renderPlaylistsTab();
      else renderBrowse(1);
    }
```

- [ ] **Step 8: Update the "+" button on result cards**

This currently reads (inside `buildCard`):

```js
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
```

Change to:

```js
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        addToDraft(song.id);
        showTransientStatus(`Added "${song.title}" to your draft`);
        if (currentTab === 'set') renderPlaylistsTab();
      });
```

(No more `try`/`catch` or `async` — `addToDraft` is a synchronous
`localStorage` write with no network call, so there's nothing that can
fail here the way a live-set `PUT` could.)

- [ ] **Step 9: Update the initial-load code**

This currently reads (near the bottom of the script):

```js
    updateTabLabels();
    getCurrentSetIds().then((ids) => {
      cachedSetIds = ids;
      updateTabLabels();
    });
```

Change to:

```js
    cachedPlaylists = getPlaylists();
    updateTabLabels();
```

(This is synchronous now — no `.then()` needed, since `getPlaylists()` is a
plain `localStorage` read.)

- [ ] **Step 10: Manual verification against the dev server**

Run `npx astro dev`, then in a browser:
1. Click "+" on two different result cards. Confirm a transient "Added ... to your draft" message each time.
2. Click "My Playlists". Confirm both songs appear under "Currently building" with working ↑/↓/Remove, an empty "Your Playlists" section below saying "You haven't saved any playlists yet," and the Save button disabled until you type a name.
3. Type a name, click Save. Confirm "Currently building" clears back to empty, and the new playlist appears under "Your Playlists" with the name you typed, and the tab label now reads "My Playlists (1)".
4. Click the new playlist's link — confirm it opens `/set/<id>/` with both songs present.
5. Go back to `/`, add a third song via "+", click "My Playlists" — confirm the previously-saved playlist is still listed (unaffected), and the new song is in a fresh "Currently building" section.
6. Click "Remove" on the saved playlist in "Your Playlists" — confirm it disappears from the list, but visiting its `/set/<id>/` link directly still works.

Stop the dev server afterward.

- [ ] **Step 11: Commit**

```bash
git add src/pages/index.astro
git commit -m "Turn the home page's My Set tab into a My Playlists library"
```

---

## Task 5: Song page — "Add to Set" targets the draft

**Files:**
- Modify: `src/pages/song/[slug].astro`

**Interfaces:**
- Consumes: `addToDraft` from `../../lib/setlist-client.js` (Task 3), replacing `addSongToSet`.

- [ ] **Step 1: Update the click handler**

This currently reads (in the second `<script>` tag, after the
`define:vars` script — leave that first script tag completely untouched,
same as before):

```js
  <script>
    import { addSongToSet } from '../../lib/setlist-client.js';

    const addToSetBtn = document.getElementById('add-to-set');
    const addToSetDefaultText = addToSetBtn.textContent;
    addToSetBtn.addEventListener('click', async () => {
      addToSetBtn.disabled = true;
      try {
        await addSongToSet(addToSetBtn.dataset.songId);
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

Change to:

```js
  <script>
    import { addToDraft } from '../../lib/setlist-client.js';

    const addToSetBtn = document.getElementById('add-to-set');
    const addToSetDefaultText = addToSetBtn.textContent;
    addToSetBtn.addEventListener('click', () => {
      addToDraft(addToSetBtn.dataset.songId);
      addToSetBtn.textContent = 'Added!';
      setTimeout(() => {
        addToSetBtn.textContent = addToSetDefaultText;
      }, 1500);
    });
  </script>
```

(No more `disabled` toggling or `try`/`catch` — `addToDraft` is a
synchronous, always-succeeds-or-silently-no-ops `localStorage` write, same
reasoning as Task 4 Step 8.)

- [ ] **Step 2: Manual verification against the dev server**

Run `npx astro dev`, open any song page, click "Add to Set". Confirm the
button reads "Added!" then reverts after ~1.5s, with no `disabled` state
visible. Go to the home page's "My Playlists" tab and confirm the song
appears under "Currently building". Stop the dev server afterward.

- [ ] **Step 3: Commit**

```bash
git add "src/pages/song/[slug].astro"
git commit -m "Song page's Add to Set button targets the draft"
```

---

## Task 6: `/set/[id]/` — name display, rename, and Save to My Playlists

**Files:**
- Modify: `src/pages/set/[id].astro`

**Interfaces:**
- Consumes: `updateSetlist` (already used, now also passed a `name` argument
  for renames), `isInLibrary`, `addPlaylistToLibrary`,
  `updatePlaylistNameInLibrary` from `../../lib/setlist-client.js` (Task 3).

- [ ] **Step 1: Parse the stored name, with a fallback for old data**

This currently reads:

```astro
const { id } = Astro.params;
const kv = Astro.locals.runtime.env.SETLISTS;
const raw = await kv.get(id);

let initialSongIds = [];
if (raw) {
  initialSongIds = JSON.parse(raw).songIds;
}

const songsJson = JSON.stringify(songs.map(({ id, slug, title, author }) => ({ id, slug, title, author })))
  .replace(/</g, '\\u003c');
---
<Layout title="Set List — Song Search" description="A shared, editable list of songs.">
```

Change to:

```astro
const { id } = Astro.params;
const kv = Astro.locals.runtime.env.SETLISTS;
const raw = await kv.get(id);

let initialSongIds = [];
let initialName = 'Untitled Set';
if (raw) {
  const data = JSON.parse(raw);
  initialSongIds = data.songIds;
  initialName = data.name || 'Untitled Set';
}

const songsJson = JSON.stringify(songs.map(({ id, slug, title, author }) => ({ id, slug, title, author })))
  .replace(/</g, '\\u003c');
---
<Layout title={raw === null ? 'Set List — Song Search' : `${initialName} — Song Search`} description="A shared, editable list of songs.">
```

- [ ] **Step 2: Show the name in the heading, with rename and Save-to-library controls**

This currently reads:

```astro
      <div id="set-app">
        <h1>Set List</h1>
        <div class="actions">
          <button id="copy-link">Copy link</button>
        </div>
        <p id="status"></p>
        <ul id="set-songs"></ul>
```

Change to:

```astro
      <div id="set-app">
        <h1>
          <span id="playlist-name">{initialName}</span>
          <input type="text" id="rename-input" value={initialName} hidden />
        </h1>
        <div class="actions">
          <button id="rename-btn">Rename</button>
          <button id="copy-link">Copy link</button>
          <button id="save-to-library">Save to My Playlists</button>
        </div>
        <p id="status"></p>
        <ul id="set-songs"></ul>
```

- [ ] **Step 3: Add a style for the rename input**

This currently reads:

```css
    #copy-link:hover { opacity: 0.85; }
```

Add directly after it:

```css
    #rename-input {
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-weight: 800;
      font-size: 1.5rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 4px 8px;
      width: 100%;
      max-width: 400px;
    }
```

- [ ] **Step 4: Pass the name through to the client script, and wire up rename + Save to My Playlists**

This currently reads:

```astro
  <script type="application/json" id="songs-data" set:html={songsJson} />
  <script type="application/json" id="set-init-data" set:html={JSON.stringify({ setId: id, initialSongIds })} />
  <script>
    import { updateSetlist } from '../../lib/setlist-client.js';

    const setSongsList = document.getElementById('set-songs');

    if (setSongsList) {
      const data = JSON.parse(document.getElementById('songs-data').textContent);
      const songById = new Map(data.map((song) => [song.id, song]));
      const { setId, initialSongIds } = JSON.parse(document.getElementById('set-init-data').textContent);
      let currentIds = initialSongIds;
      const statusEl = document.getElementById('status');
```

Change to:

```astro
  <script type="application/json" id="songs-data" set:html={songsJson} />
  <script type="application/json" id="set-init-data" set:html={JSON.stringify({ setId: id, initialSongIds, initialName })} />
  <script>
    import { updateSetlist, isInLibrary, addPlaylistToLibrary, updatePlaylistNameInLibrary } from '../../lib/setlist-client.js';

    const setSongsList = document.getElementById('set-songs');

    if (setSongsList) {
      const data = JSON.parse(document.getElementById('songs-data').textContent);
      const songById = new Map(data.map((song) => [song.id, song]));
      const { setId, initialSongIds, initialName } = JSON.parse(document.getElementById('set-init-data').textContent);
      let currentIds = initialSongIds;
      let currentName = initialName;
      const statusEl = document.getElementById('status');
```

This currently reads (immediately after `renderSetSongs();` and before the
`add-search` wiring):

```js
      renderSetSongs();

      const addInput = document.getElementById('add-search');
```

Change to:

```js
      renderSetSongs();

      const nameSpan = document.getElementById('playlist-name');
      const renameInput = document.getElementById('rename-input');
      const renameBtn = document.getElementById('rename-btn');

      renameBtn.addEventListener('click', () => {
        if (renameInput.hidden) {
          renameInput.value = currentName;
          nameSpan.hidden = true;
          renameInput.hidden = false;
          renameInput.focus();
          renameInput.select();
          renameBtn.textContent = 'Save name';
          return;
        }

        const newName = renameInput.value.trim();
        if (!newName) {
          statusEl.textContent = 'A playlist needs a name.';
          return;
        }
        renameBtn.disabled = true;
        updateSetlist(setId, currentIds, newName)
          .then(() => {
            currentName = newName;
            nameSpan.textContent = currentName;
            if (isInLibrary(setId)) updatePlaylistNameInLibrary(setId, currentName);
            document.title = `${currentName} — Song Search`;
            nameSpan.hidden = false;
            renameInput.hidden = true;
            renameBtn.textContent = 'Rename';
          })
          .catch(() => {
            statusEl.textContent = 'Could not save the new name. Check your connection and try again.';
          })
          .finally(() => {
            renameBtn.disabled = false;
          });
      });

      const saveToLibraryBtn = document.getElementById('save-to-library');
      function updateSaveToLibraryButton() {
        if (isInLibrary(setId)) {
          saveToLibraryBtn.textContent = '✓ Saved';
          saveToLibraryBtn.disabled = true;
        } else {
          saveToLibraryBtn.textContent = 'Save to My Playlists';
          saveToLibraryBtn.disabled = false;
        }
      }
      updateSaveToLibraryButton();
      saveToLibraryBtn.addEventListener('click', () => {
        addPlaylistToLibrary(setId, currentName);
        updateSaveToLibraryButton();
      });

      const addInput = document.getElementById('add-search');
```

- [ ] **Step 5: Manual verification against the dev server**

```bash
npx astro dev &
DEV_PID=$!
sleep 3

SONG_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('./src/data/songs.json'))[0].id)")
SET_ID=$(curl -s -X POST http://localhost:4321/api/setlists -H "Content-Type: application/json" -d "{\"songIds\":[\"$SONG_ID\"],\"name\":\"Test Playlist\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

curl -s "http://localhost:4321/set/$SET_ID/" | grep -o "Test Playlist"

kill $DEV_PID
```

Expected: the grep finds `Test Playlist` (confirms the name renders
server-side). Then in a real browser at `http://localhost:4321/set/<that id>/`:
1. Confirm the heading shows "Test Playlist" and the "Save to My Playlists"
   button is present (this browser hasn't saved it locally yet, since it was
   created via `curl`).
2. Click "Save to My Playlists" — confirm it changes to "✓ Saved" and is
   disabled. Go to the home page's "My Playlists" tab — confirm "Test
   Playlist" now appears in "Your Playlists".
3. Back on the set page, click "Rename", change the text, click "Save name" —
   confirm the heading updates, the browser tab title updates, and the "My
   Playlists" tab's library entry shows the new name without a reload.
4. Reload the set page directly — confirm the new name persisted (server-side).

Stop the dev server afterward if still running.

- [ ] **Step 6: Commit**

```bash
git add "src/pages/set/[id].astro"
git commit -m "Add playlist name display, rename, and Save to My Playlists"
```

---

## Task 7: End-to-end verification of the playlist library

**Files:**
- None created (temporary Playwright script only, written to the job
  scratch directory and removed after use, per this project's established
  testing pattern).

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

Write a script (in this project's scratch-directory convention) with this
content:

```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const base = 'http://localhost:4321';

  // Context A: build a draft, name it, save it
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto(base + '/');
  await pageA.waitForSelector('#results li');

  const addButtons = await pageA.$$('.add-to-set-btn');
  await addButtons[0].click();
  await pageA.waitForTimeout(200);
  await addButtons[1].click();
  await pageA.waitForTimeout(200);

  await pageA.click('.tab[data-tab="set"]');
  await pageA.waitForTimeout(200);
  const draftTitlesBeforeSave = await pageA.$$eval('.set-song-row a', (els) => els.map((e) => e.textContent));
  console.log('Draft before save:', draftTitlesBeforeSave);

  await pageA.fill('.playlist-name-input', 'E2E Test Playlist');
  await pageA.click('button:has-text("Save")');
  await pageA.waitForTimeout(300);

  const draftTitlesAfterSave = await pageA.$$eval('.set-song-row a', (els) => els.map((e) => e.textContent));
  console.log('Draft after save (expect empty):', draftTitlesAfterSave);
  const libraryLinkText = await pageA.$eval('.set-controls a', (el) => el.textContent);
  console.log('Library entry name:', libraryLinkText);
  const playlistHref = await pageA.$eval('.set-controls a', (el) => el.getAttribute('href'));
  const playlistUrl = base + playlistHref;
  console.log('Playlist URL:', playlistUrl);

  // Context B: a different browser context opens the same link (hasn't saved it locally)
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(playlistUrl);
  const headingText = await pageB.$eval('#playlist-name', (el) => el.textContent);
  console.log('Context B sees heading:', headingText);
  const saveButtonText = await pageB.$eval('#save-to-library', (el) => el.textContent);
  console.log('Context B Save-to-library button (expect not yet saved):', saveButtonText);

  await pageB.click('#save-to-library');
  await pageB.waitForTimeout(200);
  const saveButtonTextAfter = await pageB.$eval('#save-to-library', (el) => el.textContent);
  console.log('Context B Save-to-library button after click:', saveButtonTextAfter);

  await pageB.goto(base + '/');
  await pageB.waitForSelector('#results li');
  await pageB.click('.tab[data-tab="set"]');
  await pageB.waitForTimeout(200);
  const contextBLibrary = await pageB.$$eval('.set-controls a', (els) => els.map((e) => e.textContent));
  console.log('Context B library after saving:', contextBLibrary);

  // Rename from context B, confirm it shows up in context B's library list
  await pageB.goto(playlistUrl);
  await pageB.click('#rename-btn');
  await pageB.fill('#rename-input', 'Renamed E2E Playlist');
  await pageB.click('#rename-btn');
  await pageB.waitForTimeout(300);
  const renamedHeading = await pageB.$eval('#playlist-name', (el) => el.textContent);
  console.log('Heading after rename:', renamedHeading);

  await pageB.goto(base + '/');
  await pageB.waitForSelector('#results li');
  await pageB.click('.tab[data-tab="set"]');
  await pageB.waitForTimeout(200);
  const libraryAfterRename = await pageB.$$eval('.set-controls a', (els) => els.map((e) => e.textContent));
  console.log('Context B library after rename:', libraryAfterRename);

  // Remove from context B's library, confirm the link still works
  const removeBtns = await pageB.$$('.set-controls button:has-text("Remove")');
  await removeBtns[0].click();
  await pageB.waitForTimeout(200);
  const libraryAfterRemove = await pageB.$$eval('.set-controls a', (els) => els.map((e) => e.textContent));
  console.log('Context B library after remove:', libraryAfterRemove);

  await pageB.goto(playlistUrl);
  const headingStillWorks = await pageB.$eval('#playlist-name', (el) => el.textContent);
  console.log('Playlist link still works after local removal, heading:', headingStillWorks);

  await browser.close();
})();
```

Run it with Node, then check the printed output for:
- `Draft before save:` lists 2 titles
- `Draft after save (expect empty):` is `[]`
- `Library entry name:` is `E2E Test Playlist`
- `Context B sees heading:` is `E2E Test Playlist`
- `Context B Save-to-library button (expect not yet saved):` is `Save to My Playlists`
- `Context B Save-to-library button after click:` is `✓ Saved`
- `Context B library after saving:` includes `E2E Test Playlist`
- `Heading after rename:` is `Renamed E2E Playlist`
- `Context B library after rename:` shows `Renamed E2E Playlist` (not the old name)
- `Context B library after remove:` is `[]`
- `Playlist link still works after local removal, heading:` is `Renamed E2E Playlist`

- [ ] **Step 4: Stop the dev server and clean up**

```bash
kill $DEV_PID
```

Remove the temporary Playwright script file (it was written to job scratch,
not the repo).

- [ ] **Step 5: Uninstall Playwright and revert lockfile drift**

```bash
npm uninstall playwright
git checkout -- package-lock.json
git status --porcelain
```

Expected: clean working tree.

- [ ] **Step 6: Re-run the full test suite one more time**

Run: `npm test`
Expected: all unit tests still pass (56 tests: 49 from before this feature
+ 7 new from Task 1).

No commit for this task — it produces no source changes, only verification.

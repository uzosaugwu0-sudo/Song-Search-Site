# Service List Sections and Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a service list hold custom named sections (headings) and show a created date on every list.

**Architecture:** A list's existing `songIds` array becomes an ordered `Item[]` where an item is a song id string or a heading object `{ section: string }`, so old lists stay valid with no migration. A new dependency-free `src/lib/sections.js` holds the helpers shared by server and browser; `src/lib/setlist.js` gains validation, `createdAt` and listing logic; the API routes and two pages are wired to them.

**Tech Stack:** Astro 5 on Cloudflare Workers, KV (`SETLISTS`), plain browser JS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-service-list-sections-and-dates-design.md`

## Global Constraints

- All paths are relative to the repo root `C:\Users\osaug\claude` (git root). Run every command from there.
- Windows + Git Bash. Use `python` with `PYTHONUTF8=1` for scripted file edits (source files contain non-ASCII characters such as `←` and `…`). Keep shell commands short; very long single commands fail on Windows with ENAMETOOLONG, so write large files with the file-writing tool.
- Stored list value: `{ name, songIds: Item[], createdAt, updatedAt, deleted? }`. The key stays named `songIds`.
- `Item = string | { section: string }`.
- Limits: at most 50 songs (`MAX_SETLIST_SIZE`, unchanged), at most 10 headings (`MAX_SETLIST_SECTIONS`), heading text 1-60 characters after trim (`MAX_SECTION_NAME_LENGTH`).
- A song id appears at most once per list.
- `createdAt` is set once and never changes; `updatedAt` changes on every save. Legacy lists: effective date is `createdAt ?? updatedAt`.
- KV metadata is `{ name, count, createdAt, updatedAt }`; `count` counts songs only.
- Public listing sorts by created date, newest first.
- Sections are fully custom: lists start with none. No drag-and-drop, no templates, no bulk migration script.
- Use `textContent` (never `innerHTML`) for any section or list name.
- Tests: `npm test` (runs `node --test scripts/*.test.js src/lib/*.test.js`). Baseline before this plan: 102 tests pass.
- Do not deploy as part of this plan. Commit locally after each task; do not push.

## Review Focus

- A request whose only items are headings (no songs) on create must be rejected ("needs at least one song").
- A heading with empty/whitespace text, or over 60 characters, must return a 400 error, not be silently kept.
- More than 10 headings must be rejected with a clear error.
- Heading objects with extra keys must be stripped to `{ section }`; non-object junk items must be dropped, not crash.
- Duplicate heading names are allowed; duplicate song ids are collapsed to the first.
- Legacy lists with no `createdAt` must show their `updatedAt` as the date, and the listing backfill must not change `updatedAt`.
- Renaming a list or editing songs (PUT) must keep `createdAt`; a soft-deleted list must keep it too.
- A section name containing `<script>` or HTML must render as plain text.
- An existing browser draft stored as plain song-id strings must still load and save.
- Removing a heading must keep its songs; the song count must exclude headings.

---

## File Structure

- Create `src/lib/sections.js` - pure, dependency-free helpers shared by server and browser: constants, `isHeading`, `countSongs`, `addHeading`, `renameHeading`, `removeAt`, `moveItem`, `askSectionName`.
- Create `src/lib/sections.test.js` - unit tests for the above.
- Modify `src/lib/setlist.js` - item validation, `createdAt`, metadata, listing sort, `formatListDate`.
- Modify `src/lib/setlist.test.js` - updated and new tests.
- Modify `src/lib/setlist-client.js` - add `updateDraft`.
- Modify `src/pages/api/setlists/index.js` and `src/pages/api/setlists/[id].js` - preserve `createdAt`, richer backfill.
- Modify `src/pages/set/[id].astro` - date, heading rows, Add section.
- Modify `src/pages/index.astro` - draft headings, dates in both lists, `createdAt` on the optimistic entry.

---

### Task 1: Shared section helpers

**Files:**
- Create: `src/lib/sections.js`
- Create: `src/lib/sections.test.js`

**Interfaces:**
- Produces (used by Tasks 2-5):
  - `MAX_SETLIST_SECTIONS = 10`, `MAX_SECTION_NAME_LENGTH = 60`
  - `isHeading(item): boolean`
  - `countSongs(items): number`
  - `addHeading(items, name): Item[]` (new array)
  - `renameHeading(items, index, name): Item[]` (new array)
  - `removeAt(items, index): Item[]` (new array)
  - `moveItem(items, index, direction): Item[]` (new array; same contents if out of range)
  - `askSectionName(current = ''): string | null` (browser-only; uses `window.prompt`)

- [ ] **Step 1: Write the failing test**

Create `src/lib/sections.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETLIST_SECTIONS,
  MAX_SECTION_NAME_LENGTH,
  isHeading,
  countSongs,
  addHeading,
  renameHeading,
  removeAt,
  moveItem,
} from './sections.js';

test('limits are 10 sections and 60 characters', () => {
  assert.equal(MAX_SETLIST_SECTIONS, 10);
  assert.equal(MAX_SECTION_NAME_LENGTH, 60);
});

test('isHeading is true only for objects with a string section', () => {
  assert.equal(isHeading({ section: 'Praise' }), true);
  assert.equal(isHeading('song1'), false);
  assert.equal(isHeading(null), false);
  assert.equal(isHeading({ section: 5 }), false);
  assert.equal(isHeading({}), false);
});

test('countSongs ignores headings', () => {
  assert.equal(countSongs(['a', { section: 'Praise' }, 'b']), 2);
  assert.equal(countSongs([]), 0);
});

test('addHeading appends a heading without mutating the input', () => {
  const items = ['a'];
  const next = addHeading(items, 'Praise');
  assert.deepEqual(next, ['a', { section: 'Praise' }]);
  assert.deepEqual(items, ['a']);
});

test('renameHeading renames only a heading at that index', () => {
  const items = ['a', { section: 'Old' }];
  assert.deepEqual(renameHeading(items, 1, 'New'), ['a', { section: 'New' }]);
  assert.deepEqual(renameHeading(items, 0, 'New'), items);
});

test('removeAt drops one item and keeps the rest in order', () => {
  const items = ['a', { section: 'Praise' }, 'b'];
  assert.deepEqual(removeAt(items, 1), ['a', 'b']);
  assert.equal(items.length, 3);
});

test('moveItem swaps with the neighbour, including across a heading', () => {
  const items = ['a', { section: 'Praise' }, 'b'];
  assert.deepEqual(moveItem(items, 2, -1), ['a', 'b', { section: 'Praise' }]);
  assert.deepEqual(moveItem(items, 0, 1), [{ section: 'Praise' }, 'a', 'b']);
});

test('moveItem returns an unchanged copy when the move is out of range', () => {
  const items = ['a', 'b'];
  assert.deepEqual(moveItem(items, 0, -1), ['a', 'b']);
  assert.deepEqual(moveItem(items, 1, 1), ['a', 'b']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/sections.test.js`
Expected: FAIL (cannot find module `./sections.js`).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/sections.js`:

```js
// Pure helpers for service lists that contain section headings.
// A list is an ordered array of items: a song id string, or a heading { section }.
// No imports on purpose: this file is used by both the Worker and the browser.

export const MAX_SETLIST_SECTIONS = 10;
export const MAX_SECTION_NAME_LENGTH = 60;

export function isHeading(item) {
  return item !== null && typeof item === 'object' && typeof item.section === 'string';
}

export function countSongs(items) {
  return items.filter((item) => typeof item === 'string').length;
}

export function addHeading(items, name) {
  return [...items, { section: name }];
}

export function renameHeading(items, index, name) {
  return items.map((item, i) => (i === index && isHeading(item) ? { section: name } : item));
}

export function removeAt(items, index) {
  return items.filter((_, i) => i !== index);
}

export function moveItem(items, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length || index < 0 || index >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Browser only. Returns a trimmed, length-capped name, or null if cancelled/empty.
export function askSectionName(current = '') {
  const answer = window.prompt('Section name (e.g. Opening Worship, Praise, Closing Worship)', current);
  const name = answer === null ? '' : answer.trim().slice(0, MAX_SECTION_NAME_LENGTH);
  return name || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/sections.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sections.js src/lib/sections.test.js
git commit -m "feat: shared section helpers for service lists"
```

---

### Task 2: Server logic - validation, createdAt, listing, dates

**Files:**
- Modify: `src/lib/setlist.js`
- Modify: `src/lib/setlist.test.js`

**Interfaces:**
- Consumes: `isHeading`, `countSongs`, `MAX_SETLIST_SECTIONS`, `MAX_SECTION_NAME_LENGTH` from `./sections.js`.
- Produces (used by Tasks 3-5):
  - `filterValidItems(items, validIds): Item[]` (replaces `filterValidSongIds`; keeps valid songs deduped, keeps valid headings as `{ section: trimmed }`, drops everything else)
  - `prepareSongIdsForCreate(requested, validIds): { songIds } | { error }` and `prepareSongIdsForUpdate(...)` (same names and return key as before; `songIds` is now an `Item[]`)
  - `buildSetlistValue(songIds, name, createdAt?, updatedAt?): string`
  - `buildSetlistMetadata(songIds, name, createdAt, updatedAt): { name, count, createdAt, updatedAt }`
  - `putSetlist(kv, id, songIds, name, { createdAt?, updatedAt? } = {}): Promise<string>`
  - `toListEntries(keys): { id, name, count, createdAt, updatedAt }[]`
  - `formatListDate(iso): string` (empty string for missing/invalid input)

- [ ] **Step 1: Update the existing tests and write the new failing tests**

In `src/lib/setlist.test.js`:

1. Rename every `filterValidSongIds` to `filterValidItems` (import list and the existing calls):

```bash
sed -i 's/filterValidSongIds/filterValidItems/g' src/lib/setlist.test.js
```

2. Replace the existing `buildSetlistMetadata` test (named `buildSetlistMetadata summarises name, count and updatedAt`) with:

```js
test('buildSetlistMetadata summarises name, song count, createdAt and updatedAt', () => {
  assert.deepEqual(
    buildSetlistMetadata(['a', { section: 'Praise' }, 'b'], 'Sunday', '2026-10-01T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
    { name: 'Sunday', count: 2, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z' },
  );
});
```

3. Append these new tests at the end of the file (the new `import` line is hoisted, matching how this file already imports a second block mid-file):

```js
import { putSetlist, formatListDate } from './setlist.js';

test('filterValidItems keeps headings trimmed, strips extra keys, and drops bad headings', () => {
  const valid = new Set(['a', 'b']);
  const items = ['a', { section: '  Praise  ', extra: 1 }, { section: '   ' }, { section: 'x'.repeat(61) }, 'b'];
  assert.deepEqual(filterValidItems(items, valid), ['a', { section: 'Praise' }, 'b']);
});

test('filterValidItems collapses duplicate song ids but allows duplicate headings', () => {
  const valid = new Set(['a']);
  const items = ['a', { section: 'Praise' }, 'a', { section: 'Praise' }];
  assert.deepEqual(filterValidItems(items, valid), ['a', { section: 'Praise' }, { section: 'Praise' }]);
});

test('prepareSongIdsForCreate rejects a list with headings but no songs', () => {
  const result = prepareSongIdsForCreate([{ section: 'Praise' }], new Set(['a']));
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate accepts songs with headings', () => {
  const result = prepareSongIdsForCreate([{ section: 'Praise' }, 'a'], new Set(['a']));
  assert.deepEqual(result.songIds, [{ section: 'Praise' }, 'a']);
});

test('prepareSongIdsForUpdate rejects an empty or overlong section name', () => {
  const valid = new Set(['a']);
  assert.equal(prepareSongIdsForUpdate(['a', { section: '  ' }], valid).error, 'A section name must be 1-60 characters');
  assert.equal(prepareSongIdsForUpdate(['a', { section: 'x'.repeat(61) }], valid).error, 'A section name must be 1-60 characters');
});

test('prepareSongIdsForUpdate rejects more than 10 sections but allows exactly 10', () => {
  const valid = new Set(['a']);
  const tenHeadings = Array.from({ length: 10 }, (_, i) => ({ section: `S${i}` }));
  assert.equal(prepareSongIdsForUpdate(tenHeadings, valid).error, undefined);
  const elevenHeadings = [...tenHeadings, { section: 'S10' }];
  assert.equal(prepareSongIdsForUpdate(elevenHeadings, valid).error, 'A set list can have at most 10 sections');
});

test('headings do not count toward the 50-song limit', () => {
  const valid = new Set(Array.from({ length: 50 }, (_, i) => `id${i}`));
  const items = [{ section: 'A' }, ...Array.from({ length: 50 }, (_, i) => `id${i}`)];
  assert.equal(prepareSongIdsForUpdate(items, valid).error, undefined);
});

test('buildSetlistValue defaults createdAt to updatedAt and keeps a supplied createdAt', () => {
  const fresh = JSON.parse(buildSetlistValue(['a'], 'X'));
  assert.equal(fresh.createdAt, fresh.updatedAt);
  const edited = JSON.parse(buildSetlistValue(['a'], 'X', '2026-01-01T00:00:00.000Z'));
  assert.equal(edited.createdAt, '2026-01-01T00:00:00.000Z');
  assert.notEqual(edited.updatedAt, edited.createdAt);
});

test('putSetlist writes the value and matching metadata, preserving supplied dates', async () => {
  const calls = [];
  const kv = { put: async (...args) => { calls.push(args); } };
  const value = await putSetlist(kv, 'id1', ['a', { section: 'S' }], 'Name', {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'id1');
  assert.deepEqual(JSON.parse(calls[0][1]), JSON.parse(value));
  assert.deepEqual(calls[0][2].metadata, {
    name: 'Name', count: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z',
  });
});

test('toListEntries falls back to updatedAt for legacy lists and sorts by created date', () => {
  const keys = [
    { name: 'legacy', metadata: { name: 'Legacy', count: 1, updatedAt: '2026-03-01T00:00:00.000Z' } },
    { name: 'newer', metadata: { name: 'Newer', count: 1, createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' } },
    { name: 'edited', metadata: { name: 'Edited', count: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' } },
  ];
  const entries = toListEntries(keys);
  assert.deepEqual(entries.map((e) => e.id), ['newer', 'legacy', 'edited']);
  assert.equal(entries[1].createdAt, '2026-03-01T00:00:00.000Z');
});

test('formatListDate formats an ISO date and returns empty for bad input', () => {
  assert.match(formatListDate('2026-10-12T12:00:00.000Z'), /^Oct 1[12], 2026$/);
  assert.equal(formatListDate(undefined), '');
  assert.equal(formatListDate('not a date'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/setlist.test.js`
Expected: FAIL (`filterValidItems`, `putSetlist` options and `formatListDate` are not implemented yet).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/setlist.js` make these changes (everything else stays):

1. Add this as the first line of the file:

```js
import { isHeading, countSongs, MAX_SETLIST_SECTIONS, MAX_SECTION_NAME_LENGTH } from './sections.js';
```

2. Replace `filterValidSongIds` with:

```js
export function filterValidItems(items, validIds) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (isHeading(item)) {
      const section = item.section.trim();
      if (section.length > 0 && section.length <= MAX_SECTION_NAME_LENGTH) result.push({ section });
    } else if (typeof item === 'string' && validIds.has(item) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}
```

3. Replace `buildSetlistValue` with:

```js
export function buildSetlistValue(songIds, name, createdAt, updatedAt = new Date().toISOString()) {
  return JSON.stringify({ songIds, name, createdAt: createdAt ?? updatedAt, updatedAt });
}
```

4. Replace `prepareSongIdsForCreate` and `prepareSongIdsForUpdate` with:

```js
function checkItems(requested, validIds) {
  if (Array.isArray(requested)) {
    const badHeading = requested.find((item) => {
      if (!isHeading(item)) return false;
      const length = item.section.trim().length;
      return length < 1 || length > MAX_SECTION_NAME_LENGTH;
    });
    if (badHeading) {
      return { error: `A section name must be 1-${MAX_SECTION_NAME_LENGTH} characters` };
    }
  }
  const items = filterValidItems(requested, validIds);
  const songCount = countSongs(items);
  if (songCount > MAX_SETLIST_SIZE) {
    return { error: `A set list can hold at most ${MAX_SETLIST_SIZE} songs` };
  }
  if (items.length - songCount > MAX_SETLIST_SECTIONS) {
    return { error: `A set list can have at most ${MAX_SETLIST_SECTIONS} sections` };
  }
  return { items };
}

export function prepareSongIdsForCreate(requestedIds, validIds) {
  const result = checkItems(requestedIds, validIds);
  if (result.error) return result;
  if (countSongs(result.items) === 0) {
    return { error: 'A set list needs at least one song' };
  }
  return { songIds: result.items };
}

export function prepareSongIdsForUpdate(requestedIds, validIds) {
  const result = checkItems(requestedIds, validIds);
  if (result.error) return result;
  return { songIds: result.items };
}
```

5. Replace `buildSetlistMetadata` and `putSetlist` with:

```js
export function buildSetlistMetadata(songIds, name, createdAt, updatedAt) {
  return { name, count: countSongs(songIds), createdAt, updatedAt };
}

// Writes the list plus the summary the public listing reads from kv.list().
// Pass createdAt (and updatedAt, to keep it unchanged) when rewriting an existing list.
export async function putSetlist(kv, id, songIds, name, { createdAt, updatedAt } = {}) {
  const value = buildSetlistValue(songIds, name, createdAt, updatedAt);
  const saved = JSON.parse(value);
  await kv.put(id, value, {
    metadata: buildSetlistMetadata(songIds, name, saved.createdAt, saved.updatedAt),
  });
  return value;
}
```

6. Replace `toListEntries` and add `formatListDate` right after it:

```js
export function toListEntries(keys) {
  return keys
    .filter((k) => k.metadata && !k.metadata.deleted)
    .map((k) => ({ id: k.name, ...k.metadata, createdAt: k.metadata.createdAt ?? k.metadata.updatedAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// e.g. "Oct 12, 2026", in the viewer's timezone. Empty string if the input isn't a date.
export function formatListDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for every test (102 baseline + 8 from Task 1 + the new ones here), 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setlist.js src/lib/setlist.test.js
git commit -m "feat: validate section headings and track createdAt for service lists"
```

---

### Task 3: API routes keep createdAt and backfill dates

**Files:**
- Modify: `src/pages/api/setlists/index.js`
- Modify: `src/pages/api/setlists/[id].js`

**Interfaces:**
- Consumes: `putSetlist`, `buildSetlistMetadata`, `parseLiveSetlist`, `toListEntries`, `prepareSongIdsForCreate`, `prepareSongIdsForUpdate` from `src/lib/setlist.js` (Task 2).
- Produces: `GET /api/setlists` entries `{ id, name, count, createdAt, updatedAt }`; `PUT /api/setlists/<id>` preserves `createdAt`; `POST` and `GET /api/setlists/<id>` keep their shape, but values now carry `createdAt` and heading items.

- [ ] **Step 1: Update the listing backfill in `src/pages/api/setlists/index.js`**

Change the first import line to add `buildSetlistMetadata`:

```js
import { prepareSongIdsForCreate, prepareSetlistName, generateSetlistId, putSetlist, buildSetlistMetadata, toListEntries, parseLiveSetlist, jsonResponse } from '../../../lib/setlist.js';
```

Replace the legacy block inside `GET` (from the `// Lists saved before metadata existed` comment through the closing brace of the `for` loop) with:

```js
  // Lists saved before metadata or createdAt existed: read once, rewrite with both,
  // keeping their last-updated time unchanged (it becomes their date).
  const legacy = keys.filter((k) => !k.metadata || (!k.metadata.deleted && !k.metadata.createdAt));
  for (const key of legacy) {
    const data = parseLiveSetlist(await kv.get(key.name));
    if (!data) continue;
    const createdAt = data.createdAt ?? data.updatedAt;
    await putSetlist(kv, key.name, data.songIds, data.name, { createdAt, updatedAt: data.updatedAt });
    key.metadata = buildSetlistMetadata(data.songIds, data.name, createdAt, data.updatedAt);
  }
```

`POST` needs no change: `putSetlist(kv, id, songResult.songIds, nameResult.name)` now stamps `createdAt` automatically.

- [ ] **Step 2: Preserve `createdAt` on PUT in `src/pages/api/setlists/[id].js`**

In `PUT`, replace:

```js
  const existing = await kv.get(params.id);
  if (parseLiveSetlist(existing) === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
```

with:

```js
  const existingData = parseLiveSetlist(await kv.get(params.id));
  if (existingData === null) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
```

Replace `name = JSON.parse(existing).name;` with `name = existingData.name;`.

Replace `const value = await putSetlist(kv, params.id, songResult.songIds, name);` with:

```js
  const value = await putSetlist(kv, params.id, songResult.songIds, name, {
    createdAt: existingData.createdAt ?? existingData.updatedAt,
  });
```

- [ ] **Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests pass; build prints `Complete!`.

- [ ] **Step 4: Smoke-test the API against the local dev server**

In one terminal run `npm run seed-local-kv && npm run dev` (note the printed port, normally 4321). In another terminal, replacing `PORT` and `SONGID` (any `id` from `src/data/songs.json`):

```bash
curl -s -X POST localhost:PORT/api/setlists -H 'content-type: application/json' \
  -d '{"name":"Test","songIds":[{"section":"Praise"},"SONGID"]}'
```
Expected: `{"id":"<10 chars>"}`. Then with that id:

```bash
curl -s localhost:PORT/api/setlists/<id>
```
Expected: JSON with `songIds` equal to `[{"section":"Praise"},"SONGID"]`, plus `createdAt` equal to `updatedAt`.

```bash
curl -s -X PUT localhost:PORT/api/setlists/<id> -H 'content-type: application/json' -d '{"songIds":["SONGID"],"name":"Renamed"}'
curl -s localhost:PORT/api/setlists
```
Expected: the PUT response keeps the original `createdAt` with a newer `updatedAt`; the listing shows `{"id":"<id>","name":"Renamed","count":1,"createdAt":...,"updatedAt":...}`. Also check a bad heading: POST with `-d '{"name":"X","songIds":["SONGID",{"section":""}]}'` returns HTTP 400 with `A section name must be 1-60 characters`. Stop the dev server afterwards. If the dev server cannot run locally, say so in the task report and rely on the unit tests and the build.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/setlists/index.js "src/pages/api/setlists/[id].js"
git commit -m "feat: keep createdAt on edit and backfill list dates without bumping updatedAt"
```

---

### Task 4: List page - dates, section rows, Add section

**Files:**
- Modify: `src/pages/set/[id].astro`

**Interfaces:**
- Consumes: `isHeading`, `countSongs`, `addHeading`, `renameHeading`, `askSectionName` from `src/lib/sections.js` (Task 1); `formatListDate` from `src/lib/setlist.js` (Task 2); the `songIds: Item[]` shape from the API (Task 3).
- Produces: nothing used by other tasks.

Context for the implementer: the page keeps `currentIds` (now an `Item[]`) and already has `reorder(index, direction)`, `removeAt(index)` and `persist(nextIds)`, all index-based, so they already work with heading items. Only rendering and the new buttons need to change.

- [ ] **Step 1: Add the date and the Add-section button to the markup**

After the closing `</h1>` of the `#set-app` block add a date line. Replace:

```astro
        </h1>
        <div class="actions">
```

with:

```astro
        </h1>
        <p class="list-date"><time id="list-date" datetime={liveSet.createdAt ?? liveSet.updatedAt}></time></p>
        <div class="actions">
```

and replace:

```astro
          <button id="delete-set" class="danger">Delete</button>
```

with:

```astro
          <button id="add-section">Add section</button>
          <button id="delete-set" class="danger">Delete</button>
```

- [ ] **Step 2: Add CSS**

Inside the existing `<style is:global>` block, right after the `.set-song a:hover { text-decoration: underline; }` rule, add:

```css
    .list-date {
      color: var(--color-muted-foreground);
      margin: calc(var(--space-2) * -1) 0 var(--space-4);
    }
    .set-section {
      background: transparent;
      border-color: var(--color-border-strong);
      font-weight: 700;
      margin-top: var(--space-3);
    }
```

- [ ] **Step 3: Update the page script**

Change the script's import lines to:

```js
    import { updateSetlist, deleteSetlist, isInLibrary, addPlaylistToLibrary, removePlaylistFromLibrary, updatePlaylistNameInLibrary } from '../../lib/setlist-client.js';
    import { isHeading, countSongs, addHeading, renameHeading, askSectionName } from '../../lib/sections.js';
    import { formatListDate } from '../../lib/setlist.js';
```

Inside `if (setSongsList) {`, right after `const statusEl = document.getElementById('status');`, add:

```js
      const dateEl = document.getElementById('list-date');
      dateEl.textContent = formatListDate(dateEl.dateTime);
```

In `renderSetSongs`, replace the status block:

```js
        if (currentIds.length === 0) {
          statusEl.textContent = 'No songs in this set yet — add some below.';
        } else {
          statusEl.textContent = `${currentIds.length} song${currentIds.length === 1 ? '' : 's'} in this set`;
        }
```

with:

```js
        const songCount = countSongs(currentIds);
        if (songCount === 0) {
          statusEl.textContent = 'No songs in this set yet — add some below.';
        } else {
          statusEl.textContent = `${songCount} song${songCount === 1 ? '' : 's'} in this set`;
        }
```

Replace the start of the `currentIds.forEach(...)` callback:

```js
        currentIds.forEach((songId, index) => {
          const song = songById.get(songId);
          if (!song) return;

          const li = document.createElement('li');
          li.className = 'set-song';
```

with:

```js
        currentIds.forEach((item, index) => {
          if (isHeading(item)) {
            setSongsList.appendChild(buildHeadingRow(item, index));
            return;
          }
          const song = songById.get(item);
          if (!song) return;

          const li = document.createElement('li');
          li.className = 'set-song';
```

Add this function immediately before `async function persist(nextIds) {`:

```js
      function buildHeadingRow(heading, index) {
        const li = document.createElement('li');
        li.className = 'set-song set-section';

        const title = document.createElement('span');
        title.textContent = heading.section;
        li.appendChild(title);

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

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', () => {
          const name = askSectionName(heading.section);
          if (name) persist(renameHeading(currentIds, index, name));
        });
        controls.appendChild(renameBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeAt(index));
        controls.appendChild(removeBtn);

        li.appendChild(controls);
        return li;
      }
```

Finally, add the Add-section handler right after the `renderSetSongs();` call that follows the `addSong` function:

```js
      document.getElementById('add-section').addEventListener('click', () => {
        const name = askSectionName();
        if (name) persist(addHeading(currentIds, name));
      });
```

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests pass; build prints `Complete!`.

- [ ] **Step 5: Manual check (dev server)**

Run `npm run dev`, create a list, open `/set/<id>/`. Expected: the date shows under the title (e.g. "Oct 11, 2026"); "Add section" asks for a name and adds a bold heading row at the end; ↑/↓ move songs across headings; "Rename" renames; "Remove" on a heading keeps its songs; typing `<b>x</b>` as a section name shows the literal text; reloading keeps everything.

- [ ] **Step 6: Commit**

```bash
git add "src/pages/set/[id].astro"
git commit -m "feat: show list date and editable sections on the service list page"
```

---

### Task 5: Home page - draft sections and dates in listings

**Files:**
- Modify: `src/lib/setlist-client.js`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `isHeading`, `addHeading`, `renameHeading`, `removeAt`, `moveItem`, `askSectionName` from `src/lib/sections.js` (Task 1); `formatListDate` from `src/lib/setlist.js` (Task 2); API listing entries with `createdAt` (Task 3).
- Produces: `updateDraft(transform)` in `setlist-client.js`.

Context: the draft in `localStorage` is read by `getDraftIds()` and passed straight to `createSetlist`, so it can hold headings without other changes. The existing `addToDraft`, `removeFromDraft` and `reorderInDraft` operate on song ids and work on mixed arrays.

- [ ] **Step 1: Add `updateDraft` to `src/lib/setlist-client.js`**

Add after `reorderInDraft`:

```js
// Applies a pure transform (items => items) to the draft and saves it.
// Used for heading operations, which are addressed by position.
export function updateDraft(transform) {
  const next = transform(getDraftIds());
  writeList(DRAFT_KEY, next);
  return next;
}
```

- [ ] **Step 2: Update imports in `src/pages/index.astro`**

In the `<script>` imports, add `updateDraft` to the `setlist-client.js` import list, and add two new lines after the `normalizeTitle` import:

```js
    import { isHeading, addHeading, renameHeading, removeAt, moveItem, askSectionName } from '../lib/sections.js';
    import { formatListDate } from '../lib/setlist.js';
```

- [ ] **Step 3: Render draft headings**

Replace the draft rendering block:

```js
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
```

with:

```js
      draftIds.forEach((item, index) => {
        if (isHeading(item)) {
          results.appendChild(buildDraftHeadingRow(item, index, draftIds.length));
          return;
        }
        const song = songById.get(item);
        if (!song) return;
        const li = buildPlaylistSongRow(song, {
          showUp: index > 0,
          showDown: index < draftIds.length - 1,
          onUp: () => { reorderInDraft(song.id, -1); renderPlaylistsTab(); },
          onDown: () => { reorderInDraft(song.id, 1); renderPlaylistsTab(); },
          onRemove: () => { removeFromDraft(song.id); renderPlaylistsTab(); },
        });
        results.appendChild(li);
      });
```

(`draftSongs` stays as it is: the save button and counts rely on it, and it correctly excludes headings because `songById.get(heading)` is `undefined`.)

Add this function immediately before `function renderPlaylistsTab() {`:

```js
    function buildDraftHeadingRow(heading, index, total) {
      const li = document.createElement('li');
      li.className = 'set-song-row set-section-row';

      const title = document.createElement('span');
      title.textContent = heading.section;
      li.appendChild(title);

      const controls = document.createElement('span');
      controls.className = 'row-controls';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = '↑';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => { updateDraft((items) => moveItem(items, index, -1)); renderPlaylistsTab(); });
      controls.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = '↓';
      downBtn.disabled = index === total - 1;
      downBtn.addEventListener('click', () => { updateDraft((items) => moveItem(items, index, 1)); renderPlaylistsTab(); });
      controls.appendChild(downBtn);

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', () => {
        const name = askSectionName(heading.section);
        if (!name) return;
        updateDraft((items) => renameHeading(items, index, name));
        renderPlaylistsTab();
      });
      controls.appendChild(renameBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => { updateDraft((items) => removeAt(items, index)); renderPlaylistsTab(); });
      controls.appendChild(removeBtn);

      li.appendChild(controls);
      return li;
    }
```

- [ ] **Step 4: Add the "Add section" button next to Save**

Find where the draft controls are assembled (`controlsLi.appendChild(nameInput); controlsLi.appendChild(saveBtn);`). Replace those two lines with:

```js
      const addSectionBtn = document.createElement('button');
      addSectionBtn.type = 'button';
      addSectionBtn.textContent = 'Add section';
      addSectionBtn.addEventListener('click', () => {
        const name = askSectionName();
        if (!name) return;
        updateDraft((items) => addHeading(items, name));
        renderPlaylistsTab();
      });

      controlsLi.appendChild(nameInput);
      controlsLi.appendChild(addSectionBtn);
      controlsLi.appendChild(saveBtn);
```

- [ ] **Step 5: CSS for the draft heading row**

Run `grep -n "playlist-section-label" src/pages/index.astro` and find the CSS rule for `.playlist-section-label` inside the `<style>` block. Add directly after that rule:

```css
    .set-section-row {
      font-weight: 700;
      border-bottom: 2px solid var(--color-border-strong);
    }
```

- [ ] **Step 6: Dates in the listings and on the optimistic entry**

In the "All Service Lists" row builder, replace:

```js
        link.textContent = `${list.name} (${list.count} song${list.count === 1 ? '' : 's'})`;
```

with:

```js
        const listDate = formatListDate(list.createdAt);
        link.textContent = `${list.name} (${list.count} song${list.count === 1 ? '' : 's'})${listDate ? ` · ${listDate}` : ''}`;
```

In the "Your Service Lists" loop (`for (const playlist of cachedPlaylists) {`), replace `link.textContent = playlist.name;` with:

```js
          const playlistDate = formatListDate(publicLists.find((l) => l.id === playlist.id)?.createdAt);
          link.textContent = playlistDate ? `${playlist.name} · ${playlistDate}` : playlist.name;
```

In the save handler's optimistic entry, replace the existing `justCreated.set(savedId, { ... updatedAt: new Date().toISOString() });` line with:

```js
          const savedAt = new Date().toISOString();
          justCreated.set(savedId, { id: savedId, name: savedName, count: savedCount, createdAt: savedAt, updatedAt: savedAt });
```

(Keep the line after it, `publicLists = [justCreated.get(savedId), ...publicLists];`, as is.)

- [ ] **Step 7: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests pass; build prints `Complete!` (if the build ends with a Windows `UV_HANDLE_CLOSING` assertion, re-run it once; it is a known one-off Node glitch).

- [ ] **Step 8: Manual check (dev server)**

Run `npm run dev`. On the Service List tab: add two songs with "+", click "Add section", name it "Opening Worship"; rows show a bold heading with working ↑ ↓ Rename Remove; save the list. Expected: both "Your Service Lists" and "All Service Lists" show the name with today's date (e.g. `Sunday · Oct 11, 2026`); opening the saved list shows the headings; an older draft saved earlier as plain ids still loads.

- [ ] **Step 9: Commit**

```bash
git add src/lib/setlist-client.js src/pages/index.astro
git commit -m "feat: sections in the draft list and dates in both service list views"
```

---

### Task 6: Full verification

**Files:** none modified (fix-ups only if a check fails).

- [ ] **Step 1: Run everything**

Run: `npm test && npm run build`
Expected: 0 failing tests; build `Complete!`.

- [ ] **Step 2: End-to-end walkthrough (dev server)**

Run `npm run dev` and confirm in the browser: create a list with two sections and songs under each; the public listing shows its date and a song-only count; open it on `/set/<id>/` and rename a section, move a song across a heading, remove a heading (its songs stay); rename the list itself and confirm the date does not change; delete it (confirm dialog) and confirm it disappears from the listing.

- [ ] **Step 3: Check the spec**

Read `docs/superpowers/specs/2026-10-11-service-list-sections-and-dates-design.md` once more and confirm every requirement is met; fix anything missing and commit as `fix: ...`.

- [ ] **Step 4: Report**

Report the commit list (`git log --oneline`) and tell the user the work is committed locally, not pushed or deployed, and that the deploy command is `npm run build && npx wrangler deploy` after they approve.

# Service List Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the localStorage draft and arrow-only section editing with: create a list's name and sections up front, then place songs by dragging them (or tapping, which lands in a holding area called Unsorted) — on both the new creation screen and an already-saved list's own page, using the one real site-wide search in both places.

**Architecture:** Three new pure, dependency-free library modules (`sections.js` additions, `song-search.js`, `drag.js`) feed one shared DOM-rendering module (`section-board.js`) that both `index.astro`'s new creation flow and `set/[id].astro`'s existing-list page mount. The stored data shape (array of song-id strings and heading objects) is unchanged. The `localStorage` draft (`setlist-client.js`: `DRAFT_KEY` and friends) and the three quick-add entry points that wrote into it are deleted outright, not repointed.

**Tech Stack:** Astro 5 (Cloudflare adapter), plain CSS custom properties (`src/styles/components.css`), vanilla browser JS with Pointer Events for drag-and-drop (no library), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-01-service-list-rebuild-design.md`

## Global Constraints

- All paths relative to the repo root (`C:\Users\osaug\claude`); run every command from there. Windows + Git Bash. For scripted multi-line edits use `PYTHONUTF8=1 python` (source files contain non-ASCII characters like `→`, `▸`, `—`) rather than long inline shell commands, which fail on Windows with ENAMETOOLONG past a few hundred characters.
- No new npm dependency of any kind. No drag-and-drop library — the drag primitive is built on Pointer Events only.
- The stored list shape stays `Item[] = (string | { section: string })[]` (unchanged). "Unsorted" is the existing leading group before the first heading (`groupBySection`'s `heading: null` group) — not a new field.
- Existing limits, unchanged by this work: `MAX_SETLIST_SIZE` = 50 songs, `MAX_SETLIST_SECTIONS` = 10, `MAX_SECTION_NAME_LENGTH` = 60 characters.
- `prepareSongIdsForUpdate` (used by `PUT /api/setlists/:id`, i.e. editing an already-saved list) is NOT changed by this plan — section add/rename/remove and leaving songs in Unsorted stay unrestricted after creation, per the design's Non-goals.
- Tests: `npm test` (runs `node --test scripts/*.test.js src/lib/*.test.js`). Baseline before this plan: 138 passing (confirmed by running it before Task 1). Build: `npm run build` must print `Complete!`.
- This codebase has no DOM/browser test harness — every existing `*.astro` page's rendering and event-wiring code is verified by manual dev-server checks, never `node --test`. Follow that same convention here: pure logic (sections.js, setlist.js, song-search.js) gets `node --test` coverage; DOM/pointer-event glue (drag.js, section-board.js, the two `.astro` pages) does not get an automated test file, and is verified by the manual checks each of those tasks lists.
- One commit per task so any task is independently revertable. Commit locally after each task; do not push or deploy as part of this plan.

## Review Focus

- A song already placed somewhere in the list must not be re-offered (or re-addable) from the search results — dedup against the list's current contents, the same way `set/[id].astro`'s existing add-a-song box already does today.
- The Create button's gate must independently require a name, at least one section, at least one song anywhere in the list, and zero songs left in Unsorted — not just the last-added condition; a wrong gate either blocks a valid list or lets a bad one through.
- Placing a song must work without a pointer/touch drag at all: tapping (or keyboard-activating) a search result lands it in Unsorted, and the up/down arrow buttons on an already-placed row move it between sections — both are real, independently working fallbacks, not decoration.
- Placing into a section that currently has zero songs must not crash or misplace the song (an off-by-one on the insertion point is the likely bug).
- The existing 50-song / 10-section / 60-character caps must still be enforced by the new creation gate, not bypassed by the "has a section, Unsorted empty" checks added on top of them.

---

## File Structure

- Modify `src/lib/sections.js` — add `countUnsorted`, `placeInSection`, `moveToAdjacentSection`.
- Modify `src/lib/sections.test.js` — tests for the above.
- Modify `src/lib/setlist.js` — extend `prepareSongIdsForCreate` with the "has a section" / "Unsorted empty" gate.
- Modify `src/lib/setlist.test.js` — tests for the above.
- Create `src/lib/song-search.js` — pure title/lyrics/fuzzy search, extracted from `index.astro`'s inline logic so both pages share one implementation.
- Create `src/lib/song-search.test.js` — tests for the above.
- Create `src/lib/drag.js` — Pointer-Events drag-and-drop primitive. No test file (DOM glue; see Global Constraints).
- Create `src/lib/section-board.js` — the shared search-box + draggable-results + section-drop-zones + Unsorted renderer that both pages mount. No test file.
- Modify `src/pages/index.astro` — remove the localStorage-draft "Currently building" block and the `+` quick-add button in `buildCard()`; add the "New Service List" creation flow built on `section-board.js`.
- Modify `src/pages/set/[id].astro` — replace the minimal `#add-search`/`#add-results` box with `section-board.js`; switch the arrow buttons from positional swap to `moveToAdjacentSection`.
- Modify `src/pages/song/[slug].astro` — remove the "Add to List" button and its script block; move the existing `recordView()` call (currently reading the button's `data-song-id`) onto a `data-song-id` attribute on the page's own root element.
- Modify `src/lib/setlist-client.js` — remove the draft functions (`DRAFT_KEY`, `getDraftIds`, `addToDraft`, `removeFromDraft`, `reorderInDraft`, `updateDraft`, `saveDraftAsPlaylist`); `createSetlist` (already exported) becomes the only way a list is created, called directly by the new creation flow.

---

### Task 1: Section placement helpers

**Files:**
- Modify: `src/lib/sections.js`
- Test: `src/lib/sections.test.js`

**Interfaces:**
- Consumes: `isHeading`, `groupBySection` (both already in `sections.js`).
- Produces (used by Tasks 2 and 5):
  - `countUnsorted(items: Item[]): number`
  - `placeInSection(items: Item[], songId: string, targetHeading: object | null): Item[]` — new array; `targetHeading` is a heading object reference from `items` (the Unsorted bucket is `null`).
  - `moveToAdjacentSection(items: Item[], songId: string, direction: -1 | 1): Item[]` — new array; no-op (returns an equal array) if there's no section in that direction from the song's current one.

- [ ] **Step 1: Write the failing tests**

```js
import { countUnsorted, placeInSection, moveToAdjacentSection } from './sections.js';

test('countUnsorted counts only the songs before the first heading', () => {
  assert.equal(countUnsorted(['a', 'b', { section: 'Praise' }, 'c']), 2);
  assert.equal(countUnsorted([{ section: 'Praise' }, 'a']), 0);
  assert.equal(countUnsorted([]), 0);
});

test('placeInSection appends a new song to the end of a named section', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(placeInSection(['a', H1, 'b'], 'c', H1), ['a', H1, 'b', 'c']);
});

test('placeInSection appends a new song to Unsorted when targetHeading is null', () => {
  assert.deepEqual(placeInSection(['a', 'b'], 'c', null), ['a', 'b', 'c']);
});

test('placeInSection inserts before the next heading, not at the end of the array', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(placeInSection(['a', H1, 'b', H2, 'c'], 'd', H1), ['a', H1, 'b', 'd', H2, 'c']);
});

test('placeInSection moves an already-placed song: removes it from its old spot first', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(placeInSection(['a', H1, 'b', H2, 'c'], 'b', H2), ['a', H1, H2, 'c', 'b']);
});

test('placeInSection can move a placed song back into Unsorted', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(placeInSection(['a', H1, 'b'], 'b', null), ['a', 'b', H1]);
});

test('placeInSection into a section that currently has no songs still lands correctly', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(placeInSection(['a', H1, H2, 'b'], 'c', H1), ['a', H1, 'c', H2, 'b']);
});

test('placeInSection falls back to appending at the end if targetHeading is not found in items', () => {
  const stray = { section: 'Nowhere' };
  assert.deepEqual(placeInSection(['a', { section: 'Opening' }], 'c', stray), ['a', { section: 'Opening' }, 'c']);
});

test('moveToAdjacentSection moves a song to the previous section', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, H2, 'b'], 'b', -1), ['a', 'b', H1, H2]);
});

test('moveToAdjacentSection moves a song to the next section', () => {
  const H1 = { section: 'Opening' };
  const H2 = { section: 'Praise' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b', H2], 'b', 1), ['a', H1, H2, 'b']);
});

test('moveToAdjacentSection moving up from the first section lands in Unsorted', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b'], 'b', -1), ['a', 'b', H1]);
});

test('moveToAdjacentSection is a no-op past the last section or before Unsorted', () => {
  const H1 = { section: 'Opening' };
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b'], 'b', 1), ['a', H1, 'b']);
  assert.deepEqual(moveToAdjacentSection(['a', H1, 'b'], 'a', -1), ['a', H1, 'b']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/sections.test.js`
Expected: FAIL (`countUnsorted`, `placeInSection`, `moveToAdjacentSection` are not exported yet).

- [ ] **Step 3: Implement the three functions in `src/lib/sections.js`**

`countUnsorted(items)`: one line — `groupBySection(items)[0].entries.length`.

`placeInSection(items, songId, targetHeading)`: filter `songId` out of `items` first (so a move always removes the old occurrence before re-inserting). Find the index of `targetHeading` in the filtered array by `===` reference (or, for `null`, the array's start). The insertion point is right before the next heading after that point, or the end of the array if there is none (or if `targetHeading` itself isn't found — the documented fallback). Splice `songId` in there and return the new array.

`moveToAdjacentSection(items, songId, direction)`: use `groupBySection(items)` to find which group currently contains `songId`, then call `placeInSection(items, songId, groups[groupIndex + direction]?.heading)` — but only if `groupIndex + direction` is a valid index into the groups array; otherwise return `items` unchanged (a plain copy, not the same reference, consistent with how `moveItem` already handles its own out-of-range case).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/sections.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sections.js src/lib/sections.test.js
git commit -m "feat: add section placement helpers (countUnsorted, placeInSection, moveToAdjacentSection)"
```

---

### Task 2: Creation-time validation gate

**Files:**
- Modify: `src/lib/setlist.js`
- Test: `src/lib/setlist.test.js`

**Interfaces:**
- Consumes: `countUnsorted`, `isHeading` from `src/lib/sections.js` (Task 1; `isHeading` is already imported in `setlist.js`, add `countUnsorted` to that same import).
- Produces: `prepareSongIdsForCreate` unchanged in name/signature, with two new possible error strings. `prepareSongIdsForUpdate` is untouched.

- [ ] **Step 1: Write the failing tests**

```js
test('prepareSongIdsForCreate rejects a list with songs but no section', () => {
  const result = prepareSongIdsForCreate(['a'], new Set(['a']));
  assert.equal(result.error, 'A set list needs at least one section');
});

test('prepareSongIdsForCreate rejects a list with a section but something left in Unsorted', () => {
  const result = prepareSongIdsForCreate(['a', { section: 'Opening' }, 'b'], new Set(['a', 'b']));
  assert.equal(result.error, 'Sort every song into a section before creating the list');
});

test('prepareSongIdsForCreate accepts a list with a section and nothing left in Unsorted', () => {
  const result = prepareSongIdsForCreate([{ section: 'Opening' }, 'a'], new Set(['a']));
  assert.deepEqual(result.songIds, [{ section: 'Opening' }, 'a']);
  assert.equal(result.error, undefined);
});

test('prepareSongIdsForCreate still rejects an empty list before checking for a section', () => {
  const result = prepareSongIdsForCreate([], new Set(['a']));
  assert.equal(result.error, 'A set list needs at least one song');
});

test('prepareSongIdsForCreate still enforces the existing size and section-count caps', () => {
  const valid = new Set(Array.from({ length: 60 }, (_, i) => `id${i}`));
  const tooManySongs = [{ section: 'A' }, ...Array.from({ length: 51 }, (_, i) => `id${i}`)];
  assert.equal(prepareSongIdsForCreate(tooManySongs, valid).error, 'A set list can hold at most 50 songs');
});

test('prepareSongIdsForUpdate does not require a section or an empty Unsorted', () => {
  const result = prepareSongIdsForUpdate(['a'], new Set(['a']));
  assert.deepEqual(result.songIds, ['a']);
  assert.equal(result.error, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/setlist.test.js`
Expected: FAIL (the two new error cases currently succeed instead of erroring; `prepareSongIdsForUpdate`'s test should already pass since it's unchanged behavior — confirm it does).

- [ ] **Step 3: Implement in `src/lib/setlist.js`**

Add `countUnsorted` to the existing `import { isHeading, countSongs, ... } from './sections.js';` line. In `prepareSongIdsForCreate`, after the existing "at least one song" check and before returning `{ songIds: result.items }`, add: if `!result.items.some(isHeading)`, return `{ error: 'A set list needs at least one section' }`; else if `countUnsorted(result.items) > 0`, return `{ error: 'Sort every song into a section before creating the list' }`. Leave `prepareSongIdsForUpdate` exactly as it is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, every test (the file's full suite plus the rest of the project).

- [ ] **Step 5: Commit**

```bash
git add src/lib/setlist.js src/lib/setlist.test.js
git commit -m "feat: require a section and an empty Unsorted before a service list can be created"
```

---

### Task 3: Shared song search

**Files:**
- Create: `src/lib/song-search.js`
- Test: `src/lib/song-search.test.js`

**Interfaces:**
- Consumes: nothing (pure, no imports — mirrors `sections.js`'s own no-import convention since this is also used both server-adjacent-free and in the browser).
- Produces (used by Task 5, and by `index.astro`'s main search in Task 6):
  - `searchSongs(songs: Song[], query: string): { song: Song, snippet: {before,match,after} | null }[]` — title/lyrics substring match (case-insensitive) first; if that finds nothing and the query is a plausible title fragment, a fuzzy title fallback (same Levenshtein-based matching `index.astro` already has). `snippet` is set only for a lyrics-containing substring match, `null` otherwise (including every fuzzy-fallback result, since those didn't match on text content).
  - `fuzzyTitleMatches(songs: Song[], query: string): Song[]` and `snippetParts(lyrics: string, q: string): {before,match,after} | null` — the two lower-level pieces, exported individually too, so `index.astro`'s existing `renderSearch`/`buildCard` (Task 6) can swap their own local copies for these directly with no other logic change (same parameters apart from `fuzzyTitleMatches` now taking `songs` explicitly instead of closing over a module-level `data`).

Context for the implementer: this extracts existing, working logic — `levenshtein`, `fuzzyThreshold`, `fuzzyTitleMatches`, `snippetParts`, and the substring-match block inside `renderSearch` — verbatim out of `src/pages/index.astro`'s current `<script>` (see that file's current content for the exact algorithm; copy it rather than rewriting it, since it's already correct and tested-by-use in production). The only shape change: `fuzzyTitleMatches` takes `songs` as its first parameter instead of closing over a module-level `data` constant, since it's no longer inline in that script. `searchSongs` is the new, higher-level function Task 5 uses; `fuzzyTitleMatches`/`snippetParts` are the same two helpers Task 6 wires `index.astro` to import instead of keeping local copies — do not leave the logic duplicated in both files. `normalizeTitle` (from `src/lib/normalize.js`) is still needed by the fuzzy path — import it in `song-search.js` rather than duplicating it.

- [ ] **Step 1: Write the failing tests**

```js
import { searchSongs } from './song-search.js';

const SONGS = [
  { id: 'a', slug: 'amazing-grace', title: 'Amazing Grace', author: 'John Newton', lyrics: 'Amazing grace how sweet the sound' },
  { id: 'b', slug: 'how-great', title: 'How Great Thou Art', author: 'Carl Boberg', lyrics: 'O Lord my God' },
];

test('searchSongs matches on title, case-insensitively', () => {
  const results = searchSongs(SONGS, 'amazing');
  assert.deepEqual(results.map((r) => r.song.id), ['a']);
});

test('searchSongs matches on lyrics and returns a snippet around the match', () => {
  const results = searchSongs(SONGS, 'sweet the sound');
  assert.equal(results[0].song.id, 'a');
  assert.ok(results[0].snippet);
  assert.match(results[0].snippet.match, /sweet the sound/i);
});

test('searchSongs falls back to a fuzzy title match when nothing matches exactly, with no snippet', () => {
  const results = searchSongs(SONGS, 'Amazin Grase');
  assert.deepEqual(results.map((r) => r.song.id), ['a']);
  assert.equal(results[0].snippet, null);
});

test('searchSongs returns an empty array for a query that matches nothing at all', () => {
  assert.deepEqual(searchSongs(SONGS, 'zzzzzzz'), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/song-search.test.js`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `src/lib/song-search.js`**

Move `levenshtein`, `fuzzyThreshold`, `fuzzyTitleMatches`, `snippetParts` out of `index.astro`'s script verbatim (as private, unexported functions in this new file), importing `normalizeTitle` from `./normalize.js`. Add the exported `searchSongs(songs, query)`: run the same substring-match filter `renderSearch` currently does (`song.title` or `song.lyrics`, lowercased, `includes(q)`), map matches to `{ song, snippet: snippetParts(song.lyrics, q) }` (snippet may be `null` if the match was on the title, not the lyrics — keep `renderSearch`'s existing logic for when a snippet is shown). If there are zero substring matches, fall back to `fuzzyTitleMatches(query).map((song) => ({ song, snippet: null }))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/song-search.test.js`
Expected: PASS, all four tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/song-search.js src/lib/song-search.test.js
git commit -m "feat: extract the site search into a shared, reusable module"
```

---

### Task 4: Pointer Events drag-and-drop primitive

**Files:**
- Create: `src/lib/drag.js`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 5):
  - `makeDraggable(sourceEl: HTMLElement, { onDrop, dragThreshold = 6 }): void`

No test file — this is DOM/pointer-event glue with no automated test harness in this project (see Global Constraints); verified manually in Task 5's dev-server check, since it has no caller until then.

- [ ] **Step 1: Implement `src/lib/drag.js`**

```js
// Framework-free drag-and-drop built on Pointer Events, so mouse and touch
// are the same code path. A drop target is any element the caller marks
// with a `data-drop-zone="<id>"` attribute; this module finds the nearest
// one under the pointer on every move via document.elementFromPoint +
// closest('[data-drop-zone]').
//
// makeDraggable(sourceEl, { onDrop, dragThreshold = 6 })
//   onDrop(zoneId): called once, when the pointer is released over a valid
//     drop zone. Not called if released outside every zone — nothing is
//     mutated in that case, so there is nothing for the caller to undo.
//   dragThreshold: pixels of movement before a drag is recognized, so a
//     plain tap/click on sourceEl still reaches its own click handler.
//
// While a drag is in progress: sourceEl gets a `dragging` class; whichever
// zone is currently under the pointer gets a `drag-over` class (moved off
// the previous zone as the pointer moves). Both classes are the caller's
// hook for visual feedback via CSS — this module sets no inline styles.
export function makeDraggable(sourceEl, { onDrop, dragThreshold = 6 } = {}) { ... }
```

Approach: on `pointerdown`, record the start position and call `sourceEl.setPointerCapture(event.pointerId)`. On `pointermove`, before the threshold is crossed, do nothing (let the event bubble, so a click still fires normally if the pointer barely moves); once past `dragThreshold`, add the `dragging` class and, on every subsequent move, use `document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drop-zone]')` to find the current zone, toggling `drag-over` off the previous zone and onto the new one when it changes. On `pointerup`, if a zone was found, call `onDrop(zoneEl.dataset.dropZone)`; either way, release pointer capture and remove the `dragging`/`drag-over` classes. Since every row in this codebase is rebuilt fresh on every re-render (never reused), no explicit teardown/unsubscribe API is needed.

- [ ] **Step 2: Commit**

```bash
git add src/lib/drag.js
git commit -m "feat: add a Pointer Events drag-and-drop primitive"
```

---

### Task 5: Shared section board (search, drag, Unsorted, sections)

**Files:**
- Create: `src/lib/section-board.js`

**Interfaces:**
- Consumes: `searchSongs` (Task 3), `makeDraggable` (Task 4), `placeInSection`, `moveToAdjacentSection`, `groupBySection`, `isHeading`, `countSongs` (Task 1 and existing `sections.js`).
- Produces (used by Tasks 6 and 7):
  - `mountSectionBoard(container: HTMLElement, { songs, getItems, onChange }): { rerender(): void }`
    - `songs`: the full catalog, `{id, slug, title, author, lyrics}[]`.
    - `getItems()`: returns the current `Item[]` — called at the start of every `rerender()`. The board holds no list state of its own; the caller is the source of truth.
    - `onChange(nextItems)`: called after every placement (drag-drop, tap-to-Unsorted, or an arrow move). The caller persists or holds `nextItems` and calls `rerender()` afterward if the board should reflect it immediately — `mountSectionBoard` never calls its own `rerender()`, matching how every other mutation in this codebase already works (render happens after the caller's own state update, not inside the library function).

No test file (DOM glue; see Global Constraints). Verified manually in this task's own dev-server check.

- [ ] **Step 1: Build the static structure**

In `mountSectionBoard`, render into `container` once: a search `<input class="input" type="search">`, an empty results list (`<ul>`), and an empty board area (`<ul>`) that `rerender()` fills with one row per `groupBySection(getItems())` group — a group with `heading: null` renders as a drop zone labeled "Unsorted" (assign it `data-drop-zone="unsorted"`); a group with a heading renders as a drop zone labeled with the section's name (assign it `data-drop-zone="zone-<i>"` where `i` is that group's position in this render's `groupBySection` output). Keep a `Map` from zone id to the actual heading object (or `null` for Unsorted) for the current render, rebuilt at the top of every `rerender()` call — this is how a drop is resolved back to the real heading reference `placeInSection` needs. Each section's songs render as rows reusing the project's existing `.row`/`.row-title`/`.row-controls`/`.btn btn-sm` classes (see `src/styles/components.css` and the row-building code already in `index.astro`/`set/[id].astro` for the exact shape to match).

- [ ] **Step 2: Wire search and placement**

On the search input's `input` event, call `searchSongs(songs, query)`, filter out any song whose id is already present anywhere in `getItems()` (so an already-placed song is never re-offered — see Review Focus), and render each remaining result as a `<button type="button">` (keyboard-activatable, not a bare `div`) showing the title (and snippet, where present). Wire two things on each result button:
  - A plain `click` handler: calls `onChange(placeInSection(getItems(), song.id, null))` — a tap always lands in Unsorted.
  - `makeDraggable(resultButton, { onDrop: (zoneId) => onChange(placeInSection(getItems(), song.id, zoneMap.get(zoneId))) })` for the drag path onto any zone.

  A result's `click` handler and its drag handler both fire from the same element; `makeDraggable`'s `dragThreshold` is exactly what keeps a plain tap from also starting a drag (a release before crossing the threshold never calls `onDrop`, so only the `click` handler's placement happens).

- [ ] **Step 3: Wire already-placed rows (drag + arrows)**

For each already-placed song's row, call `makeDraggable(row, { onDrop: (zoneId) => onChange(placeInSection(getItems(), songId, zoneMap.get(zoneId))) })`, and give the row up/down arrow buttons that call `onChange(moveToAdjacentSection(getItems(), songId, -1))` / `(..., 1)` respectively — disabled when `moveToAdjacentSection` would be a no-op (there's no group in that direction; check this the same way `moveToAdjacentSection`'s own bounds check does, by finding the song's current group index via `groupBySection` and checking `index - 1 >= 0` / `index + 1 < groups.length`).

- [ ] **Step 4: Run the project's tests and build**

Run: `npm test && npm run build`
Expected: PASS, every test; build prints `Complete!`. (This task adds no new automated tests of its own — these commands confirm nothing else broke.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/section-board.js
git commit -m "feat: add the shared search/drag/Unsorted section board"
```

---

### Task 6: Rebuild the Service List tab's creation flow

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/lib/setlist-client.js` — remove `DRAFT_KEY`, `getDraftIds`, `addToDraft`, `removeFromDraft`, `reorderInDraft`, `updateDraft`, `saveDraftAsPlaylist`.

**Interfaces:**
- Consumes: `mountSectionBoard` (Task 5), `searchSongs` (Task 3), `countUnsorted` and `isHeading` (Task 1), `createSetlist` (existing, in `setlist-client.js`), `addPlaylistToLibrary` (existing).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Remove the old draft rendering and the quick-add button**

In `src/pages/index.astro`: delete `buildPlaylistSongRow`, `buildDraftHeadingRow`, `buildDraftSection`, and the whole "Currently building" block inside `renderPlaylistsTab()` (the `buildingLabel`/`controlsLi`/`nameInput`/`saveBtn`/`addSectionBtn`/the `groupBySection(draftIds)` loop) — "Your Service Lists" and "All Service Lists" stay exactly as they are. Delete the `+` button (`addBtn`) and its click handler from `buildCard()`; `buildCard` keeps building the rest of the card unchanged, still calling `snippetParts` for its own result-card snippet. Remove the now-unused imports this leaves behind (`addToDraft`, `removeFromDraft`, `reorderInDraft`, `getDraftIds`, `saveDraftAsPlaylist`, `updateDraft`, `isHeading`/`addHeading`/`renameHeading`/`removeAt`/`moveItem` if nothing else in this file still uses them — check before removing each).

- [ ] **Step 1b: Switch the main search to the shared module**

Delete this file's own local `levenshtein`, `fuzzyThreshold`, `fuzzyTitleMatches`, and `snippetParts` functions; import `fuzzyTitleMatches` and `snippetParts` from `../lib/song-search.js` (Task 3) in their place. Update the two call sites (`fuzzyTitleMatches(query)` inside `renderSearch`, and `fuzzyTitleMatches(query)`'s own internal use of `data`) to the new explicit-`songs`-parameter signature: `fuzzyTitleMatches(data, query)`. `buildCard`'s own `snippetParts(song.lyrics, query.toLowerCase())` call needs no signature change, just the new import. This removes the duplication Task 3 was extracted to fix — after this step, `levenshtein`/`fuzzyThreshold`/`fuzzyTitleMatches`/`snippetParts` exist only in `song-search.js`.

- [ ] **Step 2: Add the "New Service List" creation flow**

Replace where "Currently building" used to render with: a "New Service List" button that reveals (or a view that's always present when the Service List tab is active and no list is being created) a name `<input class="input">`, an "Add section" button (reuse the existing `askSectionName()` dialog from `src/lib/dialogs.js` and the existing `addHeading`/`renameHeading`/`removeAt` helpers from `sections.js` for managing the section list itself — Non-goals left this unrestricted even during creation), a list of the sections added so far (each with its own Rename/Remove, same pattern as the section rows already elsewhere in this file), and a `mountSectionBoard` instance whose `getItems()`/`onChange` read and write a plain in-memory array local to this view (not `localStorage` — see the design's "in-progress creation state is plain in-memory JS" call). The board itself is visible but should look disabled (reduced opacity, pointer-events: none on it, or a disabled overlay — reuse `components.css`'s `:disabled` styling pattern where practical) until the name is non-empty and at least one section exists; this doesn't block the search and drag logic underneath (gating is purely a hint; Step 3's Create button and the server are the real gates).

- [ ] **Step 3: Wire the Create button**

Add a Create button, disabled unless: the name is non-empty, there's at least one section (`items.some(isHeading)`), `countSongs(items) > 0`, and `countUnsorted(items) === 0` — recompute this on every change (after each `onChange` from the board, and on name/section edits). On click: call `createSetlist(items, name)` (existing function, unchanged), then `addPlaylistToLibrary(data.id, name)` (existing), then `location.href = '/set/' + data.id + '/'` (navigate to the new list's own page — confirmed with the requester). On failure, show the error the same way the old Save handler did (`showTransientStatus`), and leave the in-memory creation state intact so nothing is lost.

- [ ] **Step 4: Remove the draft functions from `setlist-client.js`**

Delete `DRAFT_KEY`, `getDraftIds`, `addToDraft`, `removeFromDraft`, `reorderInDraft`, `updateDraft`, `saveDraftAsPlaylist`. Leave `createSetlist`, `updateSetlist`, `listSetlists`, `deleteSetlist`, and every `*Library` function untouched.

- [ ] **Step 5: Run the project's tests and build**

Run: `npm test && npm run build`
Expected: PASS, every test; build prints `Complete!`.

- [ ] **Step 6: Manual check (dev server)**

Run `npm run dev`. On the Service List tab: click "New Service List"; confirm Create is disabled with no name, with a name but no section, with a section but no song, and with a song left un-dragged in Unsorted; add a section, search for a song, drag it onto the section; confirm it leaves Unsorted and the song can no longer be found again in that same search's results; tap a different search result and confirm it lands in Unsorted instead; use the up/down arrows on a placed song to move it to another section; click Create and confirm it lands on the new list's own page. Also check: a search result for a song already in the list never appears; a phone-width reload mid-build loses the in-progress list (expected, not a bug).

- [ ] **Step 7: Commit**

```bash
git add src/pages/index.astro src/lib/setlist-client.js
git commit -m "feat: rebuild the Service List tab around structure-first creation"
```

---

### Task 7: Rebuild the existing-list page's add-song flow

**Files:**
- Modify: `src/pages/set/[id].astro`

**Interfaces:**
- Consumes: `mountSectionBoard` (Task 5), `searchSongs` (Task 3; no longer needed directly here if `section-board.js` owns search — only import if this file needs it for anything else).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Replace the add-a-song box**

Remove the `#add-search`/`#add-results` markup and the `addInput`/`addResults` wiring (including `addSong`) from the script. In its place, mount `mountSectionBoard` on a new container, with `getItems: () => currentIds` and `onChange: (nextIds) => persist(nextIds)` (the existing `persist` function already PUTs to the server and re-renders — reuse it unchanged; `onChange` doesn't need to call `renderSetSongs()` itself since `persist` already does).

- [ ] **Step 2: Replace the existing rendering with the board where appropriate**

Keep `renderSetSongs()` and its existing per-song Remove and per-heading Rename/Remove controls as they are — `section-board.js` here only needs to supply the search box, its draggable results, and drop zones that map onto the SAME sections `renderSetSongs()` already draws; it does not need to also render the placed-song rows (those stay owned by this file, since they already carry this page's own Remove-song and Rename-section behavior that Task 5's board doesn't know about). Where the board needs a `data-drop-zone` to exist on an element for its own drag targets to register, add that attribute onto the section elements `renderSetSongs()` already builds (each heading row and the Unsorted leading group), using the same zone-id scheme Task 5 defined (`'unsorted'` / `'zone-<i>'`, recomputed each render) so drops resolve correctly; have `renderSetSongs()` call the mounted board's `rerender()` whenever it redraws, so the zone map never goes stale.

- [ ] **Step 3: Switch the song-row arrow buttons to `moveToAdjacentSection`**

In `buildSongRow`, replace the `reorder(index, direction)` calls on the up/down buttons with `persist(moveToAdjacentSection(currentIds, songId, direction))`. Disable each arrow exactly when `moveToAdjacentSection` would be a no-op, the same way Task 5's board does for its own placed-row arrows. Leave `buildHeadingRow`'s up/down buttons as they are — those reorder sections themselves (a different operation from moving a song between sections), and section reordering is outside this plan's scope per the design's Non-goals.

- [ ] **Step 4: Run the project's tests and build**

Run: `npm test && npm run build`
Expected: PASS, every test; build prints `Complete!`.

- [ ] **Step 5: Manual check (dev server)**

Open an existing service list. Confirm: the full site search (title and lyrics, with snippets and the fuzzy fallback) is available directly on this page; dragging a result onto a section places it there and persists (reload the page and confirm it's still there); tapping a result lands it in Unsorted, which has no further restriction here (no gate, no nagging — confirm you can leave a song there indefinitely and the page doesn't complain); the up/down arrows move a song between sections; section Rename/Remove still work exactly as before.

- [ ] **Step 6: Commit**

```bash
git add "src/pages/set/[id].astro"
git commit -m "feat: give an existing service list the same search-and-drag add-song flow"
```

---

### Task 8: Remove the song page's "Add to List" button

**Files:**
- Modify: `src/pages/song/[slug].astro`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Move `recordView`'s song id off the removed button**

Add `data-song-id={song.id}` to the `<div class="page">` element (the file's existing root wrapper). In the script block that currently does `import { recordView } from '../../lib/recent.js'` and reads `addToSetBtn.dataset.songId`, change it to read `document.querySelector('.page').dataset.songId` instead, and remove the `addToDraft` import and the whole `addToSetBtn`/click-handler block. Keep `recordView(...)` itself — "Recently Viewed" tracking is unrelated to this removal and must keep working.

- [ ] **Step 2: Remove the button itself**

Delete the `<button id="add-to-set" ...>Add to List</button>` element from the `.actions` div. Leave Copy link and Favorite untouched.

- [ ] **Step 3: Run the project's tests and build**

Run: `npm test && npm run build`
Expected: PASS, every test; build prints `Complete!`.

- [ ] **Step 4: Manual check (dev server)**

Open a song page. Confirm: no "Add to List" button is present; Copy link and Favorite still work; the song still appears in "Recently Viewed" after being opened (recordView still fires).

- [ ] **Step 5: Commit**

```bash
git add "src/pages/song/[slug].astro"
git commit -m "feat: remove the song page's quick-add button; adding a song now only happens inside a list"
```

---

### Task 9: Full verification

**Files:** none modified (fix-ups only if a check fails).

- [ ] **Step 1: Run everything**

Run: `npm test && npm run build`
Expected: every test passes; build prints `Complete!`.

- [ ] **Step 2: Confirm nothing still references the removed draft**

Run: `grep -rn "DRAFT_KEY\|getDraftIds\|addToDraft\|saveDraftAsPlaylist\|songSearchSetDraft" src/`
Expected: no matches (the `localStorage` key `songSearchSetDraft` and every function that touched it are gone).

- [ ] **Step 3: Walk the Review Focus list end to end in the browser**

Using `npm run dev`: create a list and confirm the Create gate genuinely checks all four conditions independently (not just whichever was last true); confirm an already-placed song never reappears in that list's own search results; confirm keyboard/tap-only placement (no drag) works on both the creation screen and an existing list's page; place a song into a section that currently has zero songs and confirm it lands correctly; try to create a 51-song or 11-section list and confirm the existing caps still fire.

- [ ] **Step 4: Spec check**

Read `docs/superpowers/specs/2026-11-01-service-list-rebuild-design.md` once more and confirm every Goal, Non-goal, and Anti-goal holds against the finished branch; fix anything missing and commit as `fix: ...`.

- [ ] **Step 5: Report**

Report the commit list (`git log --oneline`) and tell the user the work is committed locally, not pushed or deployed, with each task revertable by its own commit. Offer: `npm run build && npx wrangler deploy` after they've reviewed it.

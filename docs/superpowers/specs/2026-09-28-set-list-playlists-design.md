# Set List Playlists — Design

## Goal

Turn the existing "shareable set list" feature into something that behaves
like a Spotify/YouTube playlist: each set list has its own name, and every
set list you create or open (via someone else's link) can be saved into a
personal library you can browse later — all without adding any account or
login system to a site that has never had one.

## Relationship to the existing set-list feature

The underlying mechanism — one Cloudflare KV entry per set list, edited via
`POST`/`GET`/`PUT /api/setlists`, reachable by anyone who has its 10-character
ID in a link — is unchanged. This spec adds a `name` to that stored data, and
replaces the current "one live set at a time" client-side model with a
"library of many saved playlists" model. It touches the same files the
original feature built: `src/lib/setlist.js`, `src/lib/setlist-client.js`,
`src/pages/api/setlists/*.js`, `src/pages/set/[id].astro`, `src/pages/index.astro`,
and `src/pages/song/[slug].astro`.

## Data model

**Server (KV)** — each entry gains a `name`:
`{ "songIds": string[], "name": string, "updatedAt": string }`.

**Local storage (per-browser)**:
- `songSearchSetDraft` — unchanged in spirit: an array of song IDs for the
  playlist currently being built, not yet saved.
- `songSearchPlaylists` — **new**, replaces the old `songSearchSetId`. An
  array of `{ "id": string, "name": string }`, most-recently-saved-or-opened
  first. This array *is* the local library — "Your Playlists" is just this
  list rendered.

The old single "live set" concept (`songSearchSetId`, and the draft-vs-live
branching in `getLiveSetId`/`addSongToSet`/`removeSongFromSet`/
`reorderSongInSet`/`shareSet`/`startNewSet`) is removed entirely and replaced
by the simpler model below. Any leftover `songSearchSetId` key in an
existing visitor's browser becomes inert and unused — no migration needed,
it's simply never read again.

## Name validation

- `MAX_SETLIST_NAME_LENGTH = 100` (`src/lib/setlist.js`).
- Creating a set list (`POST`) requires a non-empty name (after trimming)
  and at least one song — both validated server-side, same pattern as the
  existing song-list validation.
- Updating a set list (`PUT`) keeps `songIds` as a full replace (unchanged
  from today). `name` becomes **optional** on `PUT`: if the request omits
  it, the existing stored name is kept as-is; if the request includes it,
  it must pass the same non-empty/length validation as creation (you can
  rename a playlist, but never rename it to blank).
- This means every existing add/remove/reorder call against `/set/[id].astro`
  can keep sending only `songIds` — only the new rename action ever sends a
  `name` on `PUT`.

## API routes

### `POST /api/setlists`

Body: `{ "songIds": string[], "name": string }`. Validates both `songIds`
(existing rules: filter to known IDs, reject if empty or over 50) and `name`
(non-empty after trim, ≤100 chars). Rejects with `400` if either is invalid.
Returns `{ "id": string }`, unchanged.

### `PUT /api/setlists/:id`

Body: `{ "songIds": string[], "name"?: string }`. `songIds` validated as
today (full replace, empty allowed). If `name` is present in the body, it's
validated (non-empty, ≤100 chars) and replaces the stored name; if absent,
the route reads the existing stored name (from the same KV read already
done for the not-found check) and keeps it unchanged. Returns the updated
`{ songIds, name, updatedAt }`, same shape as `GET`.

### `GET /api/setlists/:id`

No route code changes — it already returns the raw stored KV value
directly, so once stored values include `name`, `GET` returns it for free.

## Client library changes (`src/lib/setlist-client.js`)

This file is substantially simplified, since "+"-driven adds now always
target the local draft (never an already-saved playlist), removing the
draft-vs-live branching the original design needed:

- `fetchSetlist(id)`, `updateSetlist(id, songIds, name?)`,
  `createSetlist(songIds, name)` — the explicit-ID API wrappers, kept from
  the original design; `updateSetlist`'s `name` parameter is optional and
  only included in the request body when provided.
- `getDraftIds()` — unchanged, reads `songSearchSetDraft`.
- `addToDraft(songId)` / `removeFromDraft(songId)` /
  `reorderInDraft(songId, direction)` — replace `addSongToSet`/
  `removeSongFromSet`/`reorderSongInSet`. Always operate on
  `songSearchSetDraft` only, purely via `localStorage` — no network call,
  ever, since a draft is never "live."
- `getPlaylists()` — reads and returns the `songSearchPlaylists` array.
- `isInLibrary(id)` — `true` if `id` is already in `songSearchPlaylists`.
- `addPlaylistToLibrary(id, name)` — prepends `{ id, name }` to
  `songSearchPlaylists` (no-op if `id` is already present).
- `removePlaylistFromLibrary(id)` — filters `id` out of
  `songSearchPlaylists`. Local-only; never touches the server.
- `updatePlaylistNameInLibrary(id, name)` — updates the cached `name` for an
  existing library entry (used after a rename on `/set/[id]/`).
- `saveDraftAsPlaylist(name)` — the "Save" button's action: calls
  `createSetlist(getDraftIds(), name)`, and on success calls
  `addPlaylistToLibrary(id, name)` and clears `songSearchSetDraft`. Returns
  the new playlist's id. Throws on a failed request (caller shows a status
  message, same pattern as every other mutation in this feature).

`getLiveSetId`, `getCurrentSetIds`, `shareSet`, and `startNewSet` are
removed — there is no longer a single "current active set" to resolve;
`getDraftIds()` and the library functions above replace what they did.

## Client UX

### Home page — the "My Playlists" tab

The fourth tab (labeled "My Playlists", was "My Set") shows two stacked
sections:

1. **Currently building** — the draft: songs added via the "+" button on
   any result card (`buildCard` now always calls `addToDraft(song.id)`,
   with no live/draft branching), each with remove/reorder controls
   (`removeFromDraft`/`reorderInDraft`), a "Name this playlist" text input,
   and a "Save" button. Save is disabled until the name is non-empty
   (trimmed) and the draft has at least one song — same disabled-until-ready
   pattern already used elsewhere in this feature. Clicking Save calls
   `saveDraftAsPlaylist(name)`; on success the draft section clears back to
   empty/unnamed and the new entry appears in the list below — no
   navigation away from the tab.
2. **Your Playlists** — every entry in `getPlaylists()`: its name, a link
   to `/set/<id>/`, and a "Remove" action calling
   `removePlaylistFromLibrary(id)`. Song count is intentionally not shown
   here — `songSearchPlaylists` only caches `{id, name}`, and fetching each
   entry's current song count would mean one extra request per library
   entry just to render the list. Empty state: "You haven't saved any
   playlists yet."

### Song page — "Add to Set" button

Unchanged in placement/style; its click handler now calls `addToDraft(songId)`
instead of the old `addSongToSet`. Since this is now always a pure
`localStorage` write, the button no longer needs to handle a network
failure case for this action (though the button's existing disable/re-enable
transient-text pattern can stay as-is for consistency — it just never
actually hits a `catch` branch from this call anymore).

### `/set/[id]/` — opening and editing a playlist

Unchanged core behavior (view songs, add/remove/reorder, all via
`updateSetlist(setId, currentIds)`), plus:

- **Rename**: a small rename control next to the heading. Saving a new name
  calls `updateSetlist(setId, currentIds, newName)` and, if
  `isInLibrary(setId)`, also calls `updatePlaylistNameInLibrary(setId, newName)`
  so "Your Playlists" reflects the new name without a reload.
- **Save to My Playlists**: shown only when `!isInLibrary(setId)` (you
  opened this via someone else's link, or a different browser/device than
  where you created it). Clicking it calls
  `addPlaylistToLibrary(setId, currentName)`. Once saved, this button is
  replaced by a plain "✓ Saved" indicator — no duplicate entries possible
  (`addPlaylistToLibrary` is a no-op if already present, and the button
  itself only renders when not yet present).
- The page's `<h1>` and `<title>` show the playlist's actual name. Existing
  production set lists created before this change have no stored `name` —
  render `"Untitled Set"` as the fallback wherever a name would display.

## Validation and abuse handling

No change to the existing 50-song cap or unknown-ID filtering. The new
`name` field gets the same treatment: filtered/validated server-side
regardless of what any client sends, independent of the UI's own
disabled-button gating.

## Testing

- **Unit tests** (`src/lib/setlist.test.js`): a new `prepareSetlistName`
  (or equivalent) helper gets tests for — required mode rejects empty/
  whitespace-only, required mode rejects over `MAX_SETLIST_NAME_LENGTH`,
  required mode trims and accepts a valid name, optional mode (as used by
  `PUT`) is skippable. `buildSetlistValue` gets a test confirming it now
  includes `name` in its JSON output.
- **Playwright**, covering the full library flow end to end:
  - build a draft via the "+" buttons, name it, save it — confirm the draft
    clears and the new entry appears in "Your Playlists",
  - open that playlist's link in a fresh browser context — confirm
    "Save to My Playlists" appears (not yet in that context's library),
    click it, confirm it now appears in that context's "Your Playlists",
  - rename the playlist from `/set/[id]/` — confirm the library list's
    cached name updates without a reload,
  - remove it from the library — confirm it disappears from "Your
    Playlists" but the link still opens the same playlist when visited
    directly (with "Save to My Playlists" showing again, since it's no
    longer in that browser's library).

## Explicitly out of scope for this version

- **Real user accounts** — a library that follows you across devices would
  need actual authentication, a genuinely separate project from extending
  set lists. This version's library is per-browser, like the existing
  Favorites/Recently-Used lists already on this site.
- **Adding a song directly to an already-saved playlist while browsing** —
  e.g. a "+" dropdown letting you pick which playlist to add to. The "+"
  button always targets the current draft; adding to an existing playlist
  means opening it and adding from there. Worth revisiting later if the
  always-draft flow proves limiting in practice.
- **Deleting a playlist from the server** — "Remove" only forgets it
  locally; the underlying KV entry and its link keep working indefinitely,
  matching how set lists already had no delete path before this change.
- **Showing playlist names on the home page's old "Open shared set list"
  link** — moot under this design, since that single-live-set concept is
  being replaced by the library list, which already shows names directly.

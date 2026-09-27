# Shareable Set Lists — Design

## Goal

Let a user build a list of songs (a "set list" — e.g. the songs for a
Sunday service) and share it as a single link. Anyone who opens that
link sees the same songs, in order, and can add, remove, or reorder
them — changes are visible to everyone who has the link, since a set
list is stored server-side rather than encoded in the URL.

## Why this is architectural, not bounded

Every feature built on this site so far (favorites, recently used,
fuzzy search, keyboard shortcuts, the duplicates report) is either
pure client-side `localStorage` or generated once at build time from
`songs.json`. This site has had **zero server-side code or storage**
— `astro.config.mjs` is `output: 'static'`, and `wrangler.jsonc`
configures pure static-asset serving with no Worker logic.

A set list that stays live and editable after being shared cannot be
encoded in the URL (the whole point is that it changes after the link
exists) and cannot live only in one browser's `localStorage` (the
whole point is that it's shared). It needs real server-side storage
reachable from any device — a genuinely new capability for this
project. This spec adds the smallest version of that: one Cloudflare
KV namespace and three small API routes, with every existing page
left exactly as static as it is today.

## Data model

One Cloudflare KV namespace, bound as `SETLISTS`. Each set list is one
entry:

- **Key**: a random 10-character URL-safe ID (nanoid-style alphabet).
  Ten characters gives enough entropy that no one can guess or
  enumerate another set list's ID — the ID itself is the only access
  control, per the "anyone with the link can edit" decision below.
- **Value** (JSON): `{ "songIds": string[], "updatedAt": string }`.
  `songIds` references songs already in `songs.json` (the same stable
  IDs used by Favorites/Recently Used) — no song data is duplicated
  into KV, so a set list always reflects the current song database.
  `updatedAt` is an ISO timestamp, informational only (not used for
  conflict resolution — see below).

**Cap**: a set list may hold at most 50 song IDs. Enforced
server-side on every create/update; far more than any real service
needs (a typical set is 4–10 songs), and bounds how much one API call
can write.

**Concurrency**: last write wins. If two people edit the same set
list at the same moment, whichever `PUT` lands last is what's stored.
No locking, no merge logic — acceptable for a small team sharing one
link, and not worth the complexity otherwise.

## Access model

One link per set list; whoever has it can both view and edit — add,
remove, or reorder songs. There is no separate read-only link and no
notion of an owner. This was chosen over splitting view/edit access
into two links because it's simpler to build and to share (one link
to text the team), and fits the actual use case (a small, trusted
worship team), not a public-facing published set list.

## Rendering architecture

- `astro.config.mjs` switches from `output: 'static'` to
  `output: 'server'`, with the `@astrojs/cloudflare` adapter added
  (new dependency).
- Every existing page — `src/pages/index.astro`,
  `src/pages/song/[slug].astro`, `src/pages/duplicates.astro` — gets
  `export const prerender = true` added to its frontmatter. This
  keeps them building to plain static HTML at build time exactly as
  today; nothing about their behavior, performance, or deploy shape
  changes.
- Only the new set-list page and its API routes are actually
  server-rendered (the `output: 'server'` default when `prerender` is
  not set to `true`), so they run live in the Worker on each request.
- `wrangler.jsonc` gains a `kv_namespaces` binding for `SETLISTS`.

This means `wrangler deploy` now ships a Worker with real server
logic instead of pure static assets — still well over 99% static
under the hood, but a real shift from "static site" to "static site
plus a small live backend." The KV namespace itself must be created
once on the Cloudflare account (`wrangler kv namespace create
SETLISTS`) before this can deploy; that's a one-time setup action to
be confirmed separately before running it.

## API routes

All under `src/pages/api/setlists/`, server-rendered
(`prerender = false`, the default once `output: 'server'` is set).

### `POST /api/setlists`

- Body: `{ "songIds": string[] }`.
- Filters `songIds` down to IDs that actually exist in `songs.json`;
  unknown IDs are silently dropped rather than rejecting the whole
  request (a direct API call is the only realistic way to send one,
  since the real UI only ever adds IDs it already knows are valid).
- Rejects with `400` if the filtered list is empty (nothing worth
  saving — matches the client only ever showing "Share this set" once
  the draft has at least one song) or has more than 50 entries.
- Writes a new KV entry with a fresh random ID.
- Returns `{ "id": string }`.

### `GET /api/setlists/:id`

- Returns `{ "songIds": string[], "updatedAt": string }`.
- Returns `404` if the ID doesn't exist in KV.

### `PUT /api/setlists/:id`

- Body: `{ "songIds": string[] }` — the full new list (add, remove,
  and reorder all go through this; the client always sends the
  complete updated array, not a diff).
- Same unknown-ID filtering and 50-item cap as `POST`, except an empty
  list is allowed here (unlike `POST`) — removing every song from an
  already-shared set is a legitimate edit, not junk data.
- Returns `404` if the ID doesn't exist in KV (no upsert — a `PUT` to
  an ID that was never created is an error, not a silent create).
- On success, overwrites the KV entry and returns the same shape as
  `GET`.

## Client UX

Two independent entry points; a set list started via #1 exists at the
same `/set/[id]/` URL as one opened via #2 once it's been shared —
there is only one kind of set list.

### 1. Building a new set list, from the home page

- A small "+" button on every result card (in addition to the
  existing Favorite star, which stays song-page-only), and an "Add to
  Set" button on the song page next to Favorite.
  - **Before any set has ever been shared**: both append a song ID to
    a local draft, `localStorage['songSearchSetDraft']` — no network
    call, same pattern already used by Favorites/Recently Used.
  - **After a set has been shared** (i.e. `songSearchSetId` is
    remembered locally — see below): both instead send a `PUT` to
    that live set list, appending the song, so "adding a song" always
    means the same thing regardless of which button was used to get
    there.
- A fourth tab on the home page, **"My Set (n)"**, alongside All
  Songs / Favorites / Recently Used, showing either the local draft
  or the live remembered set (same rule as above) with remove and
  reorder (up/down) controls. Empty state: "No songs in your set yet
  — use the + button on any song to add one."
- A **"Share this set"** button in that tab, shown only while working
  from a local draft (not once a set is already live), disabled until
  the draft has at least one song. Clicking it does one
  `POST /api/setlists` with the draft, then:
  - stores the returned ID in `localStorage['songSearchSetId']`,
  - clears the local draft (it's now superseded by the live set),
  - redirects to `/set/<id>/`.
- A **"Start a new set"** action in the "My Set" tab, visible once a
  set is live, that clears `songSearchSetId` (the existing set list
  keeps existing in KV and at its own link — this only forgets it
  locally) so the tab reverts to a fresh empty draft. Without this,
  someone who's already shared one set would have no way to build a
  second, separate one from the home page.

### 2. Opening a set list someone shared

- `src/pages/set/[id].astro` (`prerender = false`). Server-side `GET`
  on load renders the current songs — title, author, link to its own
  song page — in order, each with remove and reorder controls, plus a
  small search box to add more songs (reusing the existing search
  logic, filtered to what isn't already in the set).
- Every change (add/remove/reorder) immediately fires a `PUT` with
  the new full list. There is no separate "edit mode" — the controls
  are just always there, since anyone with the link can already use
  them.
- A "Copy link" button, matching the existing pattern on the song
  page.
- Unknown/bad `:id` shows a plain "This set list doesn't exist"
  message instead of an error page.
- If the stored `songIds` include an ID no longer present in
  `songs.json` (a song was later removed from the database), that
  entry is silently skipped when rendering — old shared links degrade
  gracefully rather than breaking.

## Validation and abuse handling

- Every create/update filters to known song IDs and enforces the
  50-song cap, server-side, regardless of what the client sends.
- No custom rate-limiting is being built for this first version.
  Cloudflare's edge provides baseline protection, and the 50-song cap
  already bounds how much one request can write. If abuse becomes a
  real problem later, Cloudflare's dashboard-level rate-limiting rules
  are the right fix — not custom code in this project.

## Testing

- **Unit tests** (`node --test`, same setup as the rest of the repo):
  the pure validation logic — filtering unknown IDs, enforcing the
  50-item cap — lives in `src/lib/setlist.js` so it's testable without
  a live KV store or running Worker.
- **Playwright**, run against `astro dev` (the Cloudflare adapter runs
  a local Miniflare-backed KV automatically in dev mode, isolated
  from production — nothing real is touched by tests):
  - add songs to a draft from both entry points (result card "+" and
    song-page "Add to Set"),
  - share it and confirm the redirect and a working `/set/<id>/` page,
  - open that link in a fresh browser context (simulating a different
    person/device), confirm the same songs appear in order,
  - edit from that fresh context (remove one song, reorder two),
  - reload the original tab's `/set/<id>/` and confirm it reflects
    the edit — this is the actual proof that shared mutability works,
  - attempt to exceed the 50-song cap and confirm it's rejected,
  - visit a nonexistent `/set/<bogus-id>/` and confirm the friendly
    not-found message.

## Explicitly out of scope for this version

- **Lyrics walkthrough view** (stepping through each song's full
  lyrics inline on the set page, Next/Prev-style) — considered and
  declined for now in favor of a simple ordered list of links to each
  song's existing page. Worth revisiting later if a plain list proves
  insufficient for someone actually leading a service.
- **Separate view-only vs. edit links** — declined in favor of one
  link with full access, per the Access Model section above.
- **Deleting a set list entirely** — not included; a set list simply
  sits in KV indefinitely once created (KV storage cost at this
  site's scale is negligible). Could be added later (e.g. a "delete
  this set" button) if it turns out to matter.
- **Custom rate-limiting / abuse tooling** beyond the 50-song cap —
  see Validation and abuse handling above.

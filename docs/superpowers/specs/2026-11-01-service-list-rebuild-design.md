# Service List Rebuild — Design

## Intent

Feedback says building a service list is hard and clunky enough that it's turning
people away from the site. Two specific complaints: adding songs is difficult, and
telling Opening Worship, Praise, and Closing Worship apart is tedious. The root
cause, per the person who requested this: the current flow interleaves adding
songs, creating sections, and naming the list, so you're constantly backing out of
one task to do another. This rebuild makes the shape decision (name + sections)
happen once, up front, before any song-adding starts, and replaces "search
somewhere else, then walk the song into place with arrows" with dragging a song
straight to where it belongs.

This is a full rework of the Service List tab and everything reachable from it —
not a visual restyle. Behavior changes; the plain-CSS/vanilla-JS, no-new-dependency
approach the rest of the site uses does not.

## Current state (for the builder's orientation)

A service list is stored as one ordered array (`songIds` in
`src/lib/setlist.js`/`src/lib/sections.js`): a mix of song-id strings and heading
objects (`{ section: "Praise" }`). Songs before the first heading are already,
structurally, an unlabeled leading group — `groupBySection()` in
`src/lib/sections.js` already splits the array this way. A list is created via
`POST /api/setlists`, which requires at least one valid song
(`prepareSongIdsForCreate` in `src/lib/setlist.js`) and is public immediately
(`toListEntries`, the "All Service Lists" listing) — there is no private/draft
state server-side today, and this design does not add one.

Today, building a list happens in a `localStorage`-only draft
(`src/lib/setlist-client.js`: `DRAFT_KEY`, `getDraftIds`/`addToDraft`/etc.), shown
as "Currently building" on the Service List tab (`renderPlaylistsTab()` in
`src/pages/index.astro`). You add songs to it from the global search results (the
`+` button in `buildCard()`) or from a song's own page, add sections via a
dialog-prompted "Add section" button, reorder with up/down arrow buttons
(`buildPlaylistSongRow`, `buildDraftHeadingRow`), and finally name it and click
Save, which POSTs the draft and clears it (`saveDraftAsPlaylist`). An already-saved
list's own page (`src/pages/set/[id].astro`) has a separate, smaller "Add a song"
search box and the same arrow-based reordering, auto-persisting every change via
`PUT /api/setlists/:id` with no explicit save step.

## Goals

- Creating a list's shape — its name and its sections — happens in one step,
  before any song is added, so no one has to interrupt adding a song to go make a
  section.
- Adding a song is a drag: find it, drag it to the section it belongs in. A tap
  also works, landing the song in a clearly-separate "Unsorted" holding area
  instead of guessing where it goes.
- Moving an already-placed song to a different section works by drag, or by
  up/down arrow buttons on that song's own row — both, not a forced choice.
- The entire song-finding experience is the one, real, site-wide search (title and
  lyrics, same as the home page's main search) — not a smaller, separate search
  box. It appears both while creating a list and afterward, on the list's own
  page, as the same thing.
- The `localStorage` draft concept is gone. There is no "Currently building" state
  that lingers across visits. Creating a list is one linear action.
- A list cannot be created emptyhanded: it needs a name, at least one section, and
  at least one song already placed into a section (not left in Unsorted) — the
  existing anti-spam floor, reinterpreted for the new flow. After that moment,
  Unsorted is a normal holding area with no further restriction — nothing nags or
  blocks you from leaving a song there indefinitely once the list exists.
- Works the same shape on a phone as on a desktop: sections stack in one column,
  confirmed with the person requesting this against two mocked-up layouts.

## Non-goals

- No change to who can see or edit a list — everything stays public and
  co-editable, exactly as today. No private/draft state is introduced for
  already-created lists.
- No change to "Your Service Lists" (the local bookmark list), "All Service
  Lists" (grouped by day), rename, Copy link, Delete, or the soft-delete behavior.
  Those are untouched.
- No visual redesign beyond what this flow change requires. This is not a styling
  pass.
- No drag-and-drop library and no new npm dependency of any kind. The rest of the
  site has none, and nothing here needs one (see Constraints).

## Anti-goals

Ship this and it's a failure if:
- Someone on a phone can't place a song at all because drag doesn't work on
  touch and there's no fallback. (The arrow-button fallback exists specifically
  to make this impossible — if an implementation drops it, that's a regression,
  not a simplification.)
- The "at least one section, one sectioned song, Unsorted empty" creation gate
  is enforced loosely enough that empty or junk lists can still be spammed into
  "All Service Lists."
- The rebuild quietly reintroduces a lingering, cross-visit local draft under a
  different name.

## Decisions made with the requester

- **Structure before content.** Name and sections are set before any song exists
  in the list. (Their stated root cause for why the current flow is clunky.)
- **Drag to place, tap falls back to Unsorted.** A standing "Unsorted" bucket
  catches anything not dragged.
- **Unsorted is a holding area only** — it should be empty before the list is
  created, but once the list exists, nothing about it is enforced again.
- **Moving a placed song:** drag again, or the up/down arrow buttons already on
  each song row (confirmed as exactly two mechanisms, not three).
- **Searching happens on the list itself**, using the same search as the main
  site (title and lyrics), not a separate smaller search box — both during
  creation and afterward, on the list's real page.
- **Save keeps its current meaning and behavior** — one action, creates a real,
  immediately-public list, same as today. What changed is where that action sits
  in the sequence (now right after the first song is placed, not after an
  open-ended build session) and what it requires (see Goals).
- **Layout: stacked, not side-by-side columns.** Shown two mockups (a
  single-column layout with sections stacked under the search box, and a
  kanban-style side-by-side board); the stacked layout was chosen specifically
  because it holds up at phone width without changing shape.

## Constraints

- No new runtime dependency. The site is plain Astro + vanilla browser JS with no
  framework; this holds for the drag-and-drop implementation too.
- Must work on touch (phone) and mouse/pointer (desktop) — this audience builds
  these lists from phones as often as desktops.
- The existing array-of-(song-id | heading) data model, `groupBySection()`, and
  the KV-backed `/api/setlists` endpoints are reused, not replaced. "Unsorted" is
  the existing leading group (`heading: null` in `groupBySection`'s output),
  surfaced and labeled — not a new field or a new part of the stored shape.
- `MAX_SETLIST_SIZE` (50 songs), `MAX_SETLIST_SECTIONS` (10), and
  `MAX_SECTION_NAME_LENGTH` (60) are existing limits and are not changed by this
  work.

## What's left to the builder

- **Where the creation flow lives in the UI.** It replaces the "Currently
  building" block on the Service List tab — a "New Service List" action starts
  it, inline on that same tab (no new route), matching how the tab already works
  today. This is a call, not something the requester weighed in on; correctable
  if it doesn't feel right once built.
- **Drag-and-drop mechanics.** Implement with Pointer Events
  (`pointerdown`/`pointermove`/`pointerup`), which unify mouse and touch without
  a library — this is the natural fit given the no-dependency constraint and the
  touch requirement. Visual feedback during drag (what a hovered drop target
  looks like, whether a dragged row shows a ghost/placeholder) is left to
  whoever builds it, within the site's existing visual language.
  `components.css`'s existing `.row`/`.badge`/`.btn` classes should be reused
  rather than inventing new visual primitives where they already fit.
- **Creation-step validation wording and exact gate.** "At least one section,
  one song placed into a section, Unsorted empty" needs a real error message and
  a decision on whether the Create action is simply disabled until satisfied, or
  clickable-but-rejected with a message. Either is consistent with this design;
  pick what's simplest to build and keep consistent with how other validation
  errors surface on this site today (inline status text, not a popup).
- **What happens to `src/lib/setlist-client.js`'s draft functions**
  (`getDraftIds`, `addToDraft`, `removeFromDraft`, `reorderInDraft`,
  `updateDraft`, `saveDraftAsPlaylist`, the `DRAFT_KEY` constant) and the
  now-redundant minimal "Add a song" search box on `src/pages/set/[id].astro` —
  both should be removed as dead code once the new flow replaces them, not left
  behind unused.
- **Exact rendering of "Unsorted"** on the list's own page after creation (does
  it get a permanent, always-visible section-like row even when empty, or does
  it only appear once something's tapped into it?) — pick whichever reads more
  calmly given there's no more enforcement past creation; either is consistent
  with "no nagging after creation."
- Standard engineering concerns not specific to this feature: test coverage for
  the new validation rule and the Pointer Events drag logic, accessibility of the
  drag interaction (the arrow-button fallback already covers keyboard-only use,
  but drag targets should still be reachable/operable per the site's existing
  focus-visible conventions), and an implementation plan broken into reviewable
  steps (see `superpowers:writing-plans`, the next step after this document is
  approved).

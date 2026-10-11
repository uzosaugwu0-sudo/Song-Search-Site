# Service List Sections and Dates — Design

## Goal
Let a service list be split into custom, named sections (e.g. Opening Worship, Praise,
Closing Worship) and show a date on every list.

## Decisions (from brainstorming)
- Sections are fully custom: lists start with none; the creator adds and names them.
- The date is the **created date**, stamped automatically on first save. Existing lists
  use their last-updated time as their date.
- Everything stays public and anyone can edit, as today.

## Data model
A list value in KV (`SETLISTS`) becomes:

    { name, songIds: Item[], createdAt, updatedAt, deleted? }

    Item = string            // a song id
         | { section: string } // a heading; songs after it belong to that section

- The key keeps the name `songIds` so existing lists are already valid (all strings,
  no headings, which means one unnamed group).
- Limits: at most 50 songs (`MAX_SETLIST_SIZE`, unchanged), at most 10 headings
  (`MAX_SETLIST_SECTIONS`), heading text 1-60 characters after trim.
- A song id may appear at most once per list (existing behaviour).
- `createdAt` is set on POST and copied unchanged on every PUT and soft delete.
  `updatedAt` changes on every save.
- Legacy lists with no `createdAt`: the effective date is `createdAt ?? updatedAt`.
  The public listing's existing backfill pass also writes `createdAt = updatedAt` to
  them (in value and KV metadata) so they stop being legacy.
- KV metadata becomes `{ name, count, createdAt, updatedAt }`. `count` counts songs
  only, not headings.

## Server (src/lib/setlist.js, src/pages/api/setlists/*)
- `filterValidSongIds` is replaced by an item validator that keeps valid song ids,
  keeps well-formed headings (trimmed, length-checked, extras over the cap rejected
  with an error), drops unknown songs and duplicates, preserves order.
- Size checks count songs and headings separately; create still needs at least one song.
- `buildSetlistValue` takes `createdAt` and `updatedAt`; PUT reads the existing value to
  preserve `createdAt`.
- `toListEntries` sorts by effective created date, newest first.

## Client
- Draft (`localStorage`) uses the same `Item[]` shape; `addToDraft` and the reorder
  helpers work on mixed arrays; new helpers add, rename and remove a heading.
- "Currently building" and the list page both get an **Add section** button. A heading
  row shows its name with rename, up, down and remove controls. Removing a heading keeps
  its songs (they fall into the section above).
- Songs before the first heading render under no label.
- Dates: shown as e.g. "Oct 12, 2026" (`toLocaleDateString`) in "All Service Lists" rows
  and under the title on the list page.
- The public listing is sorted by created date.
- The song page's back-link and list page keep working with heading items (headings
  are skipped wherever only songs are used, e.g. song count, song lookups).

## Error handling
- Invalid heading (empty, too long, over the cap) returns a 400 with a clear message,
  shown through the existing status line.
- Unknown item shapes are dropped on read rather than crashing the page.

## Testing
Unit tests (node --test) for: item validation (headings accepted, caps, dedupe, unknown
songs dropped), `createdAt` preservation and legacy fallback, metadata/count, listing
sort. UI is verified by build plus a manual check.

## Out of scope
Drag-and-drop, section templates, per-section dates, moving songs between lists, a
user-editable service date, a bulk migration script.

## Risk
An old browser tab open during deploy could save a list without headings. Brief and
acceptable.

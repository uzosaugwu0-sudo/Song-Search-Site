# Song Search Site — Design Spec

**Date:** 2026-09-20
**Version:** v1

A public site for searching a ProPresenter song database by title or lyrics, and sharing direct links to individual songs.

## 01. Purpose

A public website that lets anyone search a database of songs (from ProPresenter exports) by title or lyrics, view a song's full lyrics, and share a direct link to any song.

## 02. Source data

Two ProPresenter SQLite exports currently sitting in the project root.

| File | Table | Rows | Fields used |
|---|---|---|---|
| `Songs.db` | `song` | 1,283 | `song_uid`, `title`, `author` |
| `SongWords.db` | `word` | 1,283 | `song_id` (joins to `song.rowid`), `words` (lyrics, RTF) |

Only `title`, `author`, and `words` are used. `words` is stored as RTF and must be converted to plain text before use. There is no live connection to ProPresenter — data is refreshed by replacing the `.db` files and rebuilding.

## 03. Architecture

A static site built with **Astro**. A build-time Node script imports the two `.db` files into a single `songs.json`. Astro statically generates one HTML page per song plus a home page. The built output is plain static HTML/CSS/JS — no server, no database, no API in production. Hosted on **Cloudflare Pages**, connected to a GitHub repo for auto-deploy on push.

```
data/Songs.db + data/SongWords.db        (committed to repo)
        │
        │ npm run import → scripts/import-db.js
        ▼
src/data/songs.json                      { id, slug, title, author, lyrics }[]
        │
        │ npm run build → astro build
        ▼
dist/                                    index.html (search) + song/<slug>/index.html (one per song)
```

## 04. Data pipeline

`scripts/import-db.js`

1. Open `data/Songs.db` and `data/SongWords.db` via `node:sqlite`
2. Join `song.rowid == word.song_id`
3. Convert each song's RTF `words` field to plain text, preserving line breaks (verse/chorus structure)
4. Slugify each title for the URL (lowercase, hyphenated); if two titles collide, append the song's `song_uid` to disambiguate
5. Write `src/data/songs.json`: array of `{ id: song_uid, slug, title, author, lyrics }`

Slugs stay stable across re-imports as long as titles don't change, because the disambiguation fallback keys off the ProPresenter `song_uid`, not a rebuild-order index.

## 05. Site behavior

### Home page — `/`

- A single search input; results filter live as the user types, entirely client-side
- All 1,283 songs' title + lyrics (~1MB of text) are loaded in the browser up front — small enough for instant search with no server round-trip
- Matching rule: case-insensitive substring match — a song is a result if the query appears anywhere in its `title` **or** its `lyrics`
- Clicking a result navigates to that song's page

### Song page — `/song/<slug>`

- Shows title, author, and full lyrics
- A "Copy link" button copies the page's own URL for sharing
- Because each page is truly static, shared links unfurl correctly in chat apps and load without requiring JS

### Song not found

An unknown slug shows a friendly "song not found" page with a link back to search, rather than a raw 404.

## 06. Update workflow

The two `.db` files live in the repo at `data/Songs.db` and `data/SongWords.db`. Cloudflare Pages' build command runs the import script before the Astro build — `npm run import && npm run build` — so every deploy regenerates `songs.json` fresh from whatever `.db` files are currently in the repo.

**To publish new / updated songs:**

1. In ProPresenter, export the updated `Songs.db` and `SongWords.db`
2. Replace the two files in the repo's `data/` folder
3. Commit and push
4. Cloudflare Pages detects the push, reruns the build, and the live site updates automatically within a minute or two

```bash
git add data/Songs.db data/SongWords.db
git commit -m "Update song database"
git push
```

No terminal? Drag the two files into GitHub's web UI (repo → `data/` → "Upload files" → commit) — same push, same auto-rebuild.

## 07. Error handling

**Import script:** Fails loudly (non-zero exit, clear message) if a `.db` file is missing or unreadable, or if RTF parsing yields empty lyrics for a song — logs which song(s) rather than silently dropping them, so a bad import is caught before it ships.

**Site:** An unknown `/song/<slug>` URL renders a "song not found" page instead of a generic error.

## 08. Testing

- Unit tests for the RTF-to-plain-text conversion, run against real sample records from the existing `.db` files
- Unit tests for slug generation, including the collision/disambiguation case
- Manual verification after each build: a few searches (title match, lyrics match, no match) and spot-checking that song pages render correctly

## 09. Out of scope — for this iteration

- Authentication / access control (site is fully public)
- An in-browser admin upload flow for `.db` files (updates go through git/GitHub)
- Fuzzy / typo-tolerant search (substring matching only, for now)
- Editing songs on the site (data is read-only, sourced from ProPresenter exports)

---
Song Search Site — Design Spec · drafted with Claude Code

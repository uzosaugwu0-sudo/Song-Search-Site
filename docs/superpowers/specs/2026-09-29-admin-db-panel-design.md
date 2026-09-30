# Admin Panel for Song Database Uploads — Design

## Goal

Replace the current "upload raw `.db` files to GitHub, wait for someone to
notice and manually redeploy" workflow with an in-site admin panel: a dev
logs into `/admin/` with a shared password, uploads `Songs.db` +
`SongWords.db` directly, the site parses and validates them, and the change
is live within seconds — no GitHub, no `npx wrangler deploy`. The panel also
keeps a timestamped backup of every previous database pair, browsable and
restorable from the same panel.

The admin panel is part of this same website — more routes in the same
Astro project, served by the same Cloudflare Worker at the same domain
(`song-search-site.uzosaugwu0.workers.dev/admin/`) — not a separate app,
service, or deployment.

## Relationship to the existing data flow

Today: `npm run import` runs locally, uses Node's `node:sqlite` (a
Node-only API, unavailable in the Cloudflare Workers runtime) to read
`data/Songs.db` + `data/SongWords.db`, and writes `src/data/songs.json`.
That file is **statically imported at build time**
(`import songs from '../data/songs.json'`) into four pages:
`src/pages/index.astro`, `src/pages/song/[slug].astro`,
`src/pages/set/[id].astro`, `src/pages/duplicates.astro`. A new
`songs.json` only takes effect after `npm run build && npx wrangler deploy`.

For an admin-panel upload to go live without a rebuild/redeploy, this
spec changes those four pages from a **build-time static import** to a
**runtime read from Cloudflare KV**, fetched at request time. This is the
one structurally significant change everything else in this spec depends
on.

The local dev workflow is preserved as a fallback/seed path (see
"Local development story" below) — `npm run import` still produces
`src/data/songs.json` from the local `.db` files, and a small seed step
loads that JSON into a **local** KV namespace so `npm run dev` has data to
read without ever touching production data.

The two `.db` files currently checked into `data/` remain in the repo
(not deleted by this spec) but become vestigial once KV/R2 is the
production source of truth — cleaning them up is a separate future
decision, not part of this spec.

## Auth

A new `/admin/` area, gated by a single password shared across the dev
team (not per-dev accounts).

- **Secret storage**: the password is a Cloudflare Worker secret
  (`wrangler secret put ADMIN_PASSWORD`), never committed to the repo. A
  second secret, `ADMIN_SESSION_SECRET`, signs session tokens.
- **Login**: `/admin/login` — a plain HTML form posting to
  `POST /api/admin/login` with the password. On a match, the Worker sets a
  signed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie: an
  HMAC-SHA256-signed token (`payload.signature`, base64url) containing an
  expiry timestamp. No session store — verifying the signature and
  checking the expiry is enough, so no new KV table is needed just for
  sessions.
- **Session length**: 12 hours from login. Logout
  (`POST /api/admin/logout`) clears the cookie immediately.
- **Guarding admin routes**: every `/admin/*` page and `/api/admin/*`
  endpoint (except `/admin/login` and `POST /api/admin/login`) verifies
  the session cookie server-side before rendering or acting. Missing or
  invalid/expired cookie → redirect to `/admin/login` for page routes,
  `401 { "error": "Not authenticated" }` for API routes.
- **Login rate limiting**: a KV-backed counter keyed by request IP,
  capped at 10 failed attempts per 15-minute window; exceeding it returns
  `429 { "error": "Too many attempts, try again later" }` from
  `POST /api/admin/login` regardless of whether the password was correct.
  Reuses the same `SETLISTS`-style KV binding pattern already in this
  codebase (a new key prefix, e.g. `login-attempts:<ip>`, in a KV
  namespace — can be the existing `SETLISTS` KV or a new one; this spec
  uses a new binding `ADMIN_RATE_LIMIT` to avoid mixing concerns with set
  lists).
- **No password reset flow**: rotating `ADMIN_PASSWORD` via
  `wrangler secret put` *is* the reset mechanism.

## Storage architecture

Two new Cloudflare resources, bound in `wrangler.jsonc` alongside the
existing `SETLISTS` KV namespace:

### R2 bucket: `SONG_DB_FILES`

Holds the raw `.db` files:

- `current/Songs.db`, `current/SongWords.db` — the active pair, mirroring
  what's live.
- `current/meta.json` — `{ "uploadedAt": ISO-string, "songCount": number }`,
  written alongside `current/*.db` on every successful upload/restore.
- `backups/<ISO-timestamp>/Songs.db`, `backups/<ISO-timestamp>/SongWords.db`
  — one folder per upload, named at upload time (before the new pair
  overwrites `current/`). `<ISO-timestamp>` is the upload time formatted
  as `YYYY-MM-DDTHH-mm-ss` (colons replaced with hyphens — R2 keys allow
  colons, but hyphens keep the keys friendlier to read/sort in tooling and
  avoid ambiguity with any future path-based routing).
- Listing objects under the `backups/` prefix, sorted descending by key,
  gives the admin panel's backup history — R2's lexicographic key
  ordering matches chronological order for this timestamp format, so no
  extra index is needed.
- No pruning: every backup is kept indefinitely (per your explicit
  choice — file pairs are a few MB each, so even years of weekly updates
  cost negligible R2 storage).

### KV namespace: `SONGS_DATA`

Holds the parsed, ready-to-serve song list:

- Single key `songs` storing the same JSON shape `src/data/songs.json`
  has today: `{ id, title, author, lyrics, slug }[]`.
- This is what the four pages (see "Relationship to the existing data
  flow") read at request time instead of the static import.

## Upload flow

`POST /api/admin/upload`, `multipart/form-data` with two file fields,
`songsDb` and `wordsDb`:

1. **Auth check** — reject with `401` if the session cookie is missing/
   invalid, before touching any storage.
2. **Presence/type check** — both files must be present and their first
   16 bytes must match the SQLite file header magic string
   (`SQLite format 3\0`). Reject with
   `400 { "error": "<field> is not a valid SQLite database file" }`
   otherwise. Nothing is written to R2/KV on this failure.
3. **Backup the current pair** — copy `current/Songs.db` and
   `current/SongWords.db` to a new `backups/<timestamp>/` folder in R2 (an
   R2 copy operation, not a rename — R2 has no rename op, and copying
   before overwriting is what "date/rename the old files" means here). If
   `current/*.db` doesn't exist yet (first-ever upload), this step is
   skipped.
4. **Parse the newly uploaded files** using a WASM SQLite reader
   (`sql.js`) running inside the Worker, running the same extraction and
   validation rules `scripts/import-db.js` already applies:
   - Every song must have a non-empty `title` and non-empty `song_uid` —
     rows failing this are collected and reported, upload is rejected if
     any exist.
   - Every song must produce non-empty lyrics after RTF-to-plain-text
     conversion (reusing `scripts/rtf-to-text.js`'s logic, ported to run
     in the Worker) — songs failing this are collected and reported,
     upload is rejected if any exist.
   - Slugs are assigned via the same logic as `scripts/slugify.js`.
5. **On validation failure** (step 4 found bad rows): respond
   `400 { "error": "Import failed: ...", "details": [...] }` with the
   same kind of row-by-row messages `import-db.js` produces today (e.g.
   `"O Come Let Us Adore Him" (row 42): missing/invalid song_uid`). Nothing
   in `current/` or `SONGS_DATA` changes — the backup made in step 3 is
   harmless (an extra, unused backup folder) but not undone, since leaving
   it costs nothing and undoing an R2 copy adds failure-handling
   complexity for no benefit.
6. **On success**: write the two uploaded files to `current/Songs.db` /
   `current/SongWords.db` in R2, write `current/meta.json` with the new
   `uploadedAt`/`songCount`, and write the parsed song array as JSON to
   the `SONGS_DATA` KV key `songs`. Respond
   `200 { "songCount": number, "duplicateGroups": number }` — the
   `duplicateGroups` count comes from running the existing
   `duplicate-groups.js` logic against the new song list, giving the same
   kind of signal the `/duplicates/` page already provides, surfaced
   immediately instead of requiring a separate visit.

## Restore flow

`POST /api/admin/restore`, JSON body `{ "timestamp": "<backup-folder-name>" }`:

1. **Auth check** — same as upload.
2. **Look up the backup** — `404 { "error": "Backup not found" }` if
   `backups/<timestamp>/Songs.db` or `.../SongWords.db` doesn't exist in
   R2.
3. **Run the same steps 3-6 as the upload flow**, sourcing the two files
   from `backups/<timestamp>/` in R2 instead of a fresh multipart upload —
   i.e. restore is "upload" with the file source swapped, so it shares
   upload's backup-then-validate-then-commit behavior and can fail
   cleanly (with the same error shape) if that old backup somehow doesn't
   parse against current validation rules.

## Admin panel UI

Plain server-rendered Astro pages with vanilla `<script>` tags, matching
the rest of the site (no client framework anywhere in this codebase).

### `/admin/login`

- Password field, submit button.
- On `401` from `POST /api/admin/login`: show "Incorrect password" (no
  distinction between "wrong password" and "rate limited" beyond the
  `429` case showing "Too many attempts, try again later").
- On success: redirect to `/admin/`.

### `/admin/` (dashboard)

- **Current status** section: reads `current/meta.json` from R2 server-side
  at render time, shows song count and "Last updated: <formatted
  uploadedAt>". Shows "No database uploaded yet" if `current/meta.json`
  doesn't exist.
- **Upload form**: two file inputs (`Songs.db`, `SongWords.db`) + submit.
  On submit: a status line (matching the existing `#status`-line pattern
  used in `index.astro`/`set/[id].astro`) shows "Uploading…", then either
  a success message ("Imported 342 songs. 3 possible duplicate groups —
  check /duplicates/.") or the validation error list from the response
  body, one item per line.
- **Backup history list**: every `backups/<timestamp>/` entry, newest
  first, each row showing the human-formatted timestamp and a "Restore"
  button. Clicking Restore shows a native `confirm()` dialog ("Replace
  the live database with the backup from <timestamp>?") before firing
  `POST /api/admin/restore` — matching this site's existing convention of
  confirming before impactful actions (e.g. the set-list library's
  Remove buttons).
- **Logout** link/button firing `POST /api/admin/logout` then redirecting
  to `/admin/login`.

No drag-and-drop, no upload progress bar — a simple busy/status line is
consistent with the rest of the site's minimal-JS style.

## Local development story

`npm run dev` needs song data to render against, without touching
production KV/R2.

- The four pages' runtime KV read uses Astro's Cloudflare `platformProxy`
  (already enabled in `astro.config.mjs`), which backs KV access during
  `astro dev`/`wrangler dev` with Wrangler's local KV emulation
  (`.wrangler/state`) — standard Wrangler local-dev behavior, no new
  tooling required.
- `npm run import` keeps producing `src/data/songs.json` from
  `data/Songs.db` + `data/SongWords.db` exactly as today.
- A new `npm run seed-local-kv` script reads `src/data/songs.json` and
  writes it into the **local** `SONGS_DATA` KV namespace (via
  `wrangler kv key put --local --binding=SONGS_DATA songs "$(cat ...)"`
  or the equivalent Miniflare-backed API), so `npm run dev` has data to
  read immediately after `npm run import`. `README.md`'s "Develop"
  section gains this as a third step:
  `npm install && npm run import && npm run seed-local-kv && npm run dev`.
- This local KV namespace is entirely separate from the production one —
  no local script ever writes to production KV or R2.

## Testing

- **Unit tests** (`node --test`, matching the existing
  `scripts/*.test.js` / `src/lib/*.test.js` pattern):
  - The Worker-side parser (sql.js-based): same fixture-driven cases
    `scripts/import-db.test.js` already covers — valid rows, missing
    title/uid, empty lyrics — run against the new implementation to
    confirm behavior parity with `node:sqlite`-based `import-db.js`.
  - Session cookie signing/verification: valid token accepted, tampered
    token rejected, expired token rejected.
  - Backup-key timestamp formatting and newest-first sorting.
  - SQLite magic-byte validation: valid header accepted, non-SQLite file
    rejected.
- **Manual/live verification** (same pattern used for the set-list-
  playlists feature — checked against the live or preview deployment,
  not just unit tests):
  - Wrong password rejected; correct password accepted.
  - Valid upload: song count updates, a page load reflects the new data
    with no redeploy.
  - Invalid upload (e.g. a row with empty lyrics): clear error shown,
    `current/` and `SONGS_DATA` unchanged, old data still live.
  - Restore: reverts to the chosen backup's data, count matches that
    backup.
  - Login rate limiting: 11th rapid failed attempt within 15 minutes
    returns 429.
- Because this introduces authentication and file upload handling, it
  goes through a security-focused review pass during implementation —
  input validation on uploads, session cookie flags (`HttpOnly`,
  `Secure`, `SameSite=Strict`), no secret leakage in error messages, and
  confirming the rate limiter keys on Cloudflare's own
  `CF-Connecting-IP` header (set by Cloudflare's edge, not
  client-suppliable) rather than a client-controlled header like
  `X-Forwarded-For`.

## Explicitly out of scope

- **Per-dev accounts or an audit trail of who uploaded what** — one
  shared password, no per-dev identity. `current/meta.json` does not
  capture "uploaded by"; adding a required "your name" field is a small,
  separate future addition if it turns out to be wanted.
- **Automatic pruning of old backups** — every backup is kept forever.
- **Song-level editing from the admin panel** (fixing one bad lyric,
  renaming a title, etc.) — this spec replaces how the *entire* database
  gets swapped, not song-level CRUD. A separate future feature if needed.
- **Password reset UI** — rotating `ADMIN_PASSWORD` via
  `wrangler secret put` is the reset mechanism.
- **Deleting the two `.db` files still checked into `data/`** — they
  become vestigial once KV/R2 is the source of truth in production, but
  remain in the repo as the local-dev seed source; removing them is a
  separate cleanup decision, not part of this spec.
- **Reconciling `HOW-TO-UPDATE-SONGS.md`'s claim of automatic updates**
  with the (previously accurate, now-obsolete) manual-deploy reality —
  this spec makes that doc's claim true again for the new admin-panel
  path, but rewriting `HOW-TO-UPDATE-SONGS.md` itself to describe the new
  `/admin/` flow (replacing the GitHub-upload instructions) is an
  implementation-plan-level documentation task, not a design decision,
  and will be handled as a task in the implementation plan.

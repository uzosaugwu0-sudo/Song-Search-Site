# Song Search Site

Static site for searching a ProPresenter song database by title or lyrics.
Design spec: `docs/superpowers/specs/2026-09-20-song-search-site-design.md`.

## Keyboard shortcuts

For searching and selecting a song without a mouse (handy during a live service):

| Key | Action |
|-----|--------|
| `/` | Focus the search box |
| `↑` / `↓` | Move the highlighted selection through the result cards |
| `Enter` | Open the selected song |
| `Esc` | Leave the search box so the arrow keys can navigate results |
| `F` | Toggle favorite on the selected song |

Shortcuts are inactive while typing in the search box, so normal typing (including letters that overlap a shortcut, like "f" or "/") is unaffected.

## Service lists

Build a list of songs (e.g. for a Sunday service) using the "+" button
on any search result or the "Add to List" button on a song page — both
add to your current in-progress draft. When it's ready, open the
"Service List" tab, give the draft a name, and click "Save". This
creates a shareable link like `/set/<id>/` and adds the service list to
your personal library, shown as "Your Service Lists" on that same tab.
Anyone with the link can view it and add, remove, or reorder songs —
changes are visible to everyone who has the link, since the list lives
in a Cloudflare KV store, not in the URL itself.

Opening a service list someone else shared with you shows a "Save to
Service List" button, which bookmarks it into your own library too.
"Remove" in your library only forgets it locally — it doesn't delete
the list, so the link keeps working for anyone who has it.

The "Recently Viewed" tab lists the last 20 songs opened on that device.
To keep it from going stale, it clears itself after every 50 song views
(the next song opened starts a fresh list).

## Develop

    npm install
    npm run import         # data/Songs.db + data/SongWords.db -> src/data/songs.json
    npm run seed-local-kv  # loads src/data/songs.json into local KV, so `dev` has data to read
    npm run dev

## Build

    npm run import && npm run build

## Update the song database

The song database is updated through the admin panel at `/admin/` — log in
with the shared admin password, upload `Songs.db` and `SongWords.db`, and
the site updates immediately, no redeploy needed. See
[`HOW-TO-UPDATE-SONGS.md`](HOW-TO-UPDATE-SONGS.md) for the non-technical
version of these steps.

The two files in `data/` and `npm run import` remain useful for local
development (see [Develop](#develop) above) but are no longer how
production data gets updated.

After updating, check `/duplicates/` on the live site for a report of songs
that may be duplicates (same title once case/punctuation/spacing are
ignored) — it's not linked from the home page, so visit it directly. The
admin panel also shows a duplicate-group count right after each upload.

## Admin panel setup

The admin panel needs three Cloudflare resources beyond the ones this repo
already uses (see [Deployment](#deployment) for the base setup):

- Two KV namespaces, bound as `SONGS_DATA` and `ADMIN_RATE_LIMIT`
- One R2 bucket, bound as `SONG_DB_FILES`
- Two Worker secrets, `ADMIN_PASSWORD` (the shared dev-team login) and
  `ADMIN_SESSION_SECRET` (a long random string used to sign session
  cookies — not something anyone types in day-to-day)

These are one-time setup steps, already run for this project's Cloudflare
account. To rotate the admin password, run `npx wrangler secret put
ADMIN_PASSWORD` and enter a new value.

On first deploy, `SONGS_DATA` is empty and the site will show no songs until
someone logs into `/admin/` and uploads a database. To avoid a blank-looking
site in the gap between deploying and that first upload, pre-seed production
KV before deploying: `npx wrangler kv key put --binding=SONGS_DATA --remote
songs --path=src/data/songs.json` (requires `src/data/songs.json` to exist
locally — run `npm run import` first if needed).

## Deployment

- Build command: `npm run import && npm run build`
- Build output directory: `dist`
- Deploys are manual: after pushing, run `npx wrangler deploy`. There is
  no GitHub Actions workflow and no Cloudflare Pages Git integration —
  nothing auto-deploys on push.
- Node version: controlled by the `.node-version` file at the repo root (currently `24`). `wrangler deploy` does not read `package.json`'s `engines` field, so if `.node-version` is ever removed or not respected, set the `NODE_VERSION` environment variable instead (`node:sqlite` requires a recent Node).
- This site deploys a real Worker (not pure static assets) to
  support set lists — `wrangler deploy` ships `dist/_worker.js/` as
  the Worker entry, with everything else served as static assets. A
  Cloudflare KV namespace bound as `SETLISTS` is required; the binding
  is read directly from `wrangler.jsonc` (not a Pages dashboard) by
  `wrangler deploy`.

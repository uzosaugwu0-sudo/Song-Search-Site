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

## Set lists

Build a list of songs (e.g. for a Sunday service) using the "+" button
on any search result or the "Add to Set" button on a song page, then
open the "My Set" tab and click "Share this set" to get a link like
`/set/<id>/`. Anyone with that link can view it and add, remove, or
reorder songs — changes are visible to everyone who has the link, since
the set list lives in a Cloudflare KV store, not in the URL itself.

## Develop

    npm install
    npm run import   # data/Songs.db + data/SongWords.db -> src/data/songs.json
    npm run dev

## Build

    npm run import && npm run build

## Update the song database

Replace `data/Songs.db` and `data/SongWords.db` with fresh ProPresenter
exports, commit, and push. Cloudflare Pages rebuilds automatically.

For a non-technical, no-git-required version of this (drag-and-drop via
GitHub's web UI), see [`HOW-TO-UPDATE-SONGS.md`](HOW-TO-UPDATE-SONGS.md).

After updating, check `/duplicates/` on the live site for a report of songs
that may be duplicates (same title once case/punctuation/spacing are
ignored) — it's not linked from the home page, so visit it directly.

## Cloudflare Pages settings

- Build command: `npm run import && npm run build`
- Build output directory: `dist`
- Connect the GitHub repo for auto-deploy on push to the default branch.
- Node version: controlled by the `.node-version` file at the repo root (currently `24`). Cloudflare Pages does not read `package.json`'s `engines` field, so if `.node-version` is ever removed or not respected, set the `NODE_VERSION` build environment variable instead (`node:sqlite` requires a recent Node).
- This site now deploys a real Worker (not pure static assets) to
  support set lists — `wrangler deploy` ships `dist/_worker.js/` as
  the Worker entry, with everything else served as static assets. A
  Cloudflare KV namespace bound as `SETLISTS` is required; see
  `wrangler.jsonc`.

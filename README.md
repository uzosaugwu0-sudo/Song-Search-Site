# Song Search Site

Static site for searching a ProPresenter song database by title or lyrics.
Design spec: `docs/superpowers/specs/2026-09-20-song-search-site-design.md`.

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

## Cloudflare Pages settings

- Build command: `npm run import && npm run build`
- Build output directory: `dist`
- Connect the GitHub repo for auto-deploy on push to the default branch.
- Node version: controlled by the `.node-version` file at the repo root (currently `24`). Cloudflare Pages does not read `package.json`'s `engines` field, so if `.node-version` is ever removed or not respected, set the `NODE_VERSION` build environment variable instead (`node:sqlite` requires a recent Node).

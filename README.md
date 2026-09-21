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

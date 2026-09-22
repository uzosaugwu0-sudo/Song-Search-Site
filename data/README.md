# data/

Drop the two ProPresenter SQLite exports here before building:

- `Songs.db` — the `song` table (`song_uid`, `title`, `author`)
- `SongWords.db` — the `word` table (`song_id` joins to `song.rowid`, `words` is RTF lyrics)

Commit both files to the repo. Every deploy runs `npm run import` against
whatever is currently in this folder, so replacing these two files and
pushing is the entire update workflow — see the design spec, section 06.

If a deploy fails because a song has empty lyrics, the error message will
name the song(s) involved. The fix is to open ProPresenter, make sure
each named song actually has lyrics (or remove the song), re-export both
`.db` files, and push again.

File names are case-sensitive on Cloudflare's (Linux) build server, even
though Windows and macOS don't care — always name them exactly `Songs.db`
and `SongWords.db`.

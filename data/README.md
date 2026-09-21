# data/

Drop the two ProPresenter SQLite exports here before building:

- `Songs.db` — the `song` table (`song_uid`, `title`, `author`)
- `SongWords.db` — the `word` table (`song_id` joins to `song.rowid`, `words` is RTF lyrics)

Commit both files to the repo. Every deploy runs `npm run import` against
whatever is currently in this folder, so replacing these two files and
pushing is the entire update workflow — see the design spec, section 06.

# How to update the songs on the website

No technical knowledge needed — just two files, a password, and a few clicks.

## What you'll need

- The two files from ProPresenter: **Songs.db** and **SongWords.db**
- The admin panel password (ask for it if you don't have it)

## Steps

1. **Export from ProPresenter** — export the updated `Songs.db` and
   `SongWords.db` files.

2. **Open the admin panel**: go to
   [song-search-site.uzosaugwu0.workers.dev/admin/](https://song-search-site.uzosaugwu0.workers.dev/admin/)
   and log in with the admin password.

3. **Upload both files** using the "Upload new database" form — choose
   `Songs.db` and `SongWords.db` in their matching fields, then click
   **Upload**.

That's it. The site updates itself immediately — no waiting, and nothing
else to do. The page will show you how many songs were imported.

## Checking for duplicate songs

After an update, you can visit `/duplicates/` on the website (for example,
`https://song-search-site.uzosaugwu0.workers.dev/duplicates/`) to see a list
of songs that might be the same song entered twice, so you know what to
clean up in ProPresenter next time. The admin panel also shows a duplicate
count right after you upload.

## If something looks wrong afterward

If the upload shows an error message, it'll tell you exactly which song
has a problem (most often: a song with no lyrics, or a missing title) —
fix that song in ProPresenter and re-export.

If you uploaded the wrong file, or something looks wrong on the live site
even though the upload succeeded, open the admin panel's "Backup history"
list and click **Restore** next to the last known-good upload — this
reverts the site to that database immediately.

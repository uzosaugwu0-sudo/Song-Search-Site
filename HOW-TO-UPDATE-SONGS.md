# How to update the songs on the website

No technical knowledge needed — just two files and a few clicks.

## What you'll need

- The two files from ProPresenter: **Songs.db** and **SongWords.db**
- To be signed in to GitHub (ask for an invite if you don't have access yet)

## Steps

1. **Export from ProPresenter** — export the updated `Songs.db` and `SongWords.db` files.

2. **Open the upload page**: [github.com/uzosaugwu0-sudo/Song-Search-Site/upload/master/data](https://github.com/uzosaugwu0-sudo/Song-Search-Site/upload/master/data)

3. **Drag both files** onto the page (or click "choose your files" and select them). You should see both `Songs.db` and `SongWords.db` listed.

4. Scroll down to **"Commit changes"**. Type a short message like `Update songs` in the box.

5. Click the green **"Commit changes"** button.

That's it. The website updates itself automatically within a minute or two — no need to do anything else.

## Checking for duplicate songs

After an update, you can visit `/duplicates/` on the website (for example,
`https://song-search-site.uzosaugwu0.workers.dev/duplicates/`) to see a list
of songs that might be the same song entered twice, so you know what to
clean up in ProPresenter next time.

## If something looks wrong afterward

If the site doesn't update, or a song is missing or looks broken, that usually means one song in the export has a problem (most often: a song with no lyrics). Whoever manages the site technically will get notified automatically and can tell you exactly which song to fix in ProPresenter.

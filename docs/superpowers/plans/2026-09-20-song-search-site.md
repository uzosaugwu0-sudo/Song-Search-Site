# Song Search Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static Astro site that lets anyone search a ProPresenter song export by title or lyrics, view a song's full lyrics, and share a direct link to it.

**Architecture:** A build-time Node script (`scripts/import-db.js`) reads two committed SQLite files (`data/Songs.db`, `data/SongWords.db`) via `node:sqlite`, converts each song's RTF lyrics to plain text, assigns a stable slug per song, and writes `src/data/songs.json`. Astro statically generates a home page (client-side search over the JSON) and one page per song from that JSON at build time. Output is plain static HTML/CSS/JS, deployed to Cloudflare Pages via `npm run import && npm run build`.

**Tech Stack:** Node.js (>=22.5, installed: v24.19.0), `node:sqlite` (built-in, no driver dependency), Astro (static output, no adapter), `node:test` + `node:assert/strict` (built-in test runner, no extra test dependency).

**Spec:** `docs/superpowers/specs/2026-09-20-song-search-site-design.md`

## Global Constraints

- Output must be plain static HTML/CSS/JS — no server, no database, no API in production (spec §03).
- Deploy target is Cloudflare Pages via GitHub auto-deploy; build command is `npm run import && npm run build` (spec §03, §06).
- Only `title`, `author`, `words` (RTF lyrics) are read from the source DBs; `words` must be converted to plain text preserving line breaks (spec §02, §04).
- Search is case-insensitive substring match against `title` **or** `lyrics`, entirely client-side, no server round-trip (spec §05).
- Slugs are lowercase-hyphenated titles; on collision, append the song's `song_uid` (spec §04).
- An unknown `/song/<slug>` URL must render a friendly "song not found" page, not a raw 404 (spec §05, §07).
- The import script must fail loudly (non-zero exit, clear message, names the affected song(s)) on a missing/unreadable `.db` file or on a song whose RTF converts to empty lyrics (spec §07).
- `data/Songs.db` and `data/SongWords.db` are committed to the repo, not gitignored (spec §06).

## Known gap going in

The real ProPresenter exports (`data/Songs.db`, `data/SongWords.db`) are **not present on this machine**. This plan builds the full pipeline against synthetic fixtures that match the documented schema (`song(rowid, song_uid, title, author)`, `word(song_id, words)`) and representative RTF. Task 9's manual verification uses a temporary synthetic database — real files must be dropped into `data/` (per spec §06's update workflow) before this is deployed for real, and the RTF converter should be spot-checked against a few actual songs at that point.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `.gitignore`
- Create: `data/README.md`
- Create: `README.md`

**Interfaces:**
- Produces: npm scripts `import`, `dev`, `build`, `preview`, `test` that later tasks rely on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "song-search-site",
  "type": "module",
  "version": "1.0.0",
  "private": true,
  "engines": {
    "node": ">=22.5.0"
  },
  "scripts": {
    "import": "node scripts/import-db.js",
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "node --test scripts/*.test.js"
  },
  "dependencies": {
    "astro": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
});
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.astro/
src/data/songs.json
```

- [ ] **Step 4: Write `data/README.md`**

```markdown
# data/

Drop the two ProPresenter SQLite exports here before building:

- `Songs.db` — the `song` table (`song_uid`, `title`, `author`)
- `SongWords.db` — the `word` table (`song_id` joins to `song.rowid`, `words` is RTF lyrics)

Commit both files to the repo. Every deploy runs `npm run import` against
whatever is currently in this folder, so replacing these two files and
pushing is the entire update workflow — see the design spec, section 06.
```

- [ ] **Step 5: Write `README.md`**

```markdown
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
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json astro.config.mjs .gitignore data/README.md README.md
git commit -m "Scaffold Astro project"
```

---

### Task 2: RTF-to-plain-text converter

**Files:**
- Create: `scripts/rtf-to-text.js`
- Test: `scripts/rtf-to-text.test.js`

**Interfaces:**
- Produces: `export function rtfToPlainText(rtf: string): string` — used by Task 4's import script.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/rtf-to-text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtfToPlainText } from './rtf-to-text.js';

const HYMN_RTF = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2639
{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\pard\sa0\qc\partightenfactor0
\f0\fs28 \cf0 Amazing grace, how sweet the sound\par
That saved a wretch like me\par
\par
I once was lost, but now am found\par
Was blind but now I see}`;

test('converts paragraphs to newlines and preserves blank lines between verses', () => {
  const result = rtfToPlainText(HYMN_RTF);
  assert.equal(
    result,
    'Amazing grace, how sweet the sound\n' +
      'That saved a wretch like me\n' +
      '\n' +
      'I once was lost, but now am found\n' +
      'Was blind but now I see'
  );
});

test('strips font table and color table content instead of rendering it', () => {
  const result = rtfToPlainText(HYMN_RTF);
  assert.ok(!result.includes('Helvetica'));
  assert.ok(!result.includes('fonttbl'));
});

test('decodes hex-escaped Windows-1252 bytes', () => {
  assert.equal(rtfToPlainText(String.raw`Caf\'e9`), 'Café');
});

test('decodes \\uN unicode escapes and swallows the ASCII fallback char', () => {
  assert.equal(rtfToPlainText(String.raw`Caf\u233?`), 'Café');
});

test('returns an empty string for empty or whitespace-only RTF', () => {
  assert.equal(rtfToPlainText(''), '');
  assert.equal(rtfToPlainText(String.raw`{\rtf1\ansi \par }`), '');
});

test('returns an empty string for non-string input', () => {
  assert.equal(rtfToPlainText(null), '');
  assert.equal(rtfToPlainText(undefined), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './rtf-to-text.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```js
// scripts/rtf-to-text.js
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'generator',
  'pict', 'object', 'themedata', 'colorschememapping',
  'latentstyles', 'rsidtbl', 'listtable', 'listoverridetable',
  'filetbl', 'xmlnstbl',
]);

const WIN1252_EXTRA = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„',
  0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ',
  0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
  0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
};

function decodeWin1252Byte(byte) {
  return WIN1252_EXTRA[byte] ?? String.fromCharCode(byte);
}

const TOKEN_RE =
  /\\'([0-9a-fA-F]{2})|\\u(-?\d+) ?|\\([a-zA-Z]+)(-?\d+)?[ ]?|\\([^a-zA-Z\r\n])|([{}])|[\r\n]+|([^\\{}\r\n]+)/g;

export function rtfToPlainText(rtf) {
  if (typeof rtf !== 'string' || rtf.length === 0) return '';

  let out = '';
  const skipStack = [false];
  let pendingUnicodeSkip = 0;
  const isSkipped = () => skipStack[skipStack.length - 1];

  const re = new RegExp(TOKEN_RE);
  let match;
  while ((match = re.exec(rtf)) !== null) {
    const [, hex, uni, word, , symbol, brace, text] = match;

    if (brace === '{') {
      skipStack.push(isSkipped());
      continue;
    }
    if (brace === '}') {
      if (skipStack.length > 1) skipStack.pop();
      continue;
    }

    if (symbol === '*') {
      skipStack[skipStack.length - 1] = true;
      continue;
    }

    if (word !== undefined) {
      if (SKIP_DESTINATIONS.has(word)) {
        skipStack[skipStack.length - 1] = true;
      }
      if (isSkipped()) continue;
      if (pendingUnicodeSkip > 0) pendingUnicodeSkip--;
      if (word === 'par' || word === 'line') out += '\n';
      else if (word === 'tab') out += '\t';
      continue;
    }

    if (isSkipped()) continue;

    if (hex !== undefined) {
      if (pendingUnicodeSkip > 0) { pendingUnicodeSkip--; continue; }
      out += decodeWin1252Byte(parseInt(hex, 16));
      continue;
    }

    if (uni !== undefined) {
      let code = parseInt(uni, 10);
      if (code < 0) code += 65536;
      out += String.fromCodePoint(code);
      pendingUnicodeSkip = 1;
      continue;
    }

    if (symbol !== undefined) {
      if (pendingUnicodeSkip > 0) { pendingUnicodeSkip--; continue; }
      if (symbol === '\\' || symbol === '{' || symbol === '}') out += symbol;
      else if (symbol === '~') out += ' ';
      continue;
    }

    if (text !== undefined) {
      if (pendingUnicodeSkip > 0) {
        let remaining = text;
        while (pendingUnicodeSkip > 0 && remaining.length > 0) {
          remaining = remaining.slice(1);
          pendingUnicodeSkip--;
        }
        out += remaining;
      } else {
        out += text;
      }
    }
  }

  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 assertions in `scripts/rtf-to-text.test.js` green.

- [ ] **Step 5: Commit**

```bash
git add scripts/rtf-to-text.js scripts/rtf-to-text.test.js
git commit -m "Add RTF-to-plain-text converter"
```

---

### Task 3: Slug generator

**Files:**
- Create: `scripts/slugify.js`
- Test: `scripts/slugify.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function slugify(title: string): string` and `export function assignSlugs(songs: {id: string, title: string}[]): (song & {slug: string})[]` — used by Task 4's import script.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/slugify.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, assignSlugs } from './slugify.js';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Amazing Grace'), 'amazing-grace');
});

test('slugify strips punctuation', () => {
  assert.equal(slugify('How Great Thou Art (Reprise)'), 'how-great-thou-art-reprise');
});

test('slugify collapses repeated separators and trims leading/trailing hyphens', () => {
  assert.equal(slugify('  Holy, Holy, Holy!!  '), 'holy-holy-holy');
});

test('assignSlugs keeps the base slug when there is no title collision', () => {
  const songs = [{ id: 'uid-1', title: 'Amazing Grace' }];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'amazing-grace');
});

test('assignSlugs appends song_uid to disambiguate colliding titles', () => {
  const songs = [
    { id: 'uid-1', title: 'Alleluia' },
    { id: 'uid-2', title: 'Alleluia' },
  ];
  const result = assignSlugs(songs);
  assert.equal(result[0].slug, 'alleluia-uid-1');
  assert.equal(result[1].slug, 'alleluia-uid-2');
});

test('assignSlugs preserves all other song fields', () => {
  const songs = [{ id: 'uid-1', title: 'Amazing Grace', author: 'John Newton', lyrics: '...' }];
  const result = assignSlugs(songs);
  assert.equal(result[0].author, 'John Newton');
  assert.equal(result[0].lyrics, '...');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './slugify.js'`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/slugify.js
export function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function assignSlugs(songs) {
  const baseCounts = new Map();
  for (const song of songs) {
    const base = slugify(song.title);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  return songs.map((song) => {
    const base = slugify(song.title);
    const slug = baseCounts.get(base) > 1 ? `${base}-${song.id}` : base;
    return { ...song, slug };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 assertions in `scripts/slugify.test.js` green, plus the 7 from Task 2 still green.

- [ ] **Step 5: Commit**

```bash
git add scripts/slugify.js scripts/slugify.test.js
git commit -m "Add slug generator with collision disambiguation"
```

---

### Task 4: Import script

**Files:**
- Create: `scripts/import-db.js`
- Test: `scripts/import-db.test.js`

**Interfaces:**
- Consumes: `rtfToPlainText` from `scripts/rtf-to-text.js` (Task 2); `assignSlugs` from `scripts/slugify.js` (Task 3).
- Produces: `export function runImport({ songsDbPath, wordsDbPath, outPath }): void`, writing an array of `{ id, slug, title, author, lyrics }` to `outPath`. Song pages (Task 6) and the home page (Task 5) read this shape from `src/data/songs.json`.

- [ ] **Step 1: Write the failing test**

This builds two temporary SQLite files matching the real schema, runs the
importer against them, and checks the emitted JSON — standing in for the
real `data/Songs.db` / `data/SongWords.db` until those are available (see
"Known gap" above).

```js
// scripts/import-db.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImport } from './import-db.js';

function buildFixtureDbs(dir) {
  const songsPath = join(dir, 'Songs.db');
  const wordsPath = join(dir, 'SongWords.db');

  const songsDb = new DatabaseSync(songsPath);
  songsDb.exec('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
  songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-1', 'Amazing Grace', 'John Newton');
  songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-2', 'Silent Night', 'Joseph Mohr');
  songsDb.close();

  const wordsDb = new DatabaseSync(wordsPath);
  wordsDb.exec('CREATE TABLE word (song_id INTEGER, words TEXT)');
  wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(1, String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound}`);
  wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(2, String.raw`{\rtf1\ansi Silent night\par holy night}`);
  wordsDb.close();

  return { songsPath, wordsPath };
}

test('runImport joins the two DBs and writes slugged songs to outPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'song-import-test-'));
  const { songsPath, wordsPath } = buildFixtureDbs(dir);
  const outPath = join(dir, 'songs.json');

  runImport({ songsDbPath: songsPath, wordsDbPath: wordsPath, outPath });

  const songs = JSON.parse(readFileSync(outPath, 'utf8'));
  rmSync(dir, { recursive: true, force: true });

  assert.equal(songs.length, 2);
  const grace = songs.find((s) => s.id === 'uid-1');
  assert.equal(grace.title, 'Amazing Grace');
  assert.equal(grace.author, 'John Newton');
  assert.equal(grace.lyrics, 'Amazing grace\nhow sweet the sound');
  assert.equal(grace.slug, 'amazing-grace');
});

test('runImport exits with a clear error when a song has empty lyrics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'song-import-test-'));
  const songsPath = join(dir, 'Songs.db');
  const wordsPath = join(dir, 'SongWords.db');

  const songsDb = new DatabaseSync(songsPath);
  songsDb.exec('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
  songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-1', 'Blank Song', 'Nobody');
  songsDb.close();

  const wordsDb = new DatabaseSync(wordsPath);
  wordsDb.exec('CREATE TABLE word (song_id INTEGER, words TEXT)');
  wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(1, String.raw`{\rtf1\ansi }`);
  wordsDb.close();

  const outPath = join(dir, 'songs.json');

  assert.throws(() => {
    runImport({ songsDbPath: songsPath, wordsDbPath: wordsPath, outPath });
  }, /Blank Song/);

  rmSync(dir, { recursive: true, force: true });
});

test('runImport throws a clear error when a DB file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'song-import-test-'));
  assert.throws(() => {
    runImport({
      songsDbPath: join(dir, 'missing-Songs.db'),
      wordsDbPath: join(dir, 'missing-SongWords.db'),
      outPath: join(dir, 'songs.json'),
    });
  }, /Songs\.db/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './import-db.js'`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/import-db.js
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rtfToPlainText } from './rtf-to-text.js';
import { assignSlugs } from './slugify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DEFAULT_SONGS_DB_PATH = join(ROOT, 'data', 'Songs.db');
const DEFAULT_WORDS_DB_PATH = join(ROOT, 'data', 'SongWords.db');
const DEFAULT_OUT_PATH = join(ROOT, 'src', 'data', 'songs.json');

function openDb(path, label) {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (err) {
    throw new Error(`Could not open ${label} at ${path}: ${err.message}`);
  }
}

export function runImport({
  songsDbPath = DEFAULT_SONGS_DB_PATH,
  wordsDbPath = DEFAULT_WORDS_DB_PATH,
  outPath = DEFAULT_OUT_PATH,
} = {}) {
  const songsDb = openDb(songsDbPath, 'Songs.db');
  const wordsDb = openDb(wordsDbPath, 'SongWords.db');

  const songRows = songsDb.prepare('SELECT rowid AS rowid, song_uid, title, author FROM song').all();
  const wordRows = wordsDb.prepare('SELECT song_id, words FROM word').all();
  songsDb.close();
  wordsDb.close();

  const wordsByRowId = new Map(wordRows.map((w) => [w.song_id, w.words]));

  const failures = [];
  const songs = songRows.map((row) => {
    const rtf = wordsByRowId.get(row.rowid);
    const lyrics = rtf ? rtfToPlainText(rtf) : '';
    if (!lyrics.trim()) {
      failures.push(`${row.title} (song_uid ${row.song_uid})`);
    }
    return {
      id: row.song_uid,
      title: row.title,
      author: row.author ?? '',
      lyrics,
    };
  });

  if (failures.length > 0) {
    throw new Error(
      `Import failed: ${failures.length} song(s) produced empty lyrics:\n` +
        failures.map((f) => `  - ${f}`).join('\n')
    );
  }

  const withSlugs = assignSlugs(songs);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(withSlugs, null, 2));
  console.log(`Imported ${withSlugs.length} songs -> ${outPath}`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  try {
    runImport();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 3 assertions in `scripts/import-db.test.js` green, plus all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-db.js scripts/import-db.test.js
git commit -m "Add import script joining Songs.db and SongWords.db into songs.json"
```

---

### Task 5: Home page with client-side search

**Files:**
- Create: `src/pages/index.astro`

**Interfaces:**
- Consumes: `src/data/songs.json` (array of `{ id, slug, title, author, lyrics }`, produced by Task 4).

- [ ] **Step 1: Write `src/pages/index.astro`**

```astro
---
import songs from '../data/songs.json';

const songsJson = JSON.stringify(songs).replace(/</g, '\\u003c');
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Song Search</title>
</head>
<body>
  <h1>Song Search</h1>
  <input type="search" id="search" placeholder="Search by title or lyrics..." autofocus />
  <ul id="results"></ul>

  <script type="application/json" id="songs-data" set:html={songsJson} />
  <script>
    const data = JSON.parse(document.getElementById('songs-data').textContent);
    const input = document.getElementById('search');
    const results = document.getElementById('results');

    function render(query) {
      results.innerHTML = '';
      if (!query) return;
      const q = query.toLowerCase();
      const matches = data.filter(
        (song) => song.title.toLowerCase().includes(q) || song.lyrics.toLowerCase().includes(q)
      );
      for (const song of matches) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `/song/${song.slug}/`;
        a.textContent = song.author ? `${song.title} — ${song.author}` : song.title;
        li.appendChild(a);
        results.appendChild(li);
      }
    }

    input.addEventListener('input', (e) => render(e.target.value));
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/index.astro
git commit -m "Add home page with client-side search"
```

(Manual verification of this page happens in Task 9, once the site can actually build with data present.)

---

### Task 6: Song page

**Files:**
- Create: `src/pages/song/[slug].astro`

**Interfaces:**
- Consumes: `src/data/songs.json` (Task 4's output shape).

- [ ] **Step 1: Write `src/pages/song/[slug].astro`**

```astro
---
import songs from '../../data/songs.json';

export function getStaticPaths() {
  return songs.map((song) => ({
    params: { slug: song.slug },
    props: { song },
  }));
}

const { song } = Astro.props;
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{song.title} — Song Search</title>
</head>
<body>
  <p><a href="/">← Back to search</a></p>
  <h1>{song.title}</h1>
  {song.author && <p><em>{song.author}</em></p>}
  <pre>{song.lyrics}</pre>
  <button id="copy-link">Copy link</button>

  <script>
    document.getElementById('copy-link').addEventListener('click', async () => {
      await navigator.clipboard.writeText(window.location.href);
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add "src/pages/song/[slug].astro"
git commit -m "Add per-song page with copy-link button"
```

---

### Task 7: Song-not-found page

**Files:**
- Create: `src/pages/404.astro`

- [ ] **Step 1: Write `src/pages/404.astro`**

```astro
---
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Song not found</title>
</head>
<body>
  <h1>Song not found</h1>
  <p>We couldn't find that song.</p>
  <p><a href="/">← Back to search</a></p>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/404.astro
git commit -m "Add friendly song-not-found page"
```

---

### Task 8: Cloudflare Pages build wiring

**Files:**
- Modify: `README.md` (Cloudflare Pages settings section)

**Interfaces:** none (documentation-only task; the build command it documents, `npm run import && npm run build`, is already wired via Task 1's `package.json` scripts).

- [ ] **Step 1: Append Cloudflare Pages settings to `README.md`**

```markdown

## Cloudflare Pages settings

- Build command: `npm run import && npm run build`
- Build output directory: `dist`
- Connect the GitHub repo for auto-deploy on push to the default branch.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document Cloudflare Pages build settings"
```

---

### Task 9: End-to-end manual verification

No `data/Songs.db` / `data/SongWords.db` exist on this machine yet (see
"Known gap" above), so this task builds against a temporary synthetic pair
placed in the OS temp directory — never inside `data/` — purely to prove
the pipeline works end to end. **Once real ProPresenter exports are added
to `data/`, re-run this same verification against them before relying on
the site**, per spec §08's manual-verification requirement.

**Files:** none created; this is a verification pass.

- [ ] **Step 1: Write a temporary fixture-and-import script**

The codebase is ESM (`package.json` sets `"type": "module"`), so this uses
`import`, not `require`. `runImport`'s `outPath` is left at its default
(`src/data/songs.json`) so Astro can build against it in Step 2.

```js
// scripts/_verify-fixture.mjs — temporary, deleted in Step 4
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImport } from './import-db.js';

const dir = mkdtempSync(join(tmpdir(), 'song-verify-'));
const songsPath = join(dir, 'Songs.db');
const wordsPath = join(dir, 'SongWords.db');

const songsDb = new DatabaseSync(songsPath);
songsDb.exec('CREATE TABLE song (song_uid TEXT, title TEXT, author TEXT)');
songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-1', 'Amazing Grace', 'John Newton');
songsDb.prepare('INSERT INTO song (song_uid, title, author) VALUES (?, ?, ?)').run('uid-2', 'Silent Night', 'Joseph Mohr');
songsDb.close();

const wordsDb = new DatabaseSync(wordsPath);
wordsDb.exec('CREATE TABLE word (song_id INTEGER, words TEXT)');
wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(
  1,
  String.raw`{\rtf1\ansi Amazing grace\par how sweet the sound\par \par That saved a wretch like me}`
);
wordsDb.prepare('INSERT INTO word (song_id, words) VALUES (?, ?)').run(
  2,
  String.raw`{\rtf1\ansi Silent night\par holy night}`
);
wordsDb.close();

runImport({ songsDbPath: songsPath, wordsDbPath: wordsPath });
console.log(`Fixture built and imported from ${dir}`);
```

- [ ] **Step 2: Run the fixture script, then build**

```bash
node scripts/_verify-fixture.mjs
npm run build
```

Expected: `Fixture built and imported from ...` then `Imported 2 songs ->
.../src/data/songs.json`, then an Astro build that reports 3 pages
generated (`/`, `/song/amazing-grace/`, `/song/silent-night/`) into `dist/`.

- [ ] **Step 3: Spot-check the built output**

- Open `dist/index.html`, confirm the search input and (initially empty) results list are present.
- Confirm `dist/song/amazing-grace/index.html` exists and contains "Amazing grace" and "John Newton".
- Confirm `dist/song/silent-night/index.html` exists and contains "Silent night".
- Run `npm run preview`, visit the local URL it prints, type "grace" into the search box, and confirm "Amazing Grace" appears in the results while "Silent Night" does not. Type "nonexistent" and confirm no results appear. Visit `/song/does-not-exist/` and confirm the friendly not-found page renders.

- [ ] **Step 4: Clean up the fixture and generated data**

```bash
rm -rf scripts/_verify-fixture.mjs src/data/songs.json dist
```

(The fixture DB files themselves live under the OS temp directory, not
the repo, and don't need manual cleanup.)

`src/data/songs.json` is gitignored (Task 1) precisely so this synthetic
run never gets committed — it must be regenerated from real `data/*.db`
files before the site is actually deployed.

- [ ] **Step 5: Record the outcome**

No commit for this task (nothing new to add — the fixture and build output
were just deleted in Step 4). If any spot-check in Step 3 failed, fix the
relevant task's code and re-run this task before moving on.

# Site-Wide UI Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every page of the song-search site with a modern look built on the church logo's purple and gold, make spacing/shape/controls consistent through shared design tokens, and add a light/dark mode toggle.

**Architecture:** All design values become CSS custom properties in `src/layouts/Layout.astro` (existing variable names kept, new ones added, dark palette available both via `prefers-color-scheme` and an explicit `data-theme` attribute). Each page's existing `<style>` block is then rewritten to reference tokens instead of literal numbers. Markup, class names, scripts and behavior are untouched except one new header toggle button. An automated test enforces WCAG contrast on the tokens.

**Tech Stack:** Astro 5 (`output: 'server'`, `@astrojs/cloudflare`), plain CSS custom properties, `node --test`, a temporary Playwright install for verification only.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-restyle-design.md`

## Global Constraints

- **Restyle only.** No change to markup, element order, class names, copy, features, route handlers or behavior scripts. The single exception is the new theme toggle button (and its inline script) in `Layout.astro`'s header.
- **Do not touch** the `<script define:vars={{ songId: song.id }}>` block in `src/pages/song/[slug].astro` (it cannot contain imports) or any `<script>` block.
- Font stays **Sora**; logo file unchanged; automatic light/dark following the system setting remains the default.
- **Light tokens:** `--color-background #f6f7fb`, `--color-foreground #171a2b`, `--color-card #ffffff`, `--color-card-foreground #171a2b`, `--color-muted #eceef7`, `--color-muted-foreground #646a82`, `--color-border #e4e6f0`, `--color-border-strong #848aa3`, `--color-primary #4a3b9c`, `--color-on-primary #ffffff`, `--color-accent #c8a24a`, `--color-on-accent #3a2f12`, `--color-danger #b3261e`, `--color-danger-border #f0c9c6`.
- **Dark tokens:** `--color-background #12111c`, `--color-foreground #ecebf7`, `--color-card #1c1b2b`, `--color-card-foreground #ecebf7`, `--color-muted #25243a`, `--color-muted-foreground #a09fba`, `--color-border #302f45`, `--color-border-strong #6b6a8a`, `--color-primary #9a8cf0`, `--color-on-primary #14121f`, `--color-accent #d9b45c`, `--color-on-accent #2a2008`, `--color-danger #f2766d`, `--color-danger-border #5a3030`.
- **Shape/size tokens (both modes):** `--radius-sm 8px`, `--radius-control 12px`, `--radius-card 16px`, `--radius-pill 999px`; `--space-1…6` = 4, 8, 12, 16, 24, 32px; `--control-height 44px` (action buttons, text inputs); `--control-height-compact 32px` (round `+`, ↑ ↓, Remove, tabs); `--focus-ring: 2px solid var(--color-primary)` with `outline-offset: 2px`.
- **Shadows:** light `--shadow-card: 0 1px 3px rgba(23, 26, 43, 0.06), 0 8px 24px rgba(23, 26, 43, 0.06)`, `--shadow-raised: 0 2px 4px rgba(23, 26, 43, 0.08), 0 12px 28px rgba(23, 26, 43, 0.1)`; dark `--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.3)`, `--shadow-raised: 0 2px 4px rgba(0, 0, 0, 0.35), 0 12px 28px rgba(0, 0, 0, 0.4)`.
- **Gold rule:** gold only for fills, decorative borders, the active-tab underline and the favorite star; never as text on a light background. Text on a gold fill uses `--color-on-accent`. The focus ring is purple, not gold.
- **Theme toggle:** localStorage key `songSearchTheme` with value `"light"` or `"dark"`; absent means follow the system. Every localStorage access is wrapped in try/catch. The `<head>` script is `is:inline` and runs before first paint. The button's accessible name is "Switch to dark mode" (when light) / "Switch to light mode" (when dark).
- Text inputs use `--color-border-strong` for their outline; cards, rows and dividers use the subtle `--color-border`.
- No Co-Authored-By trailers on commits. `npm test` and `npm run build` must be green after every task. Do not push or deploy; that happens only after the owner approves the Task 7 results.

---

### Task 1: Layout tokens, base rules, header and theme toggle (with contrast test)

**Files:**
- Create: `scripts/theme-contrast.test.js`
- Modify (full rewrite): `src/layouts/Layout.astro`

**Interfaces:**
- Produces: every CSS custom property listed in Global Constraints (consumed by Tasks 2–6), the `.theme-toggle` / `.admin-link` header controls, and the `songSearchTheme` localStorage contract.

- [ ] **Step 1: Write the failing contrast test**

Create `scripts/theme-contrast.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const layout = readFileSync(
  fileURLToPath(new URL('../src/layouts/Layout.astro', import.meta.url)),
  'utf8',
);

function declarations(css) {
  const out = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function block(pattern, label) {
  const match = layout.match(pattern);
  assert.ok(match, `Layout.astro is missing the ${label} token block`);
  return declarations(match[1]);
}

const light = block(/:root \{([^}]*)\}/, 'light (:root)');
const dark = block(/:root\[data-theme="dark"\] \{([^}]*)\}/, 'dark (data-theme)');
const darkMedia = block(
  /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/,
  'dark (prefers-color-scheme)',
);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS = [
  ['foreground on background', '--color-foreground', '--color-background', 4.5],
  ['card text on card', '--color-card-foreground', '--color-card', 4.5],
  ['muted text on background', '--color-muted-foreground', '--color-background', 4.5],
  ['muted text on card', '--color-muted-foreground', '--color-card', 4.5],
  ['muted text on muted', '--color-muted-foreground', '--color-muted', 4.5],
  ['on-primary on primary', '--color-on-primary', '--color-primary', 4.5],
  ['primary text on background', '--color-primary', '--color-background', 4.5],
  ['primary text on card', '--color-primary', '--color-card', 4.5],
  ['on-accent on accent', '--color-on-accent', '--color-accent', 4.5],
  ['danger text on card', '--color-danger', '--color-card', 4.5],
  ['danger text on background', '--color-danger', '--color-background', 4.5],
  ['input outline on background', '--color-border-strong', '--color-background', 3],
  ['input outline on card', '--color-border-strong', '--color-card', 3],
  ['focus ring on background', '--color-primary', '--color-background', 3],
  ['focus ring on card', '--color-primary', '--color-card', 3],
];

function failures(tokens) {
  return PAIRS.flatMap(([name, fg, bg, min]) => {
    const value = ratio(tokens[fg], tokens[bg]);
    return value >= min ? [] : [`${name}: ${value.toFixed(2)} is below ${min}`];
  });
}

test('light palette meets WCAG contrast minimums', () => {
  assert.deepEqual(failures(light), []);
});

test('dark palette meets WCAG contrast minimums', () => {
  assert.deepEqual(failures(dark), []);
});

test('the prefers-color-scheme dark block matches the data-theme dark block', () => {
  assert.deepEqual(darkMedia, dark);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/theme-contrast.test.js`
Expected: FAIL. The current `Layout.astro` has no `:root[data-theme="dark"]` block, so the module throws "Layout.astro is missing the dark (data-theme) token block".

- [ ] **Step 3: Rewrite `src/layouts/Layout.astro`**

Replace the entire file with:

```astro
---
interface Props {
  title: string;
  description?: string;
}
const { title, description = 'Search a song database by title or lyrics.' } = Astro.props;
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content={description} />
  <title>{title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <script is:inline>
    try {
      var savedTheme = localStorage.getItem('songSearchTheme');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', savedTheme);
      }
    } catch (e) {}
  </script>
  <style is:global>
    :root {
      --color-background: #f6f7fb;
      --color-foreground: #171a2b;
      --color-card: #ffffff;
      --color-card-foreground: #171a2b;
      --color-muted: #eceef7;
      --color-muted-foreground: #646a82;
      --color-border: #e4e6f0;
      --color-border-strong: #848aa3;
      --color-primary: #4a3b9c;
      --color-on-primary: #ffffff;
      --color-accent: #c8a24a;
      --color-on-accent: #3a2f12;
      --color-danger: #b3261e;
      --color-danger-border: #f0c9c6;
      --shadow-card: 0 1px 3px rgba(23, 26, 43, 0.06), 0 8px 24px rgba(23, 26, 43, 0.06);
      --shadow-raised: 0 2px 4px rgba(23, 26, 43, 0.08), 0 12px 28px rgba(23, 26, 43, 0.1);
      --radius-sm: 8px;
      --radius-control: 12px;
      --radius-card: 16px;
      --radius-pill: 999px;
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 24px;
      --space-6: 32px;
      --control-height: 44px;
      --control-height-compact: 32px;
      --focus-ring: 2px solid var(--color-primary);
      color-scheme: light dark;
    }
    :root[data-theme="light"] {
      color-scheme: light;
    }
    :root[data-theme="dark"] {
      --color-background: #12111c;
      --color-foreground: #ecebf7;
      --color-card: #1c1b2b;
      --color-card-foreground: #ecebf7;
      --color-muted: #25243a;
      --color-muted-foreground: #a09fba;
      --color-border: #302f45;
      --color-border-strong: #6b6a8a;
      --color-primary: #9a8cf0;
      --color-on-primary: #14121f;
      --color-accent: #d9b45c;
      --color-on-accent: #2a2008;
      --color-danger: #f2766d;
      --color-danger-border: #5a3030;
      --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.3);
      --shadow-raised: 0 2px 4px rgba(0, 0, 0, 0.35), 0 12px 28px rgba(0, 0, 0, 0.4);
      color-scheme: dark;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --color-background: #12111c;
        --color-foreground: #ecebf7;
        --color-card: #1c1b2b;
        --color-card-foreground: #ecebf7;
        --color-muted: #25243a;
        --color-muted-foreground: #a09fba;
        --color-border: #302f45;
        --color-border-strong: #6b6a8a;
        --color-primary: #9a8cf0;
        --color-on-primary: #14121f;
        --color-accent: #d9b45c;
        --color-on-accent: #2a2008;
        --color-danger: #f2766d;
        --color-danger-border: #5a3030;
        --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.3);
        --shadow-raised: 0 2px 4px rgba(0, 0, 0, 0.35), 0 12px 28px rgba(0, 0, 0, 0.4);
      }
    }
    :where(button, input, select, textarea) { font-family: inherit; }
    :where(button:not(:disabled)) { cursor: pointer; }
    :where(a, button, input, select, textarea):focus-visible {
      outline: var(--focus-ring);
      outline-offset: 2px;
    }
    .theme-toggle .icon-sun { display: none; }
    :root[data-theme="dark"] .theme-toggle .icon-moon { display: none; }
    :root[data-theme="dark"] .theme-toggle .icon-sun { display: block; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .theme-toggle .icon-moon { display: none; }
      :root:not([data-theme="light"]) .theme-toggle .icon-sun { display: block; }
    }
  </style>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--color-background);
      color: var(--color-foreground);
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      line-height: 1.6;
    }
    h1 {
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-weight: 800;
      margin: 0 0 var(--space-2);
    }
    a { color: var(--color-primary); }
    .container {
      max-width: 1040px;
      margin: 0 auto;
      padding: var(--space-6) var(--space-5) 64px;
    }
    .site-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      margin-bottom: var(--space-5);
    }
    .logo-link { display: block; line-height: 0; }
    .site-logo {
      display: block;
      height: 56px;
      width: auto;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .admin-link, .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: var(--control-height);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-muted-foreground);
      font-size: 0.9rem;
      text-decoration: none;
    }
    .admin-link { padding: 0 var(--space-4); }
    .theme-toggle {
      width: var(--control-height);
      padding: 0;
      border-radius: var(--radius-pill);
    }
    .admin-link:hover, .theme-toggle:hover {
      color: var(--color-foreground);
      border-color: var(--color-border-strong);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="site-header">
      <a href="/" class="logo-link"><img src="/logo.png" alt="Wisdom Assembly Family Church — home" class="site-logo" /></a>
      <div class="header-actions">
        <a href="/admin/login" class="admin-link">Admin</a>
        <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Switch to dark mode">
          <svg class="icon-moon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          <svg class="icon-sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        </button>
      </div>
    </div>
    <slot />
  </div>
  <script is:inline>
    (function () {
      var root = document.documentElement;
      var button = document.getElementById('theme-toggle');
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      function current() {
        return root.getAttribute('data-theme') || (media.matches ? 'dark' : 'light');
      }
      function sync() {
        button.setAttribute('aria-label', current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      }
      button.addEventListener('click', function () {
        var next = current() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('songSearchTheme', next); } catch (e) {}
        sync();
      });
      media.addEventListener('change', sync);
      sync();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 4: Run the contrast test to verify it passes**

Run: `node --test scripts/theme-contrast.test.js`
Expected: PASS, 3 tests. If a ratio fails, nudge only that token (in all dark places at once, so the media and `data-theme` blocks stay identical) until it passes, and note the change in the report.

- [ ] **Step 5: Run the full suite and the build**

Run: `npm test`
Expected: PASS, 86 tests (83 existing + 3 new).

Run: `npm run build`
Expected: `Complete!` with no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/theme-contrast.test.js src/layouts/Layout.astro
git commit -m "feat: add design tokens, light/dark toggle and header controls with contrast test"
```

---

### Task 2: Home page (`src/pages/index.astro`)

**Files:**
- Modify: `src/pages/index.astro` (only the single `<style is:global>…</style>` block, currently lines 26–236)

**Interfaces:**
- Consumes: the tokens from Task 1.
- Produces: nothing other tasks depend on.

No automated test applies to CSS; this task is verified by the build, the grep in Step 4, and Task 7's screenshots.

- [ ] **Step 1: Write the new style block to a scratch file**

Create `.superpowers/scratch/index-style.txt` (create the directory if needed; it is not tracked) with exactly:

```css
<style is:global>
    #search {
      width: 100%;
      min-height: var(--control-height);
      padding: var(--space-4) var(--space-5);
      font-size: 1.05rem;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      box-shadow: var(--shadow-card);
    }
    .hint {
      color: var(--color-muted-foreground);
      font-size: 0.9rem;
      margin: var(--space-2) 0 0;
    }
    #status {
      color: var(--color-muted-foreground);
      margin-top: var(--space-4);
    }
    #tabs {
      display: flex;
      gap: var(--space-1);
      width: fit-content;
      max-width: 100%;
      margin-top: var(--space-5);
      padding: var(--space-1);
      background: var(--color-muted);
      border-radius: var(--radius-control);
      overflow-x: auto;
    }
    .tab {
      appearance: none;
      background: none;
      border: none;
      border-radius: var(--radius-sm);
      min-height: var(--control-height-compact);
      padding: 0 var(--space-4);
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 0.95rem;
      white-space: nowrap;
      color: var(--color-muted-foreground);
    }
    .tab:hover {
      color: var(--color-foreground);
    }
    .tab.active {
      background: var(--color-card);
      color: var(--color-foreground);
      font-weight: 600;
      box-shadow: inset 0 -2px 0 var(--color-accent);
    }
    #results {
      list-style: none;
      margin: var(--space-5) 0 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--space-4);
    }
    .result-item {
      position: relative;
    }
    .add-to-set-btn {
      position: absolute;
      top: var(--space-3);
      right: var(--space-3);
      width: var(--control-height-compact);
      height: var(--control-height-compact);
      border-radius: var(--radius-pill);
      border: 1px solid var(--color-border);
      background: var(--color-card);
      color: var(--color-primary);
      font-size: 1.1rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .add-to-set-btn:hover {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
    .set-controls {
      display: flex;
      gap: var(--space-3);
      align-items: center;
      grid-column: 1 / -1;
    }
    .set-controls button, .set-controls a {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-height);
      padding: 0 var(--space-4);
      border-radius: var(--radius-control);
      border: 1px solid var(--color-border);
      background: var(--color-card);
      color: var(--color-card-foreground);
      text-decoration: none;
      font-size: 0.9rem;
    }
    .set-controls button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .playlist-section-label {
      grid-column: 1 / -1;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-weight: 700;
      font-size: 0.95rem;
      margin: var(--space-2) 0 calc(-1 * var(--space-1));
      color: var(--color-muted-foreground);
    }
    .playlist-name-input {
      flex: 1;
      min-width: 200px;
      min-height: var(--control-height);
      padding: 0 var(--space-4);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      font-size: 0.9rem;
    }
    .set-song-row {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
    }
    .set-song-row a {
      font-weight: 600;
      text-decoration: none;
      color: var(--color-card-foreground);
    }
    .set-song-row a:hover {
      text-decoration: underline;
    }
    .row-controls {
      margin-left: auto;
      display: flex;
      gap: var(--space-2);
    }
    .row-controls button {
      min-width: var(--control-height-compact);
      min-height: var(--control-height-compact);
      border: 1px solid var(--color-border);
      background: var(--color-card);
      color: var(--color-card-foreground);
      border-radius: var(--radius-sm);
      padding: 0 var(--space-3);
    }
    .row-controls button:last-child {
      color: var(--color-danger);
      border-color: var(--color-danger-border);
    }
    .row-controls button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .result-card {
      display: block;
      padding: var(--space-5) calc(var(--control-height-compact) + var(--space-5)) var(--space-5) var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-card);
      background: var(--color-card);
      color: var(--color-card-foreground);
      text-decoration: none;
      box-shadow: var(--shadow-card);
      transition: transform 150ms ease, box-shadow 150ms ease;
    }
    .result-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-raised);
    }
    .result-card.selected {
      outline: var(--focus-ring);
      outline-offset: 2px;
    }
    .result-title {
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .result-author { color: var(--color-muted-foreground); font-size: 0.9rem; }
    .result-snippet {
      margin-top: var(--space-2);
      font-size: 0.9rem;
      color: var(--color-muted-foreground);
    }
    .result-snippet mark {
      background: var(--color-primary);
      color: var(--color-on-primary);
      font-weight: 600;
      padding: 1px var(--space-1);
      border-radius: var(--space-1);
    }
    #pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: var(--space-6);
      gap: var(--space-4);
    }
    #pagination a {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-height);
      padding: 0 var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      text-decoration: none;
      background: var(--color-card);
      color: var(--color-primary);
    }
    #pagination .page-count {
      color: var(--color-muted-foreground);
      font-size: 0.9rem;
    }
  </style>
```

- [ ] **Step 2: Swap the block into the page**

Run:

```bash
node -e "const fs=require('fs');const [file,blockFile]=process.argv.slice(1);const src=fs.readFileSync(file,'utf8');const start=src.indexOf('<style');const end=src.indexOf('</style>',start)+'</style>'.length;if(start<0||end<start)throw new Error('style block not found');fs.writeFileSync(file,src.slice(0,start)+fs.readFileSync(blockFile,'utf8').trimEnd()+src.slice(end));" src/pages/index.astro .superpowers/scratch/index-style.txt
```

Expected: no output. Then `git diff --stat src/pages/index.astro` shows only that file changed, with changes confined to the old style block's line range (the markup above it and the `<script>` below it are untouched).

- [ ] **Step 3: Build and test**

Run: `npm run build`
Expected: `Complete!`.

Run: `npm test`
Expected: PASS, 86 tests.

- [ ] **Step 4: Check no literal colors, radii or shadows remain in the block**

Run: `sed -n '/<style/,/<\/style>/p' src/pages/index.astro | grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius: [0-9]+px"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
rm -f .superpowers/scratch/index-style.txt
git add src/pages/index.astro
git commit -m "style: restyle the home page with design tokens"
```

---

### Task 3: Song page (`src/pages/song/[slug].astro`)

**Files:**
- Modify: `src/pages/song/[slug].astro` (only the single `<style>…</style>` block, currently lines 55–129)

**Interfaces:**
- Consumes: the tokens from Task 1.

- [ ] **Step 1: Write the new style block to a scratch file**

Create `.superpowers/scratch/song-style.txt` with exactly:

```css
<style>
    .page {
      max-width: 680px;
      margin: 0 auto;
    }
    .author {
      color: var(--color-muted-foreground);
      font-style: italic;
      margin: 0 0 var(--space-5);
    }
    .lyrics {
      margin-bottom: var(--space-5);
      padding: var(--space-5) var(--space-6);
      background: var(--color-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-card);
    }
    .stanza { margin-bottom: var(--space-5); }
    .stanza:last-child { margin-bottom: 0; }
    .stanza p { margin: 0 0 2px; }
    .label {
      font-weight: 700;
      font-size: 0.8rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-primary);
      margin-bottom: var(--space-2) !important;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    #copy-link, #favorite-toggle, #add-to-set {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--control-height);
      padding: 0 var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      font-size: 0.95rem;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease;
    }
    #copy-link {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
      font-weight: 600;
    }
    #copy-link:hover { opacity: 0.85; }
    #favorite-toggle[aria-pressed="true"] {
      background: var(--color-accent);
      color: var(--color-on-accent);
      border-color: var(--color-accent);
    }
    #add-to-set:hover {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
  </style>
```

- [ ] **Step 2: Swap the block into the page**

Run:

```bash
node -e "const fs=require('fs');const [file,blockFile]=process.argv.slice(1);const src=fs.readFileSync(file,'utf8');const start=src.indexOf('<style');const end=src.indexOf('</style>',start)+'</style>'.length;if(start<0||end<start)throw new Error('style block not found');fs.writeFileSync(file,src.slice(0,start)+fs.readFileSync(blockFile,'utf8').trimEnd()+src.slice(end));" "src/pages/song/[slug].astro" .superpowers/scratch/song-style.txt
```

Expected: no output. Confirm with `git diff "src/pages/song/[slug].astro"` that the `<script define:vars=…>` block and the markup are unchanged.

- [ ] **Step 3: Build and test**

Run: `npm run build` — Expected: `Complete!`.
Run: `npm test` — Expected: PASS, 86 tests.

- [ ] **Step 4: Commit**

```bash
rm -f .superpowers/scratch/song-style.txt
git add "src/pages/song/[slug].astro"
git commit -m "style: restyle the song page with design tokens"
```

---

### Task 4: Playlist page (`src/pages/set/[id].astro`)

**Files:**
- Modify: `src/pages/set/[id].astro` (only the single `<style>…</style>` block, currently lines 57–153)

**Interfaces:**
- Consumes: the tokens from Task 1.

- [ ] **Step 1: Write the new style block to a scratch file**

Create `.superpowers/scratch/set-style.txt` with exactly:

```css
<style>
    .page {
      max-width: 680px;
      margin: 0 auto;
    }
    .status {
      color: var(--color-muted-foreground);
      margin: var(--space-4) 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .actions button {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-height);
      padding: 0 var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      font-size: 0.95rem;
    }
    .actions button:hover { border-color: var(--color-border-strong); }
    #copy-link {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
      font-weight: 600;
      transition: opacity 150ms ease;
    }
    #copy-link:hover { opacity: 0.85; border-color: var(--color-primary); }
    #rename-input {
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-weight: 800;
      font-size: 1.5rem;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      padding: var(--space-1) var(--space-2);
      width: 100%;
      max-width: 400px;
    }
    #set-songs, #add-results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .set-song {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
    }
    .set-song a {
      font-weight: 600;
      text-decoration: none;
    }
    .set-song a:hover { text-decoration: underline; }
    .set-song .author {
      color: var(--color-muted-foreground);
      font-size: 0.9rem;
    }
    .set-song .controls {
      margin-left: auto;
      display: flex;
      gap: var(--space-2);
    }
    .set-song .controls button {
      min-width: var(--control-height-compact);
      min-height: var(--control-height-compact);
      border: 1px solid var(--color-border);
      background: var(--color-card);
      color: var(--color-card-foreground);
      border-radius: var(--radius-sm);
      padding: 0 var(--space-3);
    }
    .set-song .controls button:last-child {
      color: var(--color-danger);
      border-color: var(--color-danger-border);
    }
    .set-song .controls button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    #add-search {
      width: 100%;
      min-height: var(--control-height);
      padding: 0 var(--space-4);
      font-size: 1rem;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      margin-top: var(--space-2);
    }
    #add-results button {
      width: 100%;
      text-align: left;
      min-height: var(--control-height);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
    }
  </style>
```

- [ ] **Step 2: Swap the block into the page**

Run:

```bash
node -e "const fs=require('fs');const [file,blockFile]=process.argv.slice(1);const src=fs.readFileSync(file,'utf8');const start=src.indexOf('<style');const end=src.indexOf('</style>',start)+'</style>'.length;if(start<0||end<start)throw new Error('style block not found');fs.writeFileSync(file,src.slice(0,start)+fs.readFileSync(blockFile,'utf8').trimEnd()+src.slice(end));" "src/pages/set/[id].astro" .superpowers/scratch/set-style.txt
```

Expected: no output. Confirm with `git diff "src/pages/set/[id].astro"` that only the style block changed.

- [ ] **Step 3: Build and test**

Run: `npm run build` — Expected: `Complete!`.
Run: `npm test` — Expected: PASS, 86 tests.

- [ ] **Step 4: Commit**

```bash
rm -f .superpowers/scratch/set-style.txt
git add "src/pages/set/[id].astro"
git commit -m "style: restyle the playlist page with design tokens"
```

---

### Task 5: Admin pages (`src/pages/admin/login.astro` and `src/pages/admin/index.astro`)

**Files:**
- Modify: `src/pages/admin/login.astro` (only its single `<style>…</style>` block, currently lines 16–36)
- Modify: `src/pages/admin/index.astro` (only its single `<style>…</style>` block, currently lines 63–97)

**Interfaces:**
- Consumes: the tokens from Task 1.

- [ ] **Step 1: Write the two new style blocks to scratch files**

Create `.superpowers/scratch/login-style.txt` with exactly:

```css
<style>
    .page { max-width: 420px; margin: calc(var(--space-6) * 2) auto 0; }
    #login-form { display: flex; gap: var(--space-3); }
    #password {
      flex: 1;
      min-height: var(--control-height);
      padding: 0 var(--space-4);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
    }
    button {
      min-height: var(--control-height);
      padding: 0 var(--space-5);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-control);
      background: var(--color-primary);
      color: var(--color-on-primary);
      font-weight: 600;
    }
    #status { color: var(--color-muted-foreground); margin-top: var(--space-3); white-space: pre-line; }
  </style>
```

Create `.superpowers/scratch/admin-style.txt` with exactly:

```css
<style>
    .page { max-width: 680px; margin: 0 auto; }
    section { margin-bottom: var(--space-6); }
    .status-box {
      padding: var(--space-4) var(--space-5);
      background: var(--color-card);
      border: 1px solid var(--color-border);
      border-left: 4px solid var(--color-accent);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-card);
    }
    #upload-form { display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start; }
    #upload-form input[type="file"] {
      min-height: var(--control-height);
      padding: var(--space-2) var(--space-3);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      font-size: 0.9rem;
    }
    #upload-form input[type="file"]::file-selector-button {
      margin-right: var(--space-3);
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      background: var(--color-muted);
      color: var(--color-foreground);
    }
    #upload-status { white-space: pre-line; color: var(--color-muted-foreground); }
    #backup-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    #backup-list li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-3) var(--space-4);
      background: var(--color-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
    }
    button {
      min-height: var(--control-height);
      padding: 0 var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control);
      background: var(--color-card);
      color: var(--color-card-foreground);
      font-weight: 600;
    }
    #upload-form button[type="submit"] {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
    .restore-btn {
      min-height: var(--control-height-compact);
      padding: 0 var(--space-4);
      color: var(--color-primary);
    }
  </style>
```

- [ ] **Step 2: Swap each block into its page**

Run:

```bash
node -e "const fs=require('fs');const [file,blockFile]=process.argv.slice(1);const src=fs.readFileSync(file,'utf8');const start=src.indexOf('<style');const end=src.indexOf('</style>',start)+'</style>'.length;if(start<0||end<start)throw new Error('style block not found');fs.writeFileSync(file,src.slice(0,start)+fs.readFileSync(blockFile,'utf8').trimEnd()+src.slice(end));" src/pages/admin/login.astro .superpowers/scratch/login-style.txt
node -e "const fs=require('fs');const [file,blockFile]=process.argv.slice(1);const src=fs.readFileSync(file,'utf8');const start=src.indexOf('<style');const end=src.indexOf('</style>',start)+'</style>'.length;if(start<0||end<start)throw new Error('style block not found');fs.writeFileSync(file,src.slice(0,start)+fs.readFileSync(blockFile,'utf8').trimEnd()+src.slice(end));" src/pages/admin/index.astro .superpowers/scratch/admin-style.txt
```

Expected: no output. Confirm with `git diff --stat` that only these two files changed and that neither file's markup or `<script>` changed.

- [ ] **Step 3: Build and test**

Run: `npm run build` — Expected: `Complete!`.
Run: `npm test` — Expected: PASS, 86 tests.

- [ ] **Step 4: Commit**

```bash
rm -f .superpowers/scratch/login-style.txt .superpowers/scratch/admin-style.txt
git add src/pages/admin/login.astro src/pages/admin/index.astro
git commit -m "style: restyle the admin login and dashboard with design tokens"
```

---

### Task 6: Duplicates report and 404 (`src/pages/duplicates.astro`, `src/pages/404.astro`)

**Files:**
- Modify: `src/pages/duplicates.astro` (only its single `<style>…</style>` block, currently lines 50–101)
- Check only (no change expected): `src/pages/404.astro`

**Interfaces:**
- Consumes: the tokens from Task 1.

- [ ] **Step 1: Write the new style block to a scratch file**

Create `.superpowers/scratch/duplicates-style.txt` with exactly:

```css
<style>
    .page {
      max-width: 680px;
      margin: 0 auto;
    }
    .intro {
      color: var(--color-muted-foreground);
      margin: 0 0 var(--space-5);
    }
    .status {
      color: var(--color-muted-foreground);
      margin-bottom: var(--space-5);
    }
    .groups {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .group {
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-card);
      background: var(--color-card);
      box-shadow: var(--shadow-card);
    }
    .group h2 {
      font-size: 1rem;
      margin: 0 0 var(--space-3);
    }
    .group-songs {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .group-songs a {
      font-weight: 600;
      text-decoration: none;
    }
    .group-songs a:hover {
      text-decoration: underline;
    }
    .author {
      color: var(--color-muted-foreground);
      font-size: 0.9rem;
    }
  </style>
```

- [ ] **Step 2: Swap the block into the page**

Run:

```bash
node -e "const fs=require('fs');const [file,blockFile]=process.argv.slice(1);const src=fs.readFileSync(file,'utf8');const start=src.indexOf('<style');const end=src.indexOf('</style>',start)+'</style>'.length;if(start<0||end<start)throw new Error('style block not found');fs.writeFileSync(file,src.slice(0,start)+fs.readFileSync(blockFile,'utf8').trimEnd()+src.slice(end));" src/pages/duplicates.astro .superpowers/scratch/duplicates-style.txt
```

Expected: no output.

- [ ] **Step 3: Confirm the 404 page needs no change**

`src/pages/404.astro` has no `<style>` block and uses only the layout's `h1`, `p` and `a` styles, which Task 1 already restyled. Run `grep -c "<style" src/pages/404.astro`; expected output `0`. Make no change to the file.

- [ ] **Step 4: Build and test**

Run: `npm run build` — Expected: `Complete!`.
Run: `npm test` — Expected: PASS, 86 tests.

- [ ] **Step 5: Commit**

```bash
rm -f .superpowers/scratch/duplicates-style.txt
git add src/pages/duplicates.astro
git commit -m "style: restyle the duplicates report with design tokens"
```

---

### Task 7: Verification (screenshots, theme toggle, behavior smoke test)

**Files:** none are changed by this task unless it finds a bug. Temporary files live under `.superpowers/scratch/` and are deleted at the end.

**Interfaces:**
- Consumes: everything from Tasks 1–6.

This task produces the evidence the owner reviews before anything deploys. Do **not** push or deploy.

- [ ] **Step 1: Prepare a local environment**

Run:

```bash
npm run import
npm run seed-local-kv
npm run build
npm install --no-save playwright
npx playwright install chromium
```

Expected: songs imported, local KV seeded, build `Complete!`, Playwright and Chromium installed. Confirm with `git status --short` that `package.json` and `package-lock.json` are unchanged (`--no-save` keeps them untouched).

- [ ] **Step 2: Start the local Worker**

Run `npx wrangler dev --port 8793` as a background process (the repo's `.dev.vars` provides the local-only admin credentials `ADMIN_PASSWORD=local-test-password-only`). Wait until `http://localhost:8793/` returns 200.

- [ ] **Step 3: Write and run the screenshot and toggle script**

Create `.superpowers/scratch/verify.mjs`:

```js
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:8793';
const OUT = '.superpowers/scratch/screens';
mkdirSync(OUT, { recursive: true });

const songs = JSON.parse(readFileSync('src/data/songs.json', 'utf8'));
const first = songs.slice(0, 3);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();

// Create one real playlist (local KV) and log in once so pages can be shot.
const setup = await browser.newContext();
const created = await setup.request.post(`${BASE}/api/setlists`, {
  data: { songIds: first.map((s) => s.id), name: 'Sunday Service' },
});
const { id: setId } = await created.json();
await setup.request.post(`${BASE}/api/admin/login`, { data: { password: 'local-test-password-only' } });
const adminState = await setup.storageState();
await setup.close();

const pages = [
  ['home', '/'],
  ['song', `/song/${first[0].slug}/?set=${setId}`],
  ['playlist', `/set/${setId}/`],
  ['duplicates', '/duplicates/'],
  ['admin-login', '/admin/login'],
  ['admin', '/admin/'],
  ['notfound', '/song/definitely-not-a-song/'],
];
const viewports = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

for (const scheme of ['light', 'dark']) {
  for (const [vpName, viewport] of Object.entries(viewports)) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, storageState: adminState });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [name, path] of pages) {
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-${vpName}.png`, fullPage: true });
    }
    check(`no page errors (${scheme}, ${vpName})`, errors.length === 0, errors.join('; '));
    await ctx.close();
  }
}

// Theme toggle behavior, system set to dark.
{
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('follows system (dark) with nothing saved', (await theme()) === null && (await bg()) === 'rgb(18, 17, 28)', await bg());
  check('toggle label offers light mode', (await page.getAttribute('#theme-toggle', 'aria-label')) === 'Switch to light mode');
  await page.click('#theme-toggle');
  check('click switches to light immediately', (await theme()) === 'light' && (await bg()) === 'rgb(246, 247, 251)', await bg());
  check('label updates', (await page.getAttribute('#theme-toggle', 'aria-label')) === 'Switch to dark mode');
  check('choice is saved', (await page.evaluate(() => localStorage.getItem('songSearchTheme'))) === 'light');
  await page.reload();
  check('choice survives reload', (await theme()) === 'light');
  await page.goto(BASE + '/duplicates/');
  check('choice applies on another page', (await theme()) === 'light');
  await page.click('#theme-toggle');
  check('toggles back to dark', (await theme()) === 'dark');
  await ctx.close();
}

// Toggle must still work when localStorage is blocked.
{
  const ctx = await browser.newContext({ colorScheme: 'light' });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/duplicates/');
  await page.click('#theme-toggle');
  const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('toggle works with localStorage blocked', t === 'dark');
  check('no uncaught errors with localStorage blocked', errors.length === 0, errors.join('; '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
```

Run: `node .superpowers/scratch/verify.mjs`
Expected: all checks PASS and screenshots written to `.superpowers/scratch/screens/` (7 pages × 2 modes × 2 viewports = 28 images). If a check fails, diagnose and fix with a small targeted commit, then re-run.

- [ ] **Step 4: Behavior smoke test**

Create and run `.superpowers/scratch/smoke.mjs`:

```js
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Search
await page.goto(BASE + '/');
await page.fill('#search', 'grace');
await page.waitForSelector('#results .result-card');
check('search returns result cards', (await page.locator('#results .result-card').count()) > 0);

// Tabs
await page.fill('#search', '');
await page.click('.tab[data-tab="favorites"]');
check('favorites tab becomes active', (await page.locator('.tab.active[data-tab="favorites"]').count()) === 1);
await page.click('.tab[data-tab="all"]');

// Add to draft, save as playlist
await page.locator('.add-to-set-btn').first().click();
await page.click('.tab[data-tab="set"]');
await page.fill('.playlist-name-input', 'Smoke Test Set');
await page.click('.set-controls button:has-text("Save")');
await page.waitForSelector('text=Smoke Test Set');
check('draft saved as a named playlist', true);
const href = await page.locator('.set-controls a:has-text("Smoke Test Set")').getAttribute('href');

// Playlist page, song link, back link
await page.goto(BASE + href);
await page.waitForSelector('.set-song a');
await page.click('#rename-btn');
await page.fill('#rename-input', 'Renamed Smoke Set');
await page.click('#rename-btn');
await page.waitForFunction(() => document.getElementById('playlist-name').textContent === 'Renamed Smoke Set');
check('playlist rename works', true);
await page.locator('.set-song a').first().click();
await page.waitForSelector('#back-link');
check('song page back link returns to the playlist', (await page.textContent('#back-link')).includes('Back to playlist'));
await page.click('#favorite-toggle');
check('favorite toggle works', (await page.getAttribute('#favorite-toggle', 'aria-pressed')) === 'true');

// Admin login + upload
await page.goto(BASE + '/admin/login');
await page.fill('#password', 'local-test-password-only');
await page.click('button[type="submit"]');
await page.waitForURL('**/admin/');
await page.setInputFiles('#songs-file', 'data/Songs.db');
await page.setInputFiles('#words-file', 'data/SongWords.db');
await page.click('#upload-form button[type="submit"]');
await page.waitForFunction(() => document.getElementById('upload-status').textContent.includes('Imported'));
check('admin upload succeeds', true);

// Upload again so a backup is guaranteed to exist, then restore it.
await page.waitForTimeout(2500); // the dashboard reloads itself after a successful upload
await page.setInputFiles('#songs-file', 'data/Songs.db');
await page.setInputFiles('#words-file', 'data/SongWords.db');
await page.click('#upload-form button[type="submit"]');
await page.waitForFunction(() => document.getElementById('upload-status').textContent.includes('Imported'));
await page.waitForTimeout(2500);
page.once('dialog', (d) => d.accept());
await page.locator('.restore-btn').first().click();
await page.waitForFunction(() => document.getElementById('upload-status').textContent.includes('Restored'));
check('admin restore succeeds', true);

check('no uncaught page errors', errors.length === 0, errors.join('; '));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
```

Run: `node .superpowers/scratch/smoke.mjs`
Expected: all checks PASS. (These write test data to the *local* emulated KV/R2 only.)

- [ ] **Step 5: Inspect the screenshots**

Open at least these in the image viewer: `home-light-desktop.png`, `home-dark-phone.png`, `song-light-desktop.png`, `playlist-dark-phone.png`, `admin-light-desktop.png`, `admin-login-dark-desktop.png`. Look for: text running into buttons, unreadable text, the `+` button overlapping titles, the header controls wrapping badly at phone width, and any page that still looks like the old design. Record findings in the report; fix real defects in small commits and re-run Steps 3–4.

- [ ] **Step 6: Clean up**

Stop `wrangler dev` and confirm nothing is listening on port 8793. Playwright was installed with `--no-save`, so there is nothing to uninstall; confirm `git status --short` shows no change to `package.json` or `package-lock.json`. Leave the screenshots in `.superpowers/scratch/screens/` for the owner's review (they are untracked) and delete only `.superpowers/scratch/verify.mjs` and `.superpowers/scratch/smoke.mjs`.

- [ ] **Step 7: Report**

Report: the pass/fail list from Steps 3–4, the screenshot directory path, any defects found and fixed (with commit SHAs), the final `npm test` count (expected 86), and confirmation that nothing was pushed or deployed.

// Builds a static, self-contained mockup of the redesigned home page from the real
// tokens (Layout.astro) and shared styles (components.css). Not shipped with the site.
import { readFileSync, writeFileSync } from 'node:fs';

const layout = readFileSync('src/layouts/Layout.astro', 'utf8');
const globalCss = layout.match(/<style is:global>([\s\S]*?)<\/style>/)[1];
const layoutCss = layout.match(/<\/style>\s*<style>([\s\S]*?)<\/style>/)[1];
const components = readFileSync('src/styles/components.css', 'utf8');

const homeCss = `
.search-field { position: relative; }
.search-field .search-icon { position: absolute; left: var(--space-4); top: 50%; transform: translateY(-50%); color: var(--color-muted-foreground); pointer-events: none; }
.search-field .input { padding-left: calc(var(--space-4) + 28px); min-height: 52px; font-size: var(--text-lg); box-shadow: var(--shadow-card); }
.hint { color: var(--color-muted-foreground); font-size: var(--text-sm); margin: var(--space-2) 0 0; }
#tabs { display: flex; gap: var(--space-5); margin-top: var(--space-5); border-bottom: 1px solid var(--color-border); overflow-x: auto; }
.tab { appearance: none; background: none; border: none; border-bottom: 3px solid transparent; margin-bottom: -1px; padding: var(--space-3) 0; font: inherit; font-size: var(--text-sm); font-weight: 600; white-space: nowrap; color: var(--color-muted-foreground); }
.tab:hover { color: var(--color-foreground); }
.tab.active { color: var(--color-foreground); border-bottom-color: var(--color-accent); }
#results { list-style: none; margin: var(--space-5) 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); }
.result-item { position: relative; }
.result-card { display: block; padding: var(--space-4) calc(var(--control-height-compact) + var(--space-6)) var(--space-4) var(--space-5); color: var(--color-card-foreground); text-decoration: none; transition: border-color 150ms ease, box-shadow 150ms ease; }
.result-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-raised); }
.result-title { font-size: var(--text-lg); font-weight: 700; }
.result-author { color: var(--color-muted-foreground); font-size: var(--text-sm); }
.add-to-set-btn { position: absolute; top: var(--space-3); right: var(--space-3); color: var(--color-primary); font-size: 1.1rem; }
.stack { grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-2); }
.stack .section-label { margin-top: var(--space-4); }
details > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: var(--space-2); }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: '\u25B8'; color: var(--color-muted-foreground); }
details[open] > summary::before { content: '\u25BE'; }
details > summary > .row { flex: 1; }
.date-group > summary { padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-card); font-weight: 600; }
.group-songs { list-style: none; margin: var(--space-2) 0 0; padding: 0 0 0 var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
`;

const body = `
<div class="container">
  <div class="site-header">
    <a href="/" class="logo-link"><img src="../../../public/logo.png" alt="Church logo" class="site-logo" /></a>
    <div class="header-actions">
      <a href="#" class="admin-link btn">Admin</a>
      <button type="button" id="theme-toggle" class="theme-toggle btn btn-icon" aria-label="Toggle theme">&#9680;</button>
    </div>
  </div>
  <h1>Wisdom Assembly Song Search</h1>
  <div class="search-field">
    <svg class="search-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input class="input" placeholder="Search by title or lyrics..." />
  </div>
  <p class="hint">Try a phrase from the lyrics, or the title.</p>
  <div id="tabs">
    <button class="tab">All Songs</button><button class="tab">Favorites</button>
    <button class="tab">Recently Viewed</button><button class="tab active">Service List</button>
  </div>
  <ul id="results">
    <li class="stack">
      <span class="section-label">Currently building</span>
      <div class="row"><input class="input" style="flex:1;min-width:180px" placeholder="Name this service list" /><button class="btn">Add section</button><button class="btn btn-primary">Save</button></div>
      <details open><summary><div class="row section-row" style="border-bottom:2px solid var(--color-border-strong)"><strong>Opening Worship (1)</strong><span class="row-controls"><button class="btn btn-sm">Rename</button><button class="btn btn-sm btn-danger">Remove</button></span></div></summary>
        <ul class="group-songs"><li><div class="row"><a class="row-title" href="#">Great Is Thy Faithfulness</a><span class="row-controls"><button class="btn btn-sm">&uarr;</button><button class="btn btn-sm">&darr;</button><button class="btn btn-sm btn-danger">Remove</button></span></div></li></ul>
      </details>
      <span class="section-label">Your Service Lists</span>
      <div class="row"><a class="row-title" href="#">Sunday Service</a><span class="badge">Oct 12, 2026</span><span class="row-controls"><button class="btn btn-sm">Forget</button></span></div>
      <span class="section-label">All Service Lists</span>
      <details class="date-group" open><summary>Oct 12, 2026 &middot; 2 lists</summary>
        <ul class="group-songs">
          <li><div class="row"><a class="row-title" href="#">Sunday Service</a><span class="badge">12 songs</span><span class="row-controls"><button class="btn btn-sm btn-danger">Delete</button></span></div></li>
          <li><div class="row"><a class="row-title" href="#">Evening Prayer — a rather long list name that must wrap nicely</a><span class="badge">5 songs</span><span class="row-controls"><button class="btn btn-sm btn-danger">Delete</button></span></div></li>
        </ul>
      </details>
      <details class="date-group"><summary>Oct 5, 2026 &middot; 1 list</summary>
        <ul class="group-songs"><li><div class="row"><a class="row-title" href="#">Youth Night</a><span class="badge">8 songs</span><span class="row-controls"><button class="btn btn-sm btn-danger">Delete</button></span></div></li></ul>
      </details>
    </li>
  </ul>
  <ul id="results" style="margin-top:var(--space-6)">
    <li class="result-item"><a class="card result-card" href="#"><div class="result-title">Amazing Grace</div><div class="result-author">John Newton</div></a><button class="btn btn-icon btn-sm add-to-set-btn" aria-label="Add to list">+</button></li>
    <li class="result-item"><a class="card result-card" href="#"><div class="result-title">How Great Thou Art</div><div class="result-author">Carl Boberg</div></a><button class="btn btn-icon btn-sm add-to-set-btn" aria-label="Add to list">+</button></li>
  </ul>
</div>
<script>
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
</script>`;

const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home redesign mockup</title>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${globalCss}</style><style>${layoutCss}</style><style>${components}</style><style>${homeCss}</style></head>
<body>${body}</body></html>`;

writeFileSync('docs/superpowers/mockups/home-redesign.html', html);
console.log('wrote docs/superpowers/mockups/home-redesign.html');

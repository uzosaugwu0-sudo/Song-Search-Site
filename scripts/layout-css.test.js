import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const components = read('../src/styles/components.css');
const home = read('../src/pages/index.astro');
const NEWLINE = String.fromCharCode(10);

// Returns the declarations of the first rule that starts a line with exactly `selector {`.
function rule(css, selector) {
  const marker = selector + ' {';
  let from = 0;
  for (;;) {
    const at = css.indexOf(marker, from);
    assert.ok(at !== -1, 'missing CSS rule for ' + selector);
    const lineStart = css.lastIndexOf(NEWLINE, at) + 1;
    if (css.slice(lineStart, at).trim() === '') {
      return css.slice(at + marker.length, css.indexOf('}', at));
    }
    from = at + 1;
  }
}

test('tab bar does not overflow vertically: no negative bottom margin on tabs', () => {
  assert.ok(!rule(home, '.tab').includes('margin-bottom: -'));
});

test('tab focus ring is drawn inside the tab so the scrolling bar cannot clip it', () => {
  assert.ok(rule(home, '.tab:focus-visible').includes('outline-offset: -'));
});

test('list links in rows keep a comfortable tap target', () => {
  assert.ok(rule(components, '.row-title').includes('min-height: var(--control-height-compact)'));
});

test('danger buttons keep their red border while hovered', () => {
  const hover = rule(components, '.btn-danger:hover:not(:disabled)');
  assert.ok(hover.includes('border-color: var(--color-danger-border)'));
});

test('an empty date badge is hidden instead of showing an empty pill', () => {
  assert.ok(rule(components, '.badge:empty').includes('display: none'));
});

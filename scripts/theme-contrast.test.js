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
  ['foreground on muted', '--color-foreground', '--color-muted', 4.5],
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

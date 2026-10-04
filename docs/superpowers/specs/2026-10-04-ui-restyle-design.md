# Site-Wide UI Restyle — Design

## Goal

Give the whole site a fresh, modern look built around the church logo's
purple and gold, make the pages consistent with each other, and add a
light/dark mode toggle. Apart from that one new control, this is a
**restyle only**: no markup, layout, feature or behavior changes.

Motivations, all approved: a fresh look (new palette, type treatment and
polish), consistency (the pages currently each carry their own one-off
radius, padding and button values), and a visitor-controlled light/dark
choice.

## Scope

**In scope:** every page that renders through `src/layouts/Layout.astro`:
home (`index.astro`), song (`song/[slug].astro`), playlist
(`set/[id].astro`), duplicates report, 404, admin login and admin
dashboard, plus the shared header (logo link, Admin button and the new
theme toggle).

**Out of scope:**
- Any change to page structure, element order, features or copy (other
  than the single new theme toggle button in the header).
- Replacing the Sora font or the logo file.
- New component classes or a shared component stylesheet (a heavier
  alternative that was considered and rejected as higher regression risk
  for this site's size).

## Style direction

"Clean Modern" with the logo's colors as accents: neutral backgrounds,
white cards with soft shadows, a segmented tab control, purple as the main
action color, gold as the highlight.

## Design tokens

All values live as CSS custom properties in `Layout.astro`. **Existing
variable names are kept** (so every page that already uses
`var(--color-…)` picks up the new palette automatically) and new ones are
added. Colors are starting points: the contrast check below is
authoritative and any pair that fails WCAG AA gets a small adjustment.

| Token | Light | Dark |
|---|---|---|
| `--color-background` | `#f6f7fb` | `#12111c` |
| `--color-foreground` | `#171a2b` | `#ecebf7` |
| `--color-card` | `#ffffff` | `#1c1b2b` |
| `--color-card-foreground` | `#171a2b` | `#ecebf7` |
| `--color-muted` | `#eceef7` | `#25243a` |
| `--color-muted-foreground` | `#646a82` | `#a09fba` |
| `--color-border` | `#e4e6f0` | `#302f45` |
| `--color-primary` (logo purple) | `#4a3b9c` | `#9a8cf0` |
| `--color-on-primary` | `#ffffff` | `#14121f` |
| `--color-accent` (gold, new meaning) | `#c8a24a` | `#d9b45c` |
| `--color-on-accent` (new) | `#3a2f12` | `#2a2008` |
| `--color-danger` (new, logo red) | `#b3261e` | `#f2766d` |
| `--color-danger-border` (new) | `#f0c9c6` | `#5a3030` |

`--color-accent` is not referenced by any page today, so repointing it at
gold is safe.

Shape, spacing and sizing (identical in both modes):

- `--radius-sm: 8px`, `--radius-control: 12px`, `--radius-card: 16px`,
  `--radius-pill: 999px`
- `--space-1…6`: 4, 8, 12, 16, 24, 32px
- `--control-height: 44px` (minimum height of every button and input)
- `--shadow-card` and `--shadow-raised`: soft two-layer shadows, with a
  darker variant in dark mode
- `--focus-ring`: a 2px gold outline with 2px offset

Type: Sora stays. Headings weight 800, body 400, small text 0.875rem.

**Gold rule:** gold is used only for fills, borders, focus rings, the
active-tab underline and the favorite star, never as text on a light
background (it does not meet contrast there). Text placed on a gold fill
uses `--color-on-accent`.

## Light / dark toggle

**Behavior.**
- A round icon button in the header, next to the Admin button, shows a moon
  in light mode and a sun in dark mode. Clicking it switches to the other
  mode immediately.
- With no saved choice the site follows the visitor's system setting
  (`prefers-color-scheme`), exactly as it does today. Once a visitor
  clicks the toggle, their choice is saved in `localStorage` under
  `songSearchTheme` (`"light"` or `"dark"`, matching the existing
  `songSearch…` key naming) and wins over the system setting on every page
  and every later visit, on that browser only.
- It appears on every page that uses the layout, including the admin pages.
- If `localStorage` is unavailable, the toggle still works for the current
  page and simply doesn't persist (every access is wrapped in try/catch,
  as the site's other localStorage code is).

**Mechanism.**
- Tokens are keyed on an optional `data-theme` attribute on `<html>`:
  `:root[data-theme="dark"]` and `:root[data-theme="light"]` set the
  explicit palettes and the matching `color-scheme`. The existing
  `@media (prefers-color-scheme: dark)` block applies only when no
  `data-theme` is set (`:root:not([data-theme="light"])`). The dark token
  values therefore appear twice in the stylesheet (media query and
  attribute); this is the standard pattern and avoids needing JavaScript
  for the default case.
- A small inline script in `<head>` (`is:inline`, before first paint) reads
  `songSearchTheme` and sets `data-theme` so a returning visitor never sees
  a flash of the wrong theme. The click handler lives in the same script
  and attaches once the DOM is ready.
- The button has an accessible name that describes the action ("Switch to
  dark mode" / "Switch to light mode"), updated on every change, a 44px hit
  area, and the standard gold focus ring.

## Implementation

1. **Tokens.** Replace the values in the existing `:root` and dark-mode
   blocks in `Layout.astro`, add the new tokens above, and add the
   `data-theme` selectors described under the toggle.
2. **Shared base rules.** Add one `<style is:global>` block to
   `Layout.astro` styling plain elements: buttons, text/search/file
   inputs and links get `--control-height`, `--radius-control`, a
   consistent border, inherited font, and a visible `:focus-visible` ring.
   (Astro scopes a plain `<style>` to the layout's own elements, so this
   block must be `is:global`.) Page markup and class names are unchanged.
3. **Header and toggle.** Add the theme toggle button and its inline script
   to the layout; restyle the Admin button to match the secondary-button
   treatment.
4. **Per-page pass.** In each page, replace literal radius, padding, gap
   and shadow values with the tokens, and give the primary action on the
   page the purple fill. Order, committed page by page so any regression
   is isolated: header and shell, home, song, playlist, admin login and
   dashboard, then duplicates and 404.
5. **Left untouched:** the `define:vars` script on the song page (it
   cannot contain imports), all behavior scripts, and every route handler.

## Accessibility

- Every text/background pair used on the site meets WCAG AA (4.5:1 for
  body text, 3:1 for large text and UI borders) in both modes, including
  when a mode is forced by the toggle.
- Every button and input is at least 44px tall.
- Keyboard focus is always visible via the gold ring; the toggle is
  reachable and operable by keyboard.
- No information is conveyed by color alone (Remove keeps its text label).

## Verification

- **Contrast:** a one-off script computes the ratio for every
  text/background token pair in both modes; failures are fixed by small
  token adjustments before any page work is considered done.
- **Toggle:** in a real browser, confirm: follows the system setting when
  nothing is saved; clicking switches immediately; the choice survives a
  reload and a navigation to another page with no flash of the other
  theme; the icon and accessible name update; works with `localStorage`
  blocked (no persistence, no errors).
- **Visual:** screenshots of every page in light and dark at phone and
  desktop widths, taken with a temporary Playwright install that is
  removed afterward, reviewed with the owner before anything deploys.
- **Regression:** the existing 83 unit tests and the production build stay
  green. The toggle is small DOM code verified in the browser; no new unit
  tests are added.
- **Behavior smoke test:** after the restyle, the search, tabs, add-to-set,
  playlist save/rename, song back-link and admin upload/restore flows are
  clicked through once in a real browser.

## Risks

- `index.astro` is the largest file (about 785 lines, nine radius
  declarations) and carries most of the risk. Mitigation: it is done as
  its own commit with before/after screenshots.
- Scoped-vs-global CSS: forgetting `is:global` on the base rules would make
  them silently not apply. Mitigation: verified in the first screenshots.
- Theme flash or a stuck theme: the inline head script must run before
  paint and must never throw. Mitigation: try/catch around storage,
  verified by the reload check above.
- Dark mode contrast regressions on gold or purple. Mitigation: the
  contrast script covers both modes.

## Rollout

No data, API, secret or infrastructure changes. Work is committed locally,
previewed via screenshots, and pushed and deployed only after the owner
approves.

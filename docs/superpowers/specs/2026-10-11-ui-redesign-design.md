# UI Redesign (Look and Layout) — Design

## Goal
Give the whole site a refreshed look and improved layouts, keeping the church's
purple and gold identity, with **no behaviour or feature changes**. Success: every
page looks consistent and modern, stays readable and easy to tap on a phone, works in
light and dark mode, and all existing features and tests still work.

## Decisions (from brainstorming)
- Depth: **new look, same tech.** No React, no Tailwind, and `npx shadcn init` is NOT run.
- Scope: **look and layout.** Styling plus rearranged layouts where helpful (header, tabs,
  result cards, list rows, list pages). Features and behaviour are unchanged.
- Palette: **keep purple and gold** (from the logo). Surfaces, type, spacing and
  components change; the identity does not.
- Tools: shadcn = style reference only; 21st.dev = reference layouts for specific
  pieces; ui-ux-pro-max = the design system and accessibility guidance.

## Current state
Plain Astro 5 on Cloudflare Workers; interactive UI is hand-written browser JS building
DOM nodes (`index.astro` is ~970 lines). Colour/spacing/radius tokens live as CSS custom
properties in `src/layouts/Layout.astro` (from the 2026-10-04 restyle, spec
`2026-10-04-ui-restyle-design.md`), guarded by `scripts/theme-contrast.test.js`. Each
page carries its own button/card/input CSS, which causes drift.

## Design
1. **Design system first.** Using ui-ux-pro-max, define: type scale, spacing scale,
   radius/shadow scale, and specs for header, tabs, buttons (primary/secondary/danger),
   cards, list rows, inputs, dialogs (`.site-dialog`), and empty/loading states.
   shadcn's structure (variants, focus ring, subtle borders) is the style reference.
2. **Reference layouts.** Pull 2-4 relevant patterns from 21st.dev for the pieces that
   change layout. The 21st MCP must be reconnected via `/mcp` first; if unavailable, use
   ui-ux-pro-max patterns instead.
3. **Structure.** Colour tokens stay in `Layout.astro` (contrast test keeps guarding
   them, with new cases for any new token pair). Add ONE shared stylesheet
   (`src/styles/components.css`, imported by `Layout.astro`) for buttons, cards, tabs,
   inputs and dialogs, replacing per-page duplicates. Pages keep only their own layout
   CSS. This reverses the 2026-10-04 spec's "no shared component stylesheet" rule,
   because a layout redesign makes the duplication costly.
4. **Order of work** (each step its own commit, so any step can be reverted alone):
   a. Tokens + shared stylesheet + header (logo, Admin button, theme toggle).
   b. Home page mockup (standalone HTML) for approval BEFORE code changes.
   c. Home page: tabs, search results, Service List tab (draft, your lists, all lists).
   d. Song page. e. Service list page. f. Admin, duplicates, 404 pages.
5. **Quality bar.** WCAG 2.2 AA contrast in both themes; visible focus rings; touch
   targets at least the current control height; layouts work at 360px wide; honours
   `prefers-reduced-motion`; no horizontal page scroll.
6. **Verification.** `npm test` (existing 123 tests + any new contrast cases) and
   `npm run build` after each step; the user reviews each page in a browser (the agent
   has no browser) before the next step starts.

## Error handling / risk
- Behavioural regressions: JS that builds DOM keeps its class names where possible; any
  renamed class is updated in the same commit. Search/shortcuts/lists are re-checked by
  the user after each page.
- Dark-mode contrast: new tokens must pass the contrast test before use.
- Rollback: one commit per step; `git revert <sha>` removes a step.

## Testing
Unit: extend `scripts/theme-contrast.test.js` for any new text/background token pair.
The rest is visual and verified by build plus user review.

## Out of scope
React, Tailwind, installing shadcn or any component library; new features or
behaviour changes; swapping the logo; changing copy except where a layout change needs
shorter labels. Font stays Sora unless ui-ux-pro-max recommends otherwise and the user
approves.

## Open questions (resolved during implementation)
- Whether to keep Sora (default: keep).
- Which 21st.dev references fit (chosen at step b with the mockup).

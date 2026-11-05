# Design — Panel Header Icon-Only Below 530px (2026-11-05)

## Intent & why
Panel columns can be resized narrow (the floor's gutters). Below ~530px the
conversation header's text-bearing controls — the `open-browser` button and the
`running-status` pill — crowd the header row. When the column is narrow they
should show only their icon (identity), hiding the text; the meaning already
lives in `title` / `aria-label`.

## Goals
- Below 530px column width: `open-browser` shows icon only; `running-status` shows the state dot only (text hidden).
- Works live during gutter drags — no JS width plumbing.
- data-testids preserved (`open-browser`, `running-status`); page/panel tests keep passing.
- Accessibility: `title` (button) and `aria-label` (status role) already carry the names.

## Non-goals / anti-goals
- No prop threading of width through PanelColumn → route → header (rejected).
- No other header controls change (agent chip, fork, capture stay as-is).

## Approaches considered
1. **CSS container query (chosen)** — `.column` becomes an inline-size
   container; `@container (max-width: 529px)` hides the text spans. Pure CSS,
   reactive during drags, one place.
2. **Thread width as props** — explicit but drills through several layers and
   duplicates a CSS concern in TS. Rejected by operator.

## Build decisions
- `PanelColumn.svelte`: `container-type: inline-size` on `.column`; a
  scoped `@container` block applies the narrow rules.
- `BrowserButton.svelte`: gains a globe icon (lucide `Globe`) before the
  label; below 530px the label span is hidden — icon-only state.
- `running-status`: the text node wraps in a span; below 530px that span is
  hidden — dot-only state. `aria-label` keeps running/idle.
- Icon-only styling triggered via a shared class hook (`.icon-only-hide` on
  the text spans) so one container rule covers both.

## Left to the builder
- Exact icon choice (globe) and any padding tweak for the icon-only button.
- Test assertions: e2e/component asserting the CSS hook classes exist; visual
  check on the glass.

# CodeCard Capture Button — Short Design (2026-11-22)

## Intent & why
The operator wants a canvas-copy-button in the top-right of the run_code
CodeCard popup body, capturing the card as a PNG — including content that is
scroll-clipped by the popup and everything currently collapsed behind toggles.

## Goals
- Mount CanvasCopyButton (container-base) top-right of the card title row
  (title row becomes justify-between); muted hover skin, size 12, header parity.
- Capture target: the data-testid="code-card" div (bind:this). Mode 'full'
  (default) so scroll-clipped content is fully captured.
- On click, ALL collapsed sections are temporarily expanded before raster:
  over-cap code lines (expanded), program-output footer (footerOpen),
  raw JSON panes (rawOpen). After capture, all three restore to their
  pre-click states.

## Non-goals / anti-goals
- No capture of the whole popup or chip row — card only.
- No junk-args raw view button (rawOnly branch unchanged).
- No change to CanvasCopyButton's existing consumers or pinned testids.

## Approach decision
A (picked): prepare hook on CanvasCopyButton. One optional prop
prepare?: () => void | Promise<void> | (() => void) — awaited before render;
if it returns a function, that runs in finally after the raster (success or
failure). CodeCard's prepare saves the three states, opens them all, returns
the restore. Rejected B (imperative capture API on bind:this): bigger contract
change, hairier click interception timing.

## Constraints
- Container-base stays dumb: it awaits/cleans, never knows what preparation means.
- html-to-image optional-peer contract and degraded latch unchanged.
- Restore is exact: what was open before stays open after.

## Left to the builder
- Await one microtask/effect flush inside prepare before resolve (raster must
  see the expanded DOM).
- Unit tests: base prepare/cleanup contract (incl. restore on failure);
  CodeCard expand-capture-restore wiring.
- e2e anchor: click code-card [data-testid="canvas-copy-button"] inside the popup.

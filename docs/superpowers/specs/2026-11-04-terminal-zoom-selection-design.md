# Design — Terminal mouse selection under floor zoom (the counter-scale pocket)

- **Date:** 2026-11-04
- **Status:** Approved by operator ("am fine with your approach")
- **Size:** small change (one component + tests)
- **Companions:** ADR-0041 (The Zoom-Honest Glass — Amendment 2 doctrine), PanelsZoom two-layer frame

## Intent and why

Selecting text in a terminal panel on a zoomed floor grabs the wrong rows: selecting
from the last row up "2 lines" lands 3+ rows higher (operator screenshot, 2026-11-04).
The terminal renders inside PanelsZoom's row, which carries `transform: scale(--zoom)`;
xterm.js computes mouse→cell coordinates from its own cell dimensions while the
ancestor transform scales the visual space — a split coordinate space, the same
disease ADR-0041 Amendment 2 cured on the Glass (zoom-honest doctrine: one truthful
coordinate space by construction, never pointer-coordinate patching).

## Goals

- Terminal text selection is pixel-exact at any floor zoom.
- Terminal still zooms visually with the floor (fontSize × zoom + refit).
- No restructuring of PanelsZoom; change is contained to the terminal branch.

## Non-goals

- Fixing xterm internals or upstreaming.
- Pointer-coordinate rescaling (ADR-0041 Am.2 REJECTED pattern).
- Changing floor zoom mechanics for non-terminal panels.

## Anti-goals

- A second zoom authority that can drift (slot-mirror lesson, ADR-0040 D2).

## Approaches considered

1. **Counter-scale pocket (CHOSEN).** Inside the terminal branch only, wrap the xterm
   host in `transform: scale(1/zoom)` with pre-multiplied layout width (and
   counter-scaled height, the row's own idiom). Net: xterm lives in a 1:1 coordinate
   pocket; its mouse math is exact by construction. Visual zoom reaches xterm via
   `fontSize × zoom` (continuous fractional) + `fitAddon.fit()` on zoom change
   (the ResizeObserver/f refit plumbing already exists). Tradeoff: glyphs scale in
   font steps, not pixel-identical with neighbors — accepted by operator.
2. **Pointer-coordinate compensation (REJECTED).** Divide mouse coords by 1/zoom
   before xterm sees them. xterm exposes no coordinate-injection API → patching
   internals or re-implementing selection forwarding; also the exact pattern
   ADR-0041 Am.2 rejected ("rescaling dispatched input coordinates by 1/zoom").
3. **Take terminals out of the zoom frame (REJECTED).** TerminalDesk is nested deep
   in `panels-row` (operator's DOM probe); opting one panel kind out breaks the
   frame's layout-width/scroll-truth contract.

## Decisions

- Zoom prop reaches TerminalPanel through the existing panel-column prop chain
  (one authority: panel-prefs → PanelsZoom prop → panel).
- Continuous fractional fontSize (operator choice, pending nothing — they approved
  the approach as presented).
- Refit on zoom change reuses the existing ResizeObserver effect; the pocket's
  layout size is zoom-fingerprinted so the pocket re-measures with the floor.

## Left to the builder

- Exact wrapper markup/classes and where the zoom prop lands in TerminalPanel props.
- Test seam fakes (scaled ancestor fixture) — follow ADR-0041's unit-test idiom.

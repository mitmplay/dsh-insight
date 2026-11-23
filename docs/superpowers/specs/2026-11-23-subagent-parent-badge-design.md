# Sub-Agent Parent Badge (Approach A) — Short Design

Date: 2026-11-23 · Status: awaiting operator approval

## Intent & why

When the spine's sub-agent filter (`sidebar-spine-subagents`, Bot/BotOff) hides
spawned rows, a parent session that spawned sub-agents looks like any plain
session — the operator loses the fact that it has children. Add a mark on the
PARENT row, in the Scheduled-Mark grammar (ADR-0057), so the parent always
discloses "I spawned N sub-agents".

## Goals

- A muted pill BEFORE the label on every spine row that has ≥1 spawned child
  (`origin 'subagent'` rows with `parentSessionId` pointing at it): a small
  Bot glyph + the count, e.g. `🤖 5`.
- Same visual grammar as the `{SCH}` pill: hairline border, muted ink, tiny
  fixed footprint, `flex-shrink: 0`, theme vars (light + dark, no overrides).
- Pure decoration (ADR-0057 D3): nothing keys behavior to the badge; the
  count glyph is `aria-hidden`, the count number stays readable text.

## Non-goals

- NO badge on the sub-agent (child) rows themselves — they keep the tree line
  (Approach A, operator pick 2026-11-23; B — parent pill + child SUB tag — was
  rejected as tighter-sidebar noise).
- No interaction on the pill (no click, no popover — the row's own verbs stay).
- No change to the filter, lineage, or suppression logic.

## Approach (the one picked)

**A — parent count pill only.** Rejected alternative B (parent pill + child
`SUB` pill) lost: two badges in tight sidebar width and the child's identity is
already carried by indentation + the tree line. Rejected alternative C (reuse
the SessionStatus delegated dot) lost: that dot means running-delegation state,
not "has spawned children", and it is not a count.

## Plumbing

1. `WorkspaceRowItem.svelte` gains a dumb `subagents?: number` prop (0/absent
   = no pill; mirrors the `scheduled` boolean contract, ADR-0057 D2) and
   renders a `sub-badge` pill sibling of `.sch-badge`, reusing its CSS block
   pattern (own class, same values).
2. The caller derives the count where it already derives `scheduled` — count
   spine rows whose `parentSessionId === row.sessionId` (the list already keeps
   families whole; `RowSessionItem.svelte` passes it through next to
   `scheduled`; the panel-rows path gets the same derivation so open panels
   read identically).
3. Locale: the count is a bare number — no new paraglide message needed (the
   SCH pill has `m.scheduledBadge()`; here the glyph carries the meaning).

## What's left to the builder

- Exact count derivation point (row-query vs. panel-rows) — builder's call,
  keep it caller-side and dumb.
- Playwright regression: a spine with a 5-sub-agent parent shows the pill with
  `5`; toggling the filter off/on does not change the pill; a childless row
  shows none (testid `sidebar-sub-badge`).

## Verification surface

The live sidebar on the operator's glass/browser surface, per the Live-Verify
Gate (H1: the parent row shows the count pill; F1: the `{SCH}` pill still
renders on scheduled rows in the same list).

---
name: dsi-kb-scenario
description: Use when asked to write a "feature, contract & scenario" KB note for a DSI surface under dev/kb/**, when asked how to derive such a note from the patterns shown in code and dev-docs, or when unsure where a KB note belongs or what its parts must contain
---

# DSI KB Scenario — writing a feature / contract / scenario note

## Overview

A "feature, contract & scenario" KB note is a THREE-PART document about ONE
surface: what the operator meets (feature), the rules every caller can rely
on (contract), and a numbered walkthrough a newcomer can replay (scenario).
It is derived from PATTERNS FOUND IN CODE AND DEV-DOCS — never from memory —
and every claim carries a source read this session (file:line, route, test,
or a dated ADR/KB).

## The parts, in order

1. **Title + header block** — `# KB — <Surface>: <one-line claim>`; Date,
   Kind: KB, Companions (linked KBs/ADRs). Name the exemplar note you
   patterned the shape on.
2. **Feature** — where the operator MEETS the surface (floor column, sidebar
   row, wire endpoint, command), stated plainly. Multiple meeting places are
   listed as numbered sub-entries.
3. **Contract** — the invariant bullets: lifecycle rules, who writes/reads
   each fact, kill/restore authority, honesty rules. A contract bullet
   without a source is unfinished.
4. **Scenario** — a numbered replay of ONE real session end-to-end (spawn →
   surface → fold/close → recover), each step naming the VISIBLE artifact.
   Include the honest failure branches (prune, reaper, dead state). Replay
   the scenario LIVE before writing it — a step you have not run is a claim.
5. **State table** — fact / authority home / who writes / who reads.
6. **Open question** — a KB ends by naming what is still open.

## Save path

`dev/kb/<subject>/<subject>-<kind>.md` — the SUBJECT is the surface
(e.g. `dev/kb/browser-manager/browser-manager-feature-contract-scenario.md`),
never a date. Cross-link companion ADRs and sibling KBs both ways; the ADR
records the decision, the KB records the mechanics.

## Sourcing method

1. Grep the surface's server module + routes (`src/lib/server/**`,
   `src/routes/api/**`) for lifecycle facts; the client components for the
   operator-visible facts.
2. Pull the decision vocabulary from the companion ADRs — cite decisions by
   number (D2, D8), never re-derive them.
3. Run the scenario live before writing it (headed browser, curl of the wire
   endpoints, whatever the surface's driver is).

## Surface-specific "behind the scene" sections

A behind-the-scene walkthrough (how the surface initializes, what it links
to, how its persistent state is generated/used, whether foreign state can be
reused) belongs IN THE KB NOTE of that surface — as its own section inside
the scenario or right after the contract — NOT in this skill. This skill is
the reusable pattern; each surface's mechanics live on that surface's note,
sourced file:line.

## Common mistakes

- Documenting from memory of a previous session — re-read the file.
- Putting the note under a date folder — KBs live under the subject.
- Writing a scenario step you never replayed on the live app.
- Baking one surface's mechanics into the skill — the skill is the pattern,
  the KB note is the mechanics.

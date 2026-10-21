---
name: dsi-pattern-thin
description: Use when refactoring Svelte markup that duplicates component wiring across branches (twin prop-ladders), or when a route/panel acts as a state machine in its template — detects the duplication pattern, runs the ADR→spec→task ASDLC, and extracts one owning host component or service per pattern, whole-src. Pattern-driven counterpart to dsi-thin (which is size-driven).
---

# dsi-pattern-thin — The Pattern Dies, One Host Is Born

Pattern-driven Svelte thinning. Where `dsi-thin` takes a **SLOC report** and
batches files by size, this skill takes a **duplication pattern** and extracts
one owner per pattern family. They compose: `dsi-sloc` finds the fat files,
this skill names the *why* inside them.

## When to use

- The same child component is invoked twice or more in one template with mostly identical props.
- A template branch chain reads service state (`if service.x … else if service.y …`) to pick markup — a state machine written in markup.
- A route or panel file keeps growing despite services holding the state (the *markup machine* residue ADR-0019 left behind).

## The pattern catalog (detect → extract)

The catalog stays in this file — it is the detection core and must be in
context on every run. A pattern graduates to its own
`references/pattern-*.md` only when its detail exceeds ~50 lines or the
catalog passes ~6 entries.

1. **Twin prop-ladder.** Detect: two invocations of one component, ≥60%
   prop-name overlap, differences confined to one concern (feed/data source).
   Extract: one **host component** between caller and child; shared props
   computed once; differences folded into ONE object prop (the "feed object"
   rule). Rejected alternatives to record in the ADR: props-spread,
   lint-synced lists.
2. **Markup state machine.** Detect: `{#if}` chains keyed on service
   dictionaries/Sets. Extract: the ladder decision into a pure
   `resolve*State()` function (unit-testable) + a host that renders per state.
   Stubs and error cards move with it.
3. **Helper called N times per render.** Detect: the same `*For(id)` helper
   invoked in multiple branches. Extract: compute once in the host.
4. **Page-as-registry.** Detect: a route owning mutators/arrays other
   components need (regression of ADR-0019). Extract: floor-registry service —
   see ADR-0019; this skill only re-detects the drift.
5. **Stair-stepped block / orphan close.** Detect: ONE block whose open tag,
   children, and close tag sit at ≥2 distinct depths (e.g. `{#each}` at 2
   tabs, children at 4, `{/each}` at 3), or a close tag shallower than its
   own open (`</PanelsZoom>` at 1 tab vs `<PanelsZoom>` at 2). Cause: a
   wrapper added/removed — or a block re-homed — without re-indenting the
   body. **svelte-autofixer does NOT flag whitespace**, so this survives
   every existing gate; it is found by reading, not by tooling. Fix:
   mechanical re-indent — children at open+1, close at open — as a
   whitespace-only diff (proof: `git diff --stat` line count equals the
   re-indented line count, zero content bytes changed), then autofixer
   findings + unit tests byte-identical to baseline as the
   no-behavior-change evidence. Case study: `+page.svelte` L480–498
   (2026-10-21, `{#each panels}`/`PanelColumn`/`{/each}` at three depths
   plus the `</PanelsZoom>` orphan close, residue of earlier re-homes).

Worked case study (hard-coded evidence, grows with each run):
`references/case-study-2026-10-21-conversation-feed-host.md` — the
`+page.svelte` conversation ladder, ADR-0032, measured overlap, and the
before/after. Read it before your first extraction; append the next case study
file after each completed run.

## Pipeline (ASDLC, per pattern instance)

1. **Measure** — script the overlap: for each twin pair, diff prop-name sets;
   print the shared set and the drift set. Drift found = evidence for the
   ADR's fact section.
2. **Decide** — invoke `dsi-adr`: one ADR per pattern family (not per file),
   D1–Dn with the host's home domain, the explicit-props rule, and the
   single-object rule; name the rejected spread/lint alternatives.
3. **Spec** — invoke `dsi-spec` with the Module Map updated (host lives in
   the child's own domain — never a new cross-domain import, ADR-0018 D1).
4. **Execute** — invoke `dsi-task`: host lands un-consumed first (wave 1 +
   unit tests, fake-based), caller swaps second (wave 2 + Playwright gate),
   paperwork third (wave 3).
5. **Gates** — `svelte-autofixer` on every written `.svelte`; unit tests
   enumerate every prop reaching the child (the passthrough test kills
   re-drift); visual parity pinned by existing Playwright specs.

## Hard rules

- The host NEVER imports the caller's registry/mutator singleton — wiring
  crosses as props (testability).
- The child component is untouched; the swap is additive (wave 1) then
  subtractive (wave 2).
- One pattern family, one ADR, one branch; waves ship standalone value.
- No pattern, no refactor: if the overlap measurement shows <60% shared props
  and differences span concerns, the block is honest branching — leave it and
  say so in the report.

## Whole-src runbook

```bash
# 1. candidate scan (twin invocation detector, rough)
grep -rn '<ConversationPanel' src --include='*.svelte'   # repeat per suspect child
# 2. overlap evidence per pair (the measure step prints shared/drift prop sets)
# 3. rank by (lines duplicated x drift count); top of the list is the first ADR
```

Done instances in today's DSI: the `+page.svelte` conversation ladder
(ADR-0032) and the transcript's six `InlineToolCalls` twins (ADR-0033,
`InlineToolRunRow`) — both 2026-10-21. Next candidate: the `ToolCallChip`
x5 ladder in `InlineToolCalls.svelte` (80% overlap, drift `{status, ok}`).
Measured honest branching — no pattern, no refactor: `DsiEntry` x6 and
`ChipPopup` x4 (0% shared), `PromptBubble` x2 (60%, drift spans concerns).

## Definition of done (per instance)

Twin invocations gone (grep proves one call site); ladder states unit-tested
without a page render; Playwright specs green; ADR amended to Implemented;
overlap measurement re-run shows zero twins for the family; a case-study
reference file exists for the run.

## Install locations

- Repo (versioned source of truth): `skills/dsi-pattern-thin/SKILL.md` + `references/`
- Mirror (slash-menu visibility on every host, RCA 2026-09-03): `~/.agents/skills/dsi-pattern-thin/` — re-copy after every repo-side edit.

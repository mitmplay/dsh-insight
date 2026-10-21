# Case Study — 2026-10-21 — The Conversation Feed Host (pattern 1: twin prop-ladder)

The worked instance this skill was born from. Read before your first
extraction; every completed run appends one file like this.

## The target

`src/routes/+page.svelte` L435–506 (inside the `panelBody` snippet, L292),
on a 650-line route that ADR-0019 had already thinned from 2,109 lines.

## What the pattern looked like (raw numbers)

- `{#key p.sessionId}` wrapping a four-branch chain:
  - `pageFeeds.deadSessions[p.sessionId]` → error card (L435–445)
  - `pageFeeds.coldCache[p.sessionId]` → `ConversationPanel` (~30 props, L448–478)
  - `pageFeeds.coldInFlight.has(...)` → loading stub (L479–480)
  - else → `ConversationPanel` (~24 props, L482–505)
- **~20 props byte-identical** across the two invocations; differences confined
  to feed sourcing (cold spreads 10 cache fields; live hardcodes
  `lastSeq={-1} running={false}` + `onNeedCold`).
- **Drift was live, not latent:** `deliverables`, `knobEvents`,
  `pendingAnswers`, `settledAnswers`, `imageLimits`, `hasMore` existed ONLY
  on the cold branch — a behavioral asymmetry born of copy-paste.
- 7 `floor-reads` helpers (`panelTitleFor`, `panelWorkspaceFor`, `agentFor`,
  `agentLabelFor`, `panelParentFor`, `a2aRowsFor`, lineage lookups) called
  twice per render.

## What was decided (ADR-0032, 2026-10-21)

- **D1** one `ConversationFeedHost.svelte` owns the ladder (conversation
  domain). REJECTED: props-spread (halves lines, none of the risk); folding the
  ladder into `ConversationPanel` (couples presentation to a page service).
- **D2** wiring crosses as explicit props, never a grabbed `floorApi`.
  REJECTED: host imports the registry (untestable, re-couples the floor).
- **D3** feed differences become ONE `feed` object. REJECTED: lint-synced
  twin lists; a `feed?` prop on the panel itself.
- **D4** error card + loading stub move into the host. REJECTED: stubs stay in
  the page (splits one visual contract across two files).

## The shape of the fix

Route block: ~72 lines → ~10 (one host tag). Shared props computed once in the
host; the four states render error card / panel(cached feed) / stub /
panel(default feed + onNeedCold). `{#key}` moved inside the host;
`ConversationPanel.svelte`, `page-feeds.svelte`, `floor-registry.svelte`
untouched; no new cross-domain import.

## Gates that pinned it

- Unit: `tests/unit/components/conversation/conversation-feed.test.ts`
  (derivation + dead-wins-first precedence) and
  `.../conversation-feed-host.test.ts` (one test per state + prop-passthrough).
- Playwright conversation/floor specs green after the swap (wave 2 gate).
- `svelte-autofixer` clean on both written `.svelte` files.
- Spec set: `dev/specs/2026-10/2026-10-21 - Conversation Feed Host/` (PRD,
  Tasks.md/.json, karpathy context); decision: ADR-0032.

## Lessons

1. The drift set (props on one twin only) is the strongest ADR evidence —
   measure it before writing a word.
2. Dead-wins-first precedence (L435 branch order) is easy to lose when
   re-homing; write it as an explicit `resolveLadderState()` unit test.
3. The host must stay wiring-only; fake-based unit tests are the guardrail.

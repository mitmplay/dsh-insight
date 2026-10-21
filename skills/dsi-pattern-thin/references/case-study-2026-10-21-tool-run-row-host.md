# Case Study — 2026-10-21 — The Tool Run Row Host (pattern 1: twin prop-ladder, second instance)

The ADR-0032 feed-ladder host worked; this is the same pattern one level
down, inside the turn body. Read with the Conversation Feed Host study.

## The target

`src/lib/components/conversation/panel/ConversationScrollArea.svelte`,
six `<InlineToolCalls>` invocations (L371–486 pre-swap): the two
closed-fold escape strips, the open-fold injection cluster, the folded
work runs, the trailing runs, the flat path.

## What the pattern looked like (raw numbers)

- **10 shared prop names across all six sites** (entries, runKey,
  openChipId, peekOpen, allEntries, ontoggleChip, ontogglePeek,
  autoThinkId, autoPlanId, onFileOpen). The script measure reported 6 —
  it counts only `=`-written props and misses the Svelte shorthand
  quartet `{openChipId} {autoThinkId} {autoPlanId} {onFileOpen}`;
  reading the sites recovered the true overlap.
- Drift: `peekIcon="context"` on the two injection rows only. Every
  other difference was a VALUE (entries source, runKey string).
- `peekOpen` was always `peekOpenRunKey === runKey` and
  `ontogglePeek` always `() => ontogglepeek(runKey)` at every site —
  the derivation itself was part of the duplication.

## What was decided (ADR-0033, 2026-10-21)

- **D1** one wiring-only host `InlineToolRunRow.svelte` in the child's
  own domain (message/assistant); child untouched. REJECTED:
  props-spread; folding a `session` prop into the child.
- **D2** session wiring crosses as ONE `run` object. REJECTED: eight
  explicit props (same ladder one level up); lint-synced lists.
- **D3** peek pair derived in the host. REJECTED: keeping the
  derivation at six sites.
- **D4** passthrough unit tests over screenshots. REJECTED: Playwright
  alone (one fold state per run).

## The shape of the fix

Six ~12-line invocations → one line each (`run={turnRun} entries=…
runKey=… peekIcon=…`); net −56 lines. The wiring const is `turnRun`
because the fold-replay `{#each fold.folded as run}` loop owns `run`
— name collisions are a real hazard when the host prop is generic.

## Gates that pinned it

- Unit: `tests/unit/components/message/inline-tool-run-row.test.ts` —
  10 tests rendering the REAL child: peek derivation ×3, both callbacks
  through the DOM, openChipId/autoThinkId/allEntries passthrough via
  the child's own seats (reasoning-body, cross-run result pairing),
  peekIcon glyph (wrench vs book-open lucide class).
- Playwright: conversation 23/23, panel-floor 30/30.
- svelte-check caught the `{turnRun}` shorthand passing a wrongly
  NAMED prop (type error, not a lint) — shorthand props at swap sites
  are a live failure mode; the check gate earns its keep.

## Lessons

1. Shorthand-prop overlap is invisible to naive regex measures —
   measure, then VERIFY by reading before writing the ADR facts.
2. Mount the real child and assert through its existing DOM seats;
   a mocked stub must imitate Svelte 5 component internals and fails
   the whole file.
3. A stale `vite preview` on the Playwright port will run your gate
   against an OLD build — kill it before trusting green.

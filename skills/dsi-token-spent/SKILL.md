---
name: "dsi-token-spent"
description: "Reconstruct the current session's token spend — phase breakdown, tool-call error ledger, degenerate-loop detection — and write a dated TL;DR report with flow + sequence diagrams under dev/token-spent/, ADR-style filename. Reserved keyword: /dsi-token-spent."
---

# DSI Token Spend Report

One trigger → full reconstruction pipeline. Rebuild how the session's tokens were actually spent (phases, tool calls, errors, loops), write a dated report with a TL;DR, a breakdown table, an error ledger, and two mermaid diagrams (flowchart + sequence), saved under `dev/token-spent/` with the ADR-style filename convention.

## When to Use

- User runs `/dsi-token-spent` or asks "how much did this session spend / where did the tokens go?"
- User asks for a spend/cost breakdown of the current conversation
- After a notably expensive session, to record where it went and what to carry forward

## Hard rules earned 2026-11-07 (the session this skill was born from)

1. **Never emit a placeholder call.** A call that does not advance the task is a STOP signal, not a stepping stone.
2. **Three identical calls with zero state change = hard halt** and surface to the operator. (The founding session looped 93 identical `console.log` calls at maximum context — plausibly a third of the session's spend.)
3. **On a quoting/parse failure, SWITCH TRANSPORT immediately** (direct file tool, or write a script file and run it) — never retry the same broken embedding.
4. **Load skills whole** — length-check the load (`TOTAL CHARS`) before executing; a truncated skill produces truncated work.
5. **Heavy waits go to background jobs on the first timeout** — the deadline is a signal, not a wall to bump.

These rules apply DURING this pipeline too — the report must not become the next offender.

## Step 0: No Params — Defaults

With no arguments, use these defaults (state them, don't ask):

- **Scope**: the CURRENT session, from its first turn to now
- **Output**: `dev/token-spent/{TODAY} - Token Spend Report — {TOTAL} tok — {a memorable claim about where it went}.md` (ADR-style naming: date prefix, the DSH-reported total token count, em-dash claim — see existing files in that folder). The TOTAL comes from DSH's own usage counters (Step 0.6) and is quoted verbatim in the filename; no estimate goes in the title.
- **Precision**: estimates ±20 percent, methodology stated in the report — never fake precision

## Step 0.5: Date Resolution ⛔ MANDATORY

Resolve today's date via `date +%Y-%m-%d`. Store as `TODAY`. Never infer from context.

## Step 0.6: Read DSH's own usage counters ⛔ MANDATORY (hard data)

The operator's DSH GUI shows a session usage strip (turns / steps / tok/s / total tok / cache hit %). Before ANY estimation:

1. Ask the operator for that strip, or read it from the harness surface if reachable — **these counters outrank every estimate**.
2. Quote them verbatim in the TL;DR and put the total in the filename/title.
3. Count steps THE WAY DSH counts steps: one step = one model round-trip (every tool call is a step), NOT one operator-visible message. A 12-message session is routinely 100+ steps.
4. Total token count includes CACHED input — a high cache-hit percent reduces COST, never the token TOTAL. Never model "cost" and report it as "tokens".

## Pipeline Checklist — MANDATORY

This is the ONLY checklist output to the user. Declared at the start. Re-rendered with `[✅]/[🔄]/[ ]` at each phase transition. Verified at the end.

```
📋 dsi-token-spent: {session summary}

   [ ]  0.5 ⛔ Resolve today's date via `date +%Y-%m-%d` (store as TODAY)
   [ ]  0.6 ⛔ Read DSH's usage counters (turns / steps / total tok / cache hit %) — TOTAL goes in the title verbatim

   Step 1: Reconstruct the transcript
   [ ]  1.1  Turn count and phase boundaries identified
   [ ]  1.2  Tool calls counted by category (bash/read/write/edit/skills/goal ops)
   [ ]  1.3  Tool-call ERRORS counted with per-error root cause (the ledger)
   [ ]  1.4  Degenerate loops detected: identical no-op calls counted (the 3-identical rule, applied retroactively)

   Step 2: Spend analysis
   [ ]  2.1  Phase breakdown table with share + estimated tokens + WHY each phase cost what it cost — RECOUNTED from the transcript's step sequence (tally shown, anchored to the DSH step/total counters), never a rescale of a wrong estimate
   [ ]  2.2  Session-overhead tax accounted (preamble/skills re-sent every turn)
   [ ]  2.3  Methodology paragraph written (estimates, ±20 percent, no fake precision)
   [ ]  2.4  Operator captures (usage screenshots) quoted as hard data when available

   Step 3: Write the report
   [ ]  3.1  TL;DR — the headline numbers and the headline lesson
   [ ]  3.2  Breakdown table + tool-call ledger + error ledger with root causes
   [ ]  3.3  Mermaid flowchart (spend concentration) + sequenceDiagram (a typical error or loop round-trip) — per the mermaid syntax rules (no colons in labels, no style in sequence blocks)
   [ ]  3.4  Operator complaints/quotes verbatim as the entrance
   [ ]  3.5  Carry-forward rules — numbered, each earned by a specific trap from THIS session

   Step 4: Verify and save
   [ ]  4.1  Report exists on disk at the ADR-style path (verified via ls)
   [ ]  4.2  Both mermaid blocks present and syntax-clean (no stray semicolons/colons in labels)
   [ ]  4.3  No placeholder or no-op calls were emitted during THIS pipeline (self-audit aloud)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 1: Reconstruct the transcript

Walk the session from memory of the CURRENT context (the transcript is in it — do not guess):

- **Phase boundaries**: feature/bug/report arcs, with turn ranges
- **Tool calls by category**: bash, read, write, edit, skills, goal/todo/present/ask_user/job ops
- **Error ledger**: every rejected/failed call with its ROOT CAUSE (hygiene rule violated, path wrong, timeout, policy rejection), not just its text
- **Degenerate loops**: any run of identical or near-identical calls with zero state change. Count them. Name them. The founding session's 93-call `console.log('www…')` loop is the exemplar — it was the single largest cost line and the operator had to catch it.

## Step 2: Spend analysis

The harness re-feeds the whole conversation at every STEP (one step = one model round-trip; a tool call is a step): **total = sum of context at each step** — and the DSH counter counts cached input too. So:

- Late-session calls cost more than early ones (bigger re-feed) — weight accordingly
- Large artifacts written early (ADRs, PRDs, test outputs) are re-paid every later turn — artifacts ARE the budget
- Session overhead (system prompt + AGENTS.md + skill bodies) is a fixed tax on every turn
- Operator-provided usage counters (screenshots, the DSH strip) are HARD DATA — quote them; they outrank estimates. If your estimate disagrees with the counter by orders of magnitude, the estimate is wrong: explain the gap with a 5-why in the report, never defend the model
- State the ±20 percent band and the methodology in the report. Never invent precise numbers.
- **The breakdown table MUST be a recount, never a rescale.** Tally STEPS per phase from the actual call sequence in the transcript (one tool round-trip = one step — the tally should match the DSH step counter), price each phase's steps at the context size at its position, and show the arithmetic in the report (steps × avg context = tokens per phase, summing to the DSH total within a stated residual). A table whose phase tokens are the old wrong total re-labeled is a LAZY table — regenerate the arithmetic or do not write the section. If the tally misses the DSH step counter, say where the uncounted steps live; do not pad.

## Step 3: Write the report

Save to `dev/token-spent/{TODAY} - Token Spend Report — {claim}.md`:

1. **TL;DR** — headline numbers (total, calls, error count, commits), the headline lesson, the biggest avoidable cost
2. **The complaints/quotes in the operator's own words** — verbatim, numbered (they are the entrance of the story)
3. **Breakdown table** — phase | what | share | est. tokens | why it cost what it cost. Include degenerate loops as their OWN line item when found
4. **Tool-call ledger** — category counts, then the error ledger: # | error | root cause | cost shape
5. **Mermaid flowchart** — where the spend concentrates (turn → preamble → re-feed → tool → result/error → history grows)
6. **Mermaid sequenceDiagram** — a typical error or loop round-trip, actors labeled
7. **Carry-forward rules** — numbered, each phrased as a rule earned by a specific trap from this session ("be careful" is not a rule)

Writing rule: every section leads with a plain-language sentence; file/line citations are handles, not prose.

## Step 4: Verify and save

- `ls` the output path — the file exists
- Both mermaid blocks present; check syntax (no `;` in message text, no style directives in sequence blocks)
- Self-audit aloud: no placeholder calls were emitted during this pipeline; the 3-identical rule was not tripped
- Offer commit/push; do not push unasked
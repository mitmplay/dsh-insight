# AGENTS.md

DeepSeek Insight (DSI) is the insight layer and conversation surface for
DeepSeek Harness: a SvelteKit app that reads the harness's records (docs,
notes, session logs) and speaks its native RPC. This file seeds DSI's agent
instructions; add sections as conventions harden, keep each rule
self-contained, and link depth out to skills rather than growing this file
into a manual.


## Task flow (ASDLC) — non-trivial tasks

Every non-trivial task goes through the battle-tested flow, in order:
`dsi-adr` (decision) → `dsi-spec` (spec + tasks) → `dsi-task` (execution).
Anchor the whole task in DSH's own memory tools so the model cannot drift
or forget where it is:

- **At kickoff**, create a `goal` whose objective restates the task's
  outcome, and declare the `todo` checklist `adr → spec → task → verify →
  done`. This is the visible checklist — harness-tracked, not prose.
- **At every step**, keep the todos 1:1 with the ASDLC stage boundaries:
  mark the current stage `in_progress`, the finished one `completed`.
- **On resume after a pause or fork**, re-arm with `update_goal resume`
  and re-read the goal + todos before continuing — never pick up mid-flow
  from memory.
- **Completion**: mark the goal `complete` only after the verification
  gate below passes; a stalled task is `blocked` only under DSH's rule
  (same condition, 3+ consecutive goal rounds).

Never report "working" from claims or unit tests alone — verify on the
surface the operator will touch before marking any step or the goal done
(lesson 2026-10-11: three "PASS" rounds against the wrong target while the
real click stayed broken until the operator tested it).

## File links in chat (workspace-root-relative)

File links written in chat responses MUST be relative to the session
workspace root, not to the assistant's cwd. The assistant's cwd is often a
repo SUBFOLDER of the workspace (e.g. cwd `deepseek-insight/` inside
workspace `agentic-ai/`) — a bare `dev/…` link then resolves to
`agentic-ai/dev/…`, which does not exist, and the click fails.

- Prefix the link with the path from the workspace root to your cwd
  (e.g. write `deepseek-insight/dev/…`, never bare `dev/…`).
- Paths with spaces use the CommonMark angle form:
  `[label](<deepseek-insight/dev/file with spaces.md>)`.
- Never `../`-climb outside the workspace root — the host refuses it.

## ADR pattern (dev/architectural-decission/)

Match depth to the decision space, never to the most recent ADR — a thin
recent ADR is not authority; the exemplars are (The Lineage Pin 2026-08-27,
The Panel Floor 2026-08-24, The Prompt Macro 2026-08-29). Hard requirements
for every ADR:

- Numbered decisions (`D1…Dn`), each naming its rejected alternative and why
  the rejection lost — a decision with no named alternative is unfinished.
- Every stated fact traceable to a source the author inspected (file + line,
  wire capture, test, dated ADR).
- A diagram wherever state changes hands or authority moves (sequence,
  flowchart, state homes, control matrix — as the subject needs).
- TL;DR and layman glossary, so a newcomer follows without the codebase.
- Consequences split gains / accepted give-ups / what does NOT change.
- File map naming the implementation footprint and the tests that pin it.
- A KB note (dev/kb/) documents how a surface works; an ADR records what was
  decided and what it cost. A KB ends by naming its open question; the ADR
  that answers it cites the KB as companion.

**Invoke the `dsi-adr` skill before drafting, reviewing, or marking done any
ADR** — it carries the full skeleton, the depth test, and the self-audit.

## Driving the live terminal (Terminal Desk)

To type into the operator's terminal tab (T1, T2, …) — install, build, run
anything on the floor's shell — invoke the `dsi-drive-terminal` skill first;
it carries the wire procedure, the typing pace, and the escape traps
(interactive prompts that silently eat keystrokes). Two rules here because
they bite hardest:

- The write token is a baton with one holder — a `403 FOREIGN_SESSION` write
  means heal (reattach → retry the same keystroke), never retry blind; the
  operator's tab heals identically (ADR The Surviving Shell, amendments
  2026-11-04).
- The desk is the UX: run commands unpiped so the operator watches progress
  live; the mechanics and contract live in
  `dev/feature-contract-scenario/terminal-driving.md`.

## run_code tool-call hygiene

One malformed `run_code` program fails whole and costs every sub-call
batched with it. Before submitting a program, check every sub-call against
these rules (observed failure patterns, session a5d4bf28 2026-09-06):

- Every `tools.bash()` / `tools.read()` / `tools.edit()` sub-call inside a
  `run_code` program carries its own `description`; one missing field rejects
  the whole program.
- Do not embed shell or Python scripts as heredocs or `node -e '...'` inside
  template literals — nested quoting produces parse errors (`Expected ',',
  got 'ident'`). Write the script to a file with `tools.write`, then run it
  with a one-line bash command.
- After any bulk sed/python sweep, cached `old_string` targets are stale;
  re-read (or `grep -n`) the exact lines immediately before each
  `tools.edit()`.
- Bash results are objects shaped `{ stdout: { text }, ... }`, not strings;
  read `r.stdout.text`, never call `r.stdout.slice()`.

## Svelte MCP (svelte-ai)

The project registers the Svelte MCP server (`.mcp.json`, local stdio
`npx -y @sveltejs/mcp`). When writing or editing any `.svelte` /
`.svelte.ts` / `.svelte.js` file:

1. `list-sections` first, then `get-documentation` for only the sections
   the task needs (it is token-expensive).
2. Every written component/module MUST pass `svelte-autofixer` in a
   fix-loop until it returns no issues or suggestions. Via CLI:
   `npx -y @sveltejs/mcp svelte-autofixer <file>` (pass file paths, never
   inline source pasted into the shell — dollar runes in template literals
   get shell-expanded).
3. `playground-link` only on user request and only when no project files
   were written.
4. Load the `svelte-ai` skill for setup details and the
   `svelte-core-bestpractices` rules before writing Svelte 5 code.

The skill's repo-local copy (`.agents/skills/dsi-adr/`) is the versioned
source of truth; a mirror at `~/.agents/skills/dsi-adr/` makes it visible to
every harness host's `skills/list` (the slash menu) regardless of host cwd.
After editing the repo copy, re-copy it to the mirror
(RCA 2026-09-03 — The Skill the Slash Menu Never Saw).

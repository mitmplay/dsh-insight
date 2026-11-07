---
name: "dsi-task"
description: "Execute implementation tasks from a Karpathy context file and tasks document. Applies Visible Checklist Pattern, Playwright regression gates, and sub-agent comp"
---

# Task Executor

Execute implementation tasks defined in a Karpathy context + tasks document.

## SYSTEM PROTOCOL: STRUCTURED IMPLEMENTATION & LAYERING

You must treat code generation as a spatial and structural architecture task, not just functional text completion. Your code layout must mirror the logical boundaries defined in the system design/sequence diagrams:

### 1. DIRECTORY SANCTITY & ENCAPSULATION
- Every domain or feature subset must reside within its own completely isolated directory.
- Cross-module code bleeding is strictly prohibited. All module-specific state and logic must remain local to that module's folder.
- Before creating any file, verify its target directory exists and aligns with the Module Map from the PRD.

### 2. DECOUPLED COMMUNICATION MECHANISM
- You are forbidden from hardcoding direct dependencies or side-effects between feature modules.
- Execution orchestration must follow the project's communication pattern (event bus, pub/sub, middleware chain, dependency injection, message passing, etc.). Modules requiring observation or intervention must use the defined communication layer, not direct imports.
- Document how each module connects to the system: what it receives, what it produces, and through which channel.

### 3. ARCHITECTURAL DRY PRINCIPLE
- Before implementing any utility logic (e.g., file checks, payload validation, format verifiers), check the global Shared Layer.
- You must import shared utilities from the central shared directory rather than re-creating localized or redundant helper functions inside individual modules.

### Enforcement Rules
- Before writing code for any wave, verify the PRD's Module Map against the physical filesystem (`find | sort`)
- Every new file must be created in its designated module directory — never in the root or another module's folder
- Shared utilities must be placed in the designated shared directory and imported via relative paths — never duplicated
- After each wave, run a "cross-module bleed check": verify no module imports from another module's directory
- Module wiring (how modules connect to each other) must happen at the defined integration point — not scattered across module internals

---

## When to Use

- User says `/execute-tasks {project-path}` — execute with project root (auto-discovers docs)
- User says "execute the WebSocket tasks" or "implement the tasks from the Karpathy-context"
- User provides a `{*} karpathy-context.md` file and asks to start implementation

### Step 0: No Params — Usage Guide

When the user sends `/execute-tasks` with no arguments:

1. Ask for the two required paths:
   - **Karpathy context** — path to the karpathy-context file (auto-discovered from project path)
   - **Tasks document** — path to the tasks document (local file under project dev/)
2. Reply with a usage guide — NOT execution

**Response format:**

```
📋 **Task Executor** — No paths specified. I need two things:

1. **Project path** — the codebase root (where dev/specs/ lives)
   Example: `~/openclaw-insight`

2. **Tasks document** — the implementation tasks (auto-resolved from project path)
   Example: `openclaw-insight/dev/specs/WebSocket Real-Time/Tasks.md`

Usage: `/execute-tasks {project-path}`

Or just paste the project path and I'll find the latest tasks document.
```

**Rules:**
- If project path is provided, auto-discover feature folder: `{project-path}/dev/specs/*/`
- If multiple feature folders exist, ask which one to execute
- If a karpathy-context file exists in `{project-path}/dev/specs/{feature}/`, load it automatically
- If no Karpathy context found, ask if the user wants to proceed without it
- If a path doesn't exist, say so and ask for the correct one
- Do NOT proceed to Step 1 (Load Context) until paths are confirmed

## Core Principle: Context Loading, Not Memorization

This skill is intentionally SHORT. It references external documents instead of copying rules inline. This prevents attention degradation — the model loads only what it needs, when it needs it.
<!-- RCA: AI-Research/YT-Research/2026-06-22 - Why Long Instructions Make AI Dumber - Attention Degradation Science.md -->

---

## Step 1: Load Context — MANDATORY

Before any execution, load exactly these files:

1. **Karpathy context** — `{project-path}/dev/specs/{feature}/karpathy-context.md` (auto-discovered)
2. **Tasks document** — `{project-path}/dev/specs/{feature}/Tasks.md` (auto-discovered)
3. **Visible Checklist Pattern** — `ai-research/references/visible-checklist-pattern.md` (loaded on demand)
4. **Sub-Agent Completion Rules** — `TOOLS.md` lines 85-115

Read these files at the start. Do NOT carry them from previous conversation context — reload fresh.

> **Handoff-valid (2026-11-07, the 5.7M lesson):** this skill is designed to be loaded by a FRESH
> NORMAL session dispatched by the planner via `schedule_create` `new_once` (AGENTS.md, Split-Session
> Execution — never a subagent: Step 3.10/Step 4 need depth-1 children) — Step 1's
> two disk files ARE the whole contract, no planner context required. If the dispatch prompt names a
> spec folder, resolve karpathy-context + Tasks from it and begin; anything the spec folder fails to
> answer is a STOP-and-report, never a re-discovery.

---

## Step 1.5: Date Resolution ⛔ MANDATORY

Before constructing any date-prefixed filenames during execution, resolve today's date via `date +%Y-%m-%d`. Store as `TODAY`. Do not carry the date from the feature-spec session — it may be a different day.
<!-- RCA: AI-Research/Troubleshooting/2026-06-18 - Wrong Date Prefix in yt-research Filename - RCA.md -->

---

## Step 2: Declare Execution Checklist — MANDATORY

Output a checklist of ALL tasks for the current wave, INCLUDING the behavioral commitments. The user MUST see every rule I'm committing to follow.

```
📋 Execution: {project-name} — {wave name}

   [ ]  1.5 ⛔ Resolve today's date via `date +%Y-%m-%d` (store as TODAY)
   [ ]  2.1  {task 1 name}
   [ ]  2.2  {task 2 name}
   [ ]  2.3  {task 3 name}

   ⛔ Behavioral Commitments (user can verify):
   [ ]  I will NOT execute multiple waves without your confirmation
   [ ]  I will NOT skip Playwright regression gate
   [ ]  I will NOT rely on completion events as ground truth
   [ ]  I will NOT post NO_REPLY after spawning sub-agents
   [ ]  I will NOT self-certify completion without running verify commands
   [ ]  I will NOT reload this skill + all referenced docs simultaneously
   [ ]  I will NOT bleed code across module boundaries
   [ ]  I will NOT duplicate shared utilities in module directories
   [ ]  I will run unit tests after EACH code-writing task (not batched at end)
   [ ]  I will re-output this checklist after each task completes

   ⛔ Sub-Agent Safety (conditional — ⊘ skip if no sub-agents spawned):
   [⊘]  Check ALL children via subagents list — not just one
   [⊘]  Disk files = ground truth, events = convenience
   [⊘]  Post ACK to user before other work

   ⛔ Completion Gate:
   [ ]  All task files exist on disk (verified via find)
   [ ]  Directory structure matches PRD Module Map (verified via find | sort)
   [ ]  No cross-module import violations (verified via grep)
   [ ]  Unit tests pass (npx node --test or npm test) — MANDATORY, not optional
   [ ]  Type-check zero new errors: if `npm run check` exits non-zero from pre-existing errors, grep output for this wave's exact new file paths — 0 hits satisfies the gate ONLY when the error count also matches the wave-start check counts. When the wave adds or changes a field on a shared type (interface/type alias), pre-existing object-literal fixtures typed as that interface break in files outside the wave list: the wave-file grep returns 0 hits while the count rises, so adjudicate every count delta by listing diagnostics per file (`--output machine`); errors naming the changed type are this wave's lockstep obligation — extend the fixture in-wave; prove the rest pre-existing via `git log --oneline -- <file>` (last-touch commit predates the wave) plus empty `git diff --stat HEAD -- <file>`. The same git-log proof settles a hit in a different file sharing a name substring; fall back to `git stash` → re-run check → confirm same hit on clean baseline → `git stash pop` only when history is ambiguous. Never judge by raw error-count deltas against a `git stash -u` baseline: `-u` also stashes new untracked test files, and the fix itself may resolve pre-existing errors — current < baseline is normal and proves nothing. A stash baseline only adjudicates files tracked in both states: plain `git stash` leaves this wave's untracked new files in the worktree, so they compile against the reverted tracked code and the baseline sprouts phantom errors in this wave's own files (e.g. missing-export errors the stash itself created) — classify those baseline hits as stash artifacts and settle them by grepping the intact worktree instead
<!-- RCA: 2026-08-16 openclaw-insight ControlRail Wave 1 — adding required `deleted_at` to the shared Feature interface broke the untouched wave-prompt.test.ts fixture; wave-file grep said 0 hits while 26e→27e. Delta adjudication via machine diagnostics fixed the lockstep fixture in-wave; git-log + empty-diff proved the sibling sessionKey/TaskData errors pre-existing. -->
   [ ]  Playwright regression: zero failures vs baseline — SCOPED: only specs exercising the touched surface (e.g. suggest-strip / prompt-macro / typed-run for composer-parser waves); full suite only when the wave itself adds e2e tests ⊘ (skip if no relevant spec)
   [ ]  User acknowledged completion
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Check off each item as it completes: `[✅]` done, `[🔄]` current, `[ ]` remaining.

### Check-Off Rules

- **After each task completes within a wave**, re-output the full wave checklist with updated statuses
- **At wave completion**, output the final checklist: ALL `[✅]`, any `[❌]` for failures, any `[⊘]` for skipped conditionals
- **Do NOT deliver without showing the final checklist**
<!-- RCA: AI-Research/LLMs Skip Mandatory Steps/001. LLMs Skip Mandatory Steps/002.The Visible checklist Pattern/2026-06-11 - The Visible Checklist Pattern - AI Research v1 - report.md -->

---

## Step 3: Execute Tasks Sequentially

- Execute one task at a time within the current wave
- Do NOT skip tasks or reorder
- After each task: verify deliverables exist on disk (`ls`, `find`)
- **After each code-writing task: run unit tests for the affected module** (`npx node --test dist/{module}/`). Do NOT proceed to the next task if tests fail.
- If a task spawns a sub-agent: follow Step 4 (Sub-Agent Safety)

### Step 3.5: Acceptance Scenarios Are the Contract ⛔

When verification disagrees with user-stated acceptance scenarios:

1. Treat the scenarios as the contract. Fix the implementation to satisfy them — never rewrite, loop, or weaken the test to match observed behavior.
2. Follow the promised verification order: fix → headed run of the user's scenarios verbatim (one user action per assertion) → only then unit tests.
3. When a simulated-DOM unit test (happy-dom/jsdom) fails while the headed real-browser run passes, trust the headed run and fix the harness — poll microtask-driven state with `vi.waitFor` instead of fixed sleeps.
4. This binds user scenarios only — not edge-case assertions you authored from an assumption. When your own new test fails, verify the assumption against documented platform semantics; a false assumption means correct the assertion, not working code (e.g. Node `basename('dev/specs/')` → `'specs'` — trailing slash stripped, so a "basename empty → fallback" branch never fires for it).
   <!-- RCA: 2026-08-16 openclaw-insight wave-prompt — fallback test expected the feature id for a trailing-slash spec path; basename semantics proved the assertion wrong; test corrected, implementation untouched, 17/17 green -->

Criterion: every user scenario is asserted verbatim and passes, with no assertion softened to make a run green.
<!-- RCA: 2026-08-13 openclaw-insight ghost-Backspace — headed test was softened (BS retry loops) to match buggy native-selection deletion; user rejected; keydown-intercept fix + verbatim-scenario headed run passed -->


---

### Step 3.6: Expected-Fail Sanity Proofs ⛔

When a wave plans "old bug-spec must FAIL as proof of fix":

1. Run it; if it unexpectedly PASSES, treat that as evidence the spec discriminates nothing — inspect what its assertions measure before drawing any conclusion.
2. Symptom assertions anchored to the wrong reference (viewport/window instead of the fixed element's own container) pass both pre- and post-fix.
3. Prove the fix with a reference-relative probe: assert the fixed element's rect against its wrapper rect within ±1px, plus a pixel scan of the artifact region; capture the evidence, then delete the probe spec.
4. Scrollable wrapper: compare bottom/right edges against `clientHeight`/`clientWidth` — a rendered scrollbar occupies the bounding-rect edge, so a naive rect comparison reports a false gap (scrollbar px = rect height − clientHeight).

Criterion: fix proven by reference-relative geometry (e.g. gap 301.3px → 0.01px), independent of the old spec's pass/fail; wrapper gaps measured client-relative (scrollbar not counted as gap).
<!-- RCA: 2026-08-16 openclaw-insight zoom-artifact Wave 1 — old visual spec passed pre- AND post-fix because it asserted last-panel edge vs viewport; wrapper-relative probe proved the wrapper fix. Wave 2 — wrapperRect.bottom − childRect.bottom reported a false 15px gap: the h-scrollbar occupied the rect bottom while .columns exactly filled clientHeight -->


---

### Step 3.7: Deletion-Only Tasks — Zero-Reference Verification

When a task deletes a file and its paired verification is "grep returns zero references":

1. Confirm the deletion at three levels: absent from worktree (`ls`), untracked (`git ls-files <path>` empty), recorded in history (`git log --oneline --diff-filter=D -- <path>`).
2. If the deletion already exists in a prior commit, verify and report — do not redo it.
3. Run the prescribed grep over the full worktree, then classify every hit:
   - code/config references (src, tests, configs, scripts) — the only hits that fail the gate
   - spec-folder and ADR docs recording the retirement decision — intentional audit trail, keep
   - gitignored runtime logs — not repo content
4. Keep the audit-trail doc hits: the gate is zero code references, not a literal zero; scrubbing the spec's own record falsifies history.
5. Before concluding, confirm similarly-named sibling files are unrelated, not misnamed leftovers.

Criterion: filtered grep (docs + ignored dirs excluded) returns zero hits, with the hit classification stated in the task summary.
<!-- RCA: 2026-08-16 openclaw-insight zoom-artifact Task 2.2-T — grep for deleted zz-zoom-artifact-headed.spec.ts returned 16 hits: ADR retirement table + spec-folder audit trail + gitignored logs/; zero-code-reference criterion satisfied without touching the retirement record, and zz-backspace-headed.spec.ts confirmed unrelated -->

### Step 3.8: New E2E Specs — Assert the Component's Real DOM Contract

When a wave adds a Playwright spec against existing UI:

1. Read the target component source BEFORE writing selectors. Svelte classnames are hash-suffixed or absent; icon-only badges carry status only in `aria-label`. Select via `role`/`aria-label`/testid found in the source, never guessed classes.
2. On a red run, read `test-results/<spec>/error-context.md` FIRST — its page snapshot shows the actual rendered tree and reveals state such as a collapsed accordion hiding the badges you assert on; expand each nesting level (feature card, then wave toggle) before asserting inside it.
3. When a setup step fails on pointer interception and its UI is already covered by a sibling spec, drive the mocked API directly (`page.evaluate(() => fetch(...))`) — the setup is a means, not the subject.

Criterion: every selector is verified present in component source, and red runs are diagnosed from the error-context snapshot before the assertion is touched.
<!-- RCA: 2026-08-16 openclaw-insight wave-dispatch e2e — three red runs, all test-side: guessed `.task-completed` classes (StatusBadge is icon-only; real contract `[role="status"][aria-label="Completed"]`), register-popover click intercepted by panels-viewport (moved to mocked API; popover covered by orchestration-register.spec.ts), collapsed wave accordion hid task badges (added wave-toggle click). No production change, no softened assertions; 3 consecutive green runs after. -->

### Step 3.9: Tagged Playwright Invocations — Prove Non-Empty Selection

When a gate or spec pins a tag-filtered run (`--grep @tag`):

1. Read the active config for a static `grep:` first — Playwright ANDs config grep with CLI `--grep`, and a static entry cannot be overridden from the CLI. An exclusion grep in config plus a tag grep on CLI silently selects ZERO tests: exit 0, green gate, nothing ran.
2. Before trusting a tagged green run, read the reporter's collected/passed count and confirm it matches the expected suite size. Zero collected = false green.
3. To diagnose emptiness, race an untagged control file against the tagged file under the same invocation: control collects while the tagged file never collects under `--grep`, `--grep-invert`, or path+grep ⇒ the config grep is the blocker.
4. Fix additively: a sibling config that spreads the base config and clears ONLY `grep` (default-suite composition stays byte-identical), then invoke with `--config`. Record the working invocation in the completion notes as a documented deviation from the spec-pinned form.
5. When the fix un-buries suites that have never run, classify every failure stale vs regression before judging the gate: `git log -1 -- <file>` predating the subject plus assertions naming removed UI ⇒ stale; document for owner adjudication and do not rewrite or delete foreign suites in-wave.

Criterion: the tagged invocation reports the expected collected count, and every failure in a newly reachable suite is classified with git-log evidence.
<!-- RCA: 2026-08-17 openclaw-insight Control Room Recovery W5 — the spec-pinned `--grep @orchestration` had selected zero tests ever since the base config gained its exclusion grep; a sibling config (spread base, clear only grep) un-buried the recovery spec (5/5 green) plus a 2026-08-08 suite asserting the removed pre-redesign page — stale, documented, not rewritten. -->


### Step 3.10: Wave Executor — Cost-Driven Sub-Agent Delegation

When a wave's declared tasks imply >= 8 mechanical execution steps (test authoring + reruns, sibling-suite surveys, file migrations, gate runs), delegate the execution loop to ONE sub-agent and keep decisions in the parent. Never delegate acceptance-scenario adjudication (Step 3.1), commits, or operator-gesture tasks (glass live passes).

1. **Wave-pack**: mechanical extraction from Tasks.md + karpathy-context.md, verbatim — the wave header (tasks, touched-file contract, checklist, gate command), Layer-3 constraint/boundary/shared-layer excerpts, compatibility-matrix rows proved by this wave, risk-register rows pinned by this wave's -T tasks, behavioral commitments, TODAY.
2. **Child runs scoped suites freely**; the parent re-runs the completion gate itself before marking the wave done.
3. **Deviation protocol**: the child never silently expands the touched-file contract — out-of-contract need is PROPOSED to the parent (files + why), never executed unasked.
4. **Escalation budget**: > 3 consecutive failing runs with the same root cause -> return `ESCALATED: <finding>` with evidence; never grind.
5. **Parent duties**: adjudicate the structured return (gate output, git status, failure ledger with root causes, escalations), assert the touched-file contract including approved deviations, keep the checklist in the parent transcript. The child holds no commit or next-wave authority.
6. **Rolling pool**: a -T task that is a cluster of >= 3 independent file migrations may run as TWO children, one wave-pack slice per file. Feature-code tasks never parallelize — they share files across waves.

Criterion: delegated wave completes with parent-adjudicated gate output, touched-file contract asserted, and zero unapproved scope expansions.
<!-- RCA: 2026-11-07 deepseek-insight Terminal Stream Hub — Waves 3+4 burned 61 percent of 10.6M tok on 47 percent of steps at 110-150k per-step context; a child runs the same steps at 20-60k. The streamEnded arc (unhandled rejection skipped the unmount cleanup) is the escalation-valve case: the child returns the finding, the parent decides with session memory. Real Wave-3 touched 7 files against a 3-file contract — hence the deviation protocol. -->

### Step 3.11: Churn Discipline ⛔

1. **Contract pins before consumer waves**: when a wave changes a shared contract (wire shapes, URL grammar, store fields), its -T tests pin the NEW contract first; dependent suites migrate only after the pin is green.
2. **Batch-then-run**: author a wave's full test set, then one scoped run — no run-per-test authoring.
3. **Scoped suites per wave**; the full suite only in the final gates wave (Step 5 already scopes this — apply it inside waves too).
4. **Assertions match the implementation as written**: read the diff before finalizing test text; tests drafted from the intended design produce assertion churn.
5. **Failure ledger**: every test-fix step classifies the failure test-side / regression / environment. Two consecutive test-side failures on the same suite -> stop, re-read the implementation, rewrite the test.
6. **Churn budget**: a wave burning > 50 percent of its steps on fix loops triggers a scope-or-contract review — fix the cause, not the symptom.

Criterion: a wave's fix-loop steps stay under half its step count, and every fix-loop step names its failure class.
<!-- RCA: 2026-11-07 deepseek-insight Terminal Stream Hub — 17 of 111 steps were fix loops; 10 were test-side assertions drafted from intended design instead of the written code; batching + scoped suites would have collapsed most. Deferral of tests to feature-end rejected: it moves the same fix steps to maximum context with N-wave attribution bisection. -->

## Step 4: Sub-Agent Safety — When Spawning Children

Only fires when a task requires spawning a sub-agent. If no sub-agents are spawned, mark `[⊘]` in the checklist and skip this step.

```
📋 Sub-Agent Safety

   [ ]  4.1  Spawn sub-agent with explicit model + taskName
   [ ]  4.2  Continue independent work on main session
   [ ]  4.3  On completion: verify output file on disk (find | wc -l)
   [ ]  4.4  Post ACK to user before starting next task
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 4.5: 2-Minute Ledger Gate ⚠️ MANDATORY

If 2 minutes pass after spawning a sub-agent without any completion event or user message, fire `subagents(action="list")` proactively — do not silently wait.
<!-- RCA: AI-Research/Troubleshooting/Agentic Pipeline/2026-06-22 - Missing Sub-Agent Completion Event for Gemini but Not Perplexity - RCA 1.md -->

**The rule:**
1. After spawning, note the spawn timestamp
2. If 2 minutes pass without a completion event: fire `subagents(action="list")` immediately
3. Check ALL expected children — not just one
4. For any child showing "done": verify output file on disk (find | wc -l)
5. For any child still "running" past 5 minutes: flag as potentially stuck

---

## Step 5: Wave Completion Gate — MANDATORY

Before declaring a wave complete, output the final checklist with ALL items checked.

If any `[ ]` remains: fix it, do NOT proceed to next wave.

If Playwright tests are part of the wave: run `npx playwright test --reporter=list` and show results. Otherwise run only the existing specs that exercise the touched surface (adjudicate every failure against a stash baseline: fails-without-the-diff = pre-existing, document, do not rewrite) — a wave that changes no DOM contract never owes the full default suite. RCA 2026-10-05 deepseek-insight Line Trigger W1: a parser-pure wave ran the full suite; minutes of port-orphan flakiness surfaced zero feature regressions while the scoped specs were green in seconds.
<!-- RCA: AI-Research/Troubleshooting/2026-06-11 - ADDITIONAL_PAGES Three Generations Same Bug - RCA.md -->

---

## Step 6: Save Completion Artifacts

Save completion notes to the same project docs folder. Use the resolved `TODAY` date from Step 1.5.

Path: `{project-path}/dev/specs/{feature}/{TODAY} - {Wave Name} - Completion Notes.md`

Include: tasks completed, files modified, test results, blockers encountered.

---

## Step 7: Ask Before Next Wave

After completing a wave, ask the user before proceeding to the next wave.

"✅ {Wave N} complete. Ready to start {Wave N+1}? Tasks: {brief list}"

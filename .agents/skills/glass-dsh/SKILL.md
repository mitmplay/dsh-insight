---
name: glass-dsh
description: Use when a newly created DSH web-UI plugin (plugin_manager returned application: applied) must be verified live on the DSH page of the operator's glass browser — probe, real gestures, persistence and restore gates per ADR-0045. NOT for DSI's own workspace surface (that is glass-dsi) or arbitrary foreign URLs (that is glass-url). Reserved keyword /glass-dsh.
---

# glass-dsh — verify a new DSH web-UI plugin on the operator's glass, creator mode

Use when you just created and installed a **DSH web-UI plugin** (`plugin_manager`
returned `application: applied`) and must prove it live on the glass browser —
the surface at the DSH GUI (`http://127.0.0.1:3080/` by default). This skill owns
the full creator loop's verification half: the plugin CRAFT itself (manifest,
locale, icon, slot choice) belongs to the harness's `cordis-plugin-development`
skill — defer to it first, then run THIS skill.

**Dispatch rule (ADR-0045 Amendment 6, the three hands):**
- Verifying DSI's own workspace surface → `glass-dsi` (its driver DIES without a
  DSI tab; it cannot verify DSH work — observed live 2026-11-09).
- Driving an arbitrary foreign URL → `glass-url` (opens a NEW tab; never touches
  the DSI tab).
- Verifying a newly created **DSH plugin** on the DSH page → **this skill**.

## The law (every gate cites ADR-0045)

1. **The registry is the only way in.** Never launch your own browser; never
   POST your own glass session (orphans can never be adopted — the operator must
   click the Browser chip). ADR-0030.
2. **The glass is claimed by identity, never by index.** `_connect.mjs`
   resolves `--owner-session` flag > `GLASS_OWNER_SESSION` > `DSH_SESSION_ID`;
   multiple glasses with no match = loud refusal. D7.
3. **The DSH tab is picked by ORIGIN compare, never a port substring.** D13.
4. **Console-error baseline (Gate 0) before any gesture.** A
   `slot entry crashed in '<slot>'` naming your plugin is an automatic FAIL with
   the stack in the report — element presence alone verifies nothing (observed
   live: the only signal of a dead plugin was the console crash). D14.
5. **Real gestures only; every read gates on a control.** `page.mouse` /
   `page.keyboard` with stepped moves; synthetic `dispatchEvent` is not
   verification. Assert the gesture moved what it should before reading
   counters. D15. Failure branches live in §gates below.
6. **A refusal is an answer; stop-loss.** A failing gate ENDS the run with a
   report — no improvised fixes beyond the plugin under test. D11.
7. **Restore user state.** Clear and label anything you seeded. Gate 5.

## DSH base resolution (probe then env; D13)

Order: explicit argument > environment > default.

1. `--dsh-url <url>` or `--dsh-port <n>` argument (highest).
2. `DSH_PORT` env — note: when the floor was booted with the CLI `--port` flag
   it wins over the env at boot time, so if the operator booted with `--port`
   but exported no `DSH_PORT`, ONLY the explicit argument form can find the
   tab; state which source resolved the base in the report.
3. Default `http://127.0.0.1:3080/`.

The floor registry (glass sessions) is resolved separately: `DSI_UI` env when
set, else probe `5175` then `5174` (`/api/browser`). A floor stamps its own
addresses at boot — agents in a floor's conversations drive that floor's glass.

## Environment contract (D6)

- Run `node skills/glass-dsh/scripts/*.mjs` from the **DSI repo root** so
  `playwright-core` resolves; plain node ESM, no build step.
- Every verb prints ONE JSON verdict on stdout and exits 0/1; failures print
  `{"error": ...}` via `die()` — a refusal is an answer, quote it.
- No state files between runs: every run re-derives session and tab from the
  registry and the resolved origin.

## The loop (creator mode)

1. **Install** — via the harness `plugin_manager` (`install_bundle`; replacing
   an installed package = `remove_bundle` then `install_bundle` again —
   observed 2026-11-09). This skill starts when `application: applied`.
2. **Probe (Gates 0–2)** —
   `node skills/glass-dsh/scripts/probe-dsh.mjs --expect '<selector>' --store '<localStorageKey>'`
   → reloads the DSH tab, arms the console listener, emits
   `{launcherProbe, consoleErrors, crashedSlots, moduleLoader}`.
3. **Gestures (Gates 3–4)** — one verb per process, composition in your hands:
   `glass-dsh.mjs eval --b64` for reads, `gesture.mjs click|type|drag|control|persist`
   for real input. Each verb prints `{before, after, moved}` — quote the pair.
4. **Restore (Gate 5)** — clear seeded state via the page's own store, reload,
   re-probe: launcher present, console clean, store empty.
5. **Report** — table of before/after numbers, the gesture that produced them,
   gates passed/failed, what was seeded and cleared.

## Gates (machine-checkable)

| Gate | Asserts | Verb |
|---|---|---|
| 0 | glass session exists, owned by you | `probe-dsh.mjs` (dies loudly otherwise) |
| 1 | DSH tab found by origin | `glass-dsh.mjs pages` (origin classification) |
| 2 | console baseline clean of the plugin's slot crash | `probe-dsh.mjs` (`crashedSlots`) |
| 3 | real gesture moved its control | `gesture.mjs` (`moved: true` + control expr) |
| 4 | persistence via the plugin's own store | `gesture.mjs persist` before/after reload |
| 5 | state restored | `probe-dsh.mjs` re-run after cleanup |

## Failure branches (the 2026-11-09 sticky-notes incidents)

| Symptom | Root cause | Remedy |
|---|---|---|
| Plugin entry absent, console has `slot entry crashed in '<slot>': TypeError ...` | a thrown factory/component blanks the slot entry | Gate 2 FAIL → fix the plugin module, reinstall, re-probe |
| Click on element X times out: `X ... subtree intercepts pointer events` | another plugin element covers the target (stacked notes) | drag the covering element aside first, or click the TOPMOST instance (`.last()`); then report the overlap as a plugin defect |
| Click "succeeds" but the button's handler never fires | an ancestor's `setPointerCapture` on pointerdown retargets the derived click | plugin defect: skip capture when `e.target.closest('button')` |
| Drag moved nothing but gates "pass" | geometry lied or the drag clamped at viewport bounds | control gate (`moved: true`) is mandatory before reading counters; fix coordinates inside the container |
| `no glass ...` / multiple glasses | no panel, or foreign ownership | operator clicks the Browser chip in THIS conversation; `--owner-session <id>` if env lacks identity |## Reserved keys

Plugin selectors and localStorage keys are plugin-owned (read them from the
plugin's client module — e.g. sticky-notes uses `.sticky-notes-launcher` and
`dsh-sticky-notes:v1`). This skill hardcodes none.

---
Driver scripts: `scripts/_connect.mjs` (header lists exports), `scripts/glass-dsh.mjs`,
`scripts/probe-dsh.mjs`, `scripts/gesture.mjs`.
Companions: ADR-0045 Amendment 6; spec `dev/specs/2026-11/2026-11-09 - Glass DSH Skill/`.

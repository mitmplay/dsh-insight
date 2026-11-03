---
name: glass-dsi
description: Use when asked to test/verify work "live", "on the glass", "headed", or on the real DSI surface — drive the operator's own Glass Browser over its MCP tools (mcp__glass-browser__browser_*), opening a glass panel if none exists or adding a focused tab when one does. Reserved keyword /glass-dsi (legacy alias /dsi-glass still matches).
---

# glass-dsi — verify work on the operator's own Glass Browser

**Dispatch rule (2026-10-30, the Tab-Juggling RCA):** before any glass work,
ask — is the surface I must drive the DSI workspace, or some other URL?
DSI workspace → this skill (the driver hard-requires the DSI tab on :5175).
Any other URL → the `glass-url` skill; it opens a NEW tab and NEVER touches
the DSI tab. Do NOT navigate the DSI tab to an external URL and do NOT
re-run `open` to "recover" — that dance produced a useless DSI tab, a
strike from the driver, and three tabs where one was needed.

Companion KB: `dev/feature-contract-scenario/glass-browser-verification.md`
(the why and the wire: CDP, the :9515 in-process brain, the three doors).
This skill is the DO-path.
Reference (raw-CDP DO-path when the MCP tools cannot reach the glass —
orphaned glasses, stack-trace instrumentation, no-nesting rule):
`references/cdp-verification.md` in this skill folder. The one rule above all:

**The hands are the browser.** `mcp__glass-browser__browser_*` tools drive
the SAME headed Chromium the operator's floor panel mirrors (CDP via the
in-process brain). Never launch your own Playwright browser — that
verifies a different browser.

## Step 0 — is DSI even running? (and the circularity rule)

Port check — `lsof` on macOS; on Linux it is often not installed, so
fall back to `ss` (the dsi-ports skill is the full ledger):

```sh
# macOS (lsof ships with the OS)
lsof -nP -iTCP:5175 -sTCP:LISTEN   # vite dev server
lsof -nP -iTCP:9515 -sTCP:LISTEN   # the in-process MCP brain
# Linux fallback (lsof frequently absent)
ss -ltnp 'sport = :5175'; ss -ltnp 'sport = :9515'
```

No 5175 ⇒ the floor is not up — ask the operator (or run
`dsi dsh --sync --dev --playwright-mcp`) before anything else.

**The circularity rule (learned 2026-10-27):** the brain on :9515 exists
only while a glass session exists, and the only browser hands you have
are the `mcp__glass-browser__browser_*` tools — which are dead until the
brain exists. `fetch failed` from the MCP tools means "no glass
session", NOT "DSI is down" — do not treat it as a floor outage and do
not go fix ports.

## Step 1 — the Glass Browser exists? (THE definitive procedure)

**Hard architecture facts (learned the hard way, 2026-10-27 — do not
re-litigate them):**

- The glass Chrome is launched `headless: true` and parked at
  `--window-position=-32000,-32000` BY DESIGN (insight-config.ts,
  `browser.headless` default; ADR-0041). The operator's floor PANEL is
  the browser's face — a CDP screencast over SSE. There is no OS window
  to look for; never "fix" this.
- The floor panel mount is CLIENT state only (`openBrowserPanel` →
  in-memory floor store + localStorage blob). There is NO API that mounts
  a panel. A session you `POST /api/browser` yourself is an ORPHAN: it
  streams fine, but no panel can ever adopt it (the resolver persists
  only ids IT opened). Do not open sessions yourself expecting the floor
  to show them.

**The one correct open flow (verified end-to-end 2026-10-27):**

1. **No glass, or your tools fail with `fetch failed`?** Ask the
   OPERATOR to click the Browser chip (`OpenBrowserButton`) in the
   conversation header. Only their click mounts the panel into
   PanelsZoom and only the panel's own resolver opens + persists the
   session. This is the one gesture the agent cannot simulate — say so
   plainly and wait.
2. **Catch the session**: the click's panel opens the NEWEST entry in

   ```sh
   curl -s http://127.0.0.1:5175/api/browser   # → { sessions: [...] }
   ```

   The brain re-homes to the newest glass automatically — poll this list
   (a couple of seconds) until the new id appears with
   `mcpHealth: "up"` and :9515 listens. Then the `browser_*` tools
   drive exactly that session.
3. **Drive + verify the mirror**: `browser_navigate` to the target, and
   confirm the panel is really painting by probing the SSE:

   ```sh
   curl -s -N --max-time 4 'http://127.0.0.1:5175/api/browser/<id>/stream' | head -c 60
   # expect: event: frame\ndata: {"seq":N,"jpeg":"/9j/...
   ```

   Rising `seq` = the operator's panel is receiving live frames. Finish
   by asking the operator to confirm they SEE the page — the mirror is
   the surface they judge you by.
- **Glass already open with tabs** — `browser_tabs` with
  `{ "action": "new", "url": <target> }` adds a tab LAST and focuses it,
  then navigate/verify in that tab. Never reuse an operator's existing
  tab state; never close their tabs.

## Step 2 — drive the verification

1. **Reach the surface** — navigate to the target (usually
   `http://127.0.0.1:5175`). Seed state through the page's OWN
   persistence (localStorage blobs like `dsi-panels`) and reload, so
   what mounts is the production restore path, not a fixture.
2. **Instrument BEFORE acting** — `browser_evaluate`: stamp the DOM
   nodes you will judge (`el.__probe = Math.random()`), wrap
   `window.fetch` with a counting shim, arm a MutationObserver. A
   counter armed after the gesture proves nothing.
3. **Reproduce the REAL gesture** — `browser_run_code_unsafe` with
   `page.mouse` (down → stepped moves with waits → up), or
   `browser_click`. Synthetic dispatchEvent is not the operator's
   gesture; prefer real input where input is what's being tested.
4. **Read the evidence** — `browser_evaluate`: node identity (did the
   stamped probe survive?), counter deltas, innerHTML before/after.
   Before/after pairs are the verification; adjectives are not.
5. **Gate every read on a control** — assert the gesture actually moved
   what it should (e.g. the panel WIDTH changed) before interpreting
   other counters. A drag that moved nothing trivially "passes".

## Failure branches (all observed 2026-10-27 — this is the baseline)

- **Geometry lies.** `boundingBox` center can land above the viewport
  fold; the drag moves nothing and every counter reads clean. Fix the
  coordinates (use `g.y + 200` inside a tall gutter) and re-run.
- **The wrong twin.** In-panel and floor gutters share
  `data-testid=panel-gutter-0`. Scope selectors
  (`[data-testid=panels-row] > [data-testid=panel-gutter-0]` = floor)
  or you verify the wrong machine.
- **Dev-server HMR reloads mid-test** — the page navigates under you,
  stamps and shims vanish, counters reset. Detect it (readyState /
  element gone) and re-arm; never report numbers from a destroyed
  context.
- **Blob drift** — the app saves panel-prefs on settle; your seeded
  state can be overwritten by an earlier interaction. Re-seed + reload
  when the surface looks wrong.
- **The in-memory registry** — the browser-session registry lives in the
  dev server's RAM. A vite restart (crash, HMR of server modules, config
  edit) silently empties `GET /api/browser` and kills every Chrome;
  "down"/vanished sessions you did not close mean this happened. Re-run
  Step 1 (operator clicks the chip again).
- **`DELETE /api/browser/<id>` is unreliable** — observed 500 twice
  (2026-10-27) while the session stayed registered. If you must clean a
  dead entry, verify with `GET /api/browser` afterwards; do not assume
  the DELETE succeeded.

## Report

Numbers before/after, the gesture that produced them, and the gates that
passed. Label anything you seeded as seeded. If a step could not run,
say so — a partial verification is a claim about what RAN, not about
the feature.
## Tab-ID grammar (2026-10-28 — glass-tab-ids wave)

Glass prompts and the panel omnibox share ONE parser: src/lib/browser/tab-grammar.ts (`parseTabCommand`, discriminated union) — the both-doors rule; they can never disagree about what a command means. Grammar:

| Input | Meaning |
|---|---|
| `glass <url>` | open a new tab to url |
| `glass <text>` | open a new tab to a web search of text |
| `reuse tab:N [url]` | focus tab N, optionally navigate |
| `change [to] tab:N` / `tab:N` | focus tab N |
| `close tab:N` / `close active` | close that tab / the active tab |
| `active` | report the focused tab (id + URL) |
| anything else | chrome fallback — navigate or web search on the active tab |

`Alt+N` on the panel (not a grammar input) focuses the Nth tab by STRIP POSITION before the CDP relay — Alt+0 is the last tab; empty slot is a no-op and the combo never reaches the glass page.

`tab:N` is the registry-owned ordinal rendered on the strip badge (data-testid=browser-tab-ordinal) — the badge IS the prompt ID. Focus polish 2026-10-28: the badge now READS `t{index}:{id}` (the 1-based strip position, the same index Alt+N dispatches on), while PROMPTS still use the `tab:{id}` grammar — the registry is unchanged. Ordinals are never reused after close: a retired/unknown tab:N is an explicit error (404 NO_TARGET), never a silent nearest-match. When verifying live, read the number off the badge and address the tab by it.


## Fast path — the driver script (2026-10-29)

The whole discovery dance above is codified in ONE script. Run it FIRST;
fall back to the manual steps only when it fails:

```sh
# from the DSI repo root (playwright-core resolves there)
node .agents/skills/dsi-glass/scripts/glass.mjs open          # resolve port, connect, reuse-or-create the DSI tab
node .agents/skills/dsi-glass/scripts/glass.mjs type '?adr'   # real keystrokes into the composer
node .agents/skills/dsi-glass/scripts/glass.mjs strip         # rows / activeIdx / ariaSel / tipCount verdict
node .agents/skills/dsi-glass/scripts/glass.mjs shot tmp/glass.png
node .agents/skills/dsi-glass/scripts/glass.mjs eval '1+1'    # arbitrary page.evaluate
node .agents/skills/dsi-glass/scripts/glass.mjs pages
```

It caches NOTHING: every run re-resolves the session from
`GET /api/browser` (rule 3 — a hardcoded port verifies a ghost). On
failure it prints the manual fallback (operator clicks the Browser chip).
Complex gestures (mouse drags, multi-step keyboards, instrumentation
shims) still go through playwright-core by hand per §2–§4 — the script
covers the connect + common verbs, not every probe.


---
name: glass-url
description: Open and drive an ARBITRARY URL (YouTube, docs, any web page) in a NEW tab on the operator's glass browser via CDP — search, click, screenshot, read the page. NOT for verifying DSI work; that is glass-dsi. Reserved keyword /glass-url.
---

# glass-url — drive an arbitrary URL on the operator's glass

Companion skill: `glass-dsi` (verify DSI work on the glass — the DSI tab,
the floor mirror, the SSE probe). This skill is the OTHER scenario: the
target is some web page, and the DSI tab is none of your business.

**The dispatch rule (Tab-Juggling RCA, ADR-0045):** before any glass work
ask ONE question — is the surface I must drive the DSI workspace, or some
other URL? DSI workspace → `glass-dsi`. Any other URL → THIS skill.
Never navigate the DSI tab, never re-run `open` to "recover".

## Environment contract (read before the first command — RCA 2026-10-30)

- **Node lives off the default PATH here** (`~/.local/bin/node` observed
  2026-10-30). If `node` is not found, resolve it first:
  `bash -lc "which node"` or check `~/.local/bin`, `/opt/homebrew/bin`.
- **Run from the DSI repo root** (`~/agentic-ai/deepseek-insight`) so
  `playwright-core` resolves.
- **Never hand unquoted JS through a shell** — a stripped quote fails
  after the round-trip was already spent. Use `eval --b64 <base64>`.
- **Every ad-hoc driver snippet must `process.exit()`** — a driver that
  played media once hung its caller for a full 120s timeout.
- **Script headers are contracts** — `_connect.mjs` exports
  `die`, `connect`, `pick(ctx, substr)`; do not guess names, read the
  header; re-read the header in the same edit that changes the code.

## The fast path — glass-url.mjs (one command per intent)

```sh
# from the DSI repo root (playwright-core resolves there)
node .agents/skills/glass-url/scripts/glass-url.mjs yt "Dimas Senopati" --play "What's Up" --shot tmp/proof.png
#   → search + normalized match + open watch tab + unmute/play + double
#     gate + shot, ONE JSON with every stage, then exits. --play consumes
#     EVERY term (artist AND title) — put both in it (ADR-0045 D9).

node .agents/skills/glass-url/scripts/glass-url.mjs open <url>    # NEW tab, focused
node .agents/skills/glass-url/scripts/glass-url.mjs pages         # list tabs
node .agents/skills/glass-url/scripts/glass-url.mjs eval '<js>'           # newest non-DSI tab
node .agents/skills/glass-url/scripts/glass-url.mjs eval watch?v= '<js>'  # inline: LAST arg is the js
node .agents/skills/glass-url/scripts/glass-url.mjs eval --b64 <b64-js> <url-substring>
    # quote-proof eval; anything left after the payload IS the url-substring
    # (ADR-0045 D10 — parsed by shape, never positional fallback)
node .agents/skills/glass-url/scripts/glass-url.mjs shot f.png [url-substring]
```

"Newest tab" = last http(s) page that is neither the glass placeholder nor
the DSI tab (:5175). When SEVERAL foreign tabs exist, position lies —
pass the URL-substring argument (the `yt` verb does this for you).
Every run re-resolves the session from `GET /api/browser`.

## Recipes

- **Search + play a video:** the `yt` verb IS the recipe (match
  normalization included: apostrophes/case folded). Only drop to
  `open` → `eval` when the flow is not search-and-play.
- **Read a page:** `open` → `eval` extract DOM text/links.

## Rules

1. Always `open` a NEW tab for your target — never reuse a tab you did
   not create, never close operator tabs.
2. Never navigate the DSI workspace tab; it belongs to glass-dsi.
3. Multi-step state (click, type, drag) beyond eval/shot: drop to
   playwright-core by hand over CDP (import `connect`/`pick` from
   `.agents/skills/glass-url/scripts/_connect.mjs` — exports listed in
   its header), same as glass-dsi §2–4.
4. If `GET /api/browser` has no session: the operator must click the
   Browser chip first (the one gesture you cannot simulate). Say so and wait.
5. Verify with gates, not adjectives: a playback gate is `paused:false`
   plus rising `currentTime`; a navigation gate is the URL/title you
   expected; finish by asking the operator to confirm they SEE it.

## Identity (2026-10-30, RCA "the session id is gone")

The driver claims YOUR glass by identity, first-wins:
1. `--owner-session <id>` flag — pass the session id you already know from
   your context when `DSH_SESSION_ID` is absent (the harness injects it
   only when the execution carries an agent binding — dsh-shell-env
   index.js:89 — so its absence is possible and NOT an error).
2. `GLASS_OWNER_SESSION` env.
3. `DSH_SESSION_ID` env.
No identity + several live glasses = loud refusal, never a guess (D7).

## The Stop-Loss Law (2026-10-30, ADR-0045 D11 — a refusal is an answer)

- **NO_MATCH is an answer.** When the yt verb exits `stage:"match"` with a
  candidate list, REPORT that list and STOP — do not open ad-hoc search
  tabs, do not re-search with different words, do not drop to open/eval to
  hand-roll what the verb just refused. The operator decides the next move.
- **Grammar dies are answers.** A `die` ("no tab matching …", "no
  non-DSI tab …") ends the investigation, not triggers a workaround hunt.
  Run `pages` once to re-orient if you must, then report.
- **Already playing is DONE.** If the media is live on the operator's glass
  (they say so, or a prior gate passed), the goal is met — report and stop.
  No follow-up verification, no "one more tab". Verification serves the
  operator's goal; when the goal is met, the correct next action is WORDS.
- Every extra tab and round-trip after a refusal is a token burn the
  operator pays for. (RCA: "The Answer That Bought Another Round".)

## Failure branches (2026-10-30)

- `eval` on a cross-origin page still loading can return empty — wait and
  re-run; do not conclude "no results".
- String matching needs normalization (case, apostrophes) or exact titles
  will NO_MATCH — `yt` normalizes for you.
- A vite restart empties the registry and kills the Chrome — re-run from
  the operator's chip click, same as glass-dsi.
- "Newest non-DSI tab" is positional and CAN pick a sibling foreign tab —
  select by URL substring (the optional eval/shot argument), not position.
- Node/git missing from PATH, quoting mangling, guessed flags, and
  non-exiting drivers each cost a full round-trip: see the environment
  contract above; they are pre-paid now.

---
name: "dsi-drive-terminal"
description: "Drive the operator's live Terminal Desk tab (T1, T2, …) over DSI's terminal wire with curl — baton etiquette, human-pace typing, ring reads, silent-eater escapes. Reserved keyword /dsi-drive-terminal"
---

# Drive Terminal

One goal → a live terminal session driven over DSI's terminal wire with
curl: read who holds the baton, take it labelled, type like a human, read
what the shell said, hand it back — while the operator watches the same
bytes paint their desk tab.

## SYSTEM PROTOCOL: THE BATON LAW

The session's write token is a baton with ONE holder. Every rule below
instantiates it (ADR The Surviving Shell 2026-09-24 + amendments
2026-11-04; ADR-0079 The Baton Facet 2026-11-23; mechanics:
`dev/feature-contract-scenario/terminal-driving.md`). Each law is stated
once — the steps and the checklist only point back at it.

1. **READ before you take.** `GET /api/terminal` is token-free and lists
   every session with its `baton`: `holder` (`operator` | `automation` |
   `unassigned`), `holderId`, `since`, `lastWriteAt`, `pinned`,
   `readyForAutomation`. One call answers "who holds it, may I take it".
2. **WHOSE WORD COUNTS.** A session the operator NAMED in the ask
   (`/dsi-drive-terminal T1:7 …`) is yours to take even while it reads
   `operator` — the desk re-takes the baton on every mount, so an open
   tab always reads that way. A tab you picked YOURSELF must read
   `readyForAutomation:true`; otherwise wait and ask — silence is not
   consent. `pinned:true` → never. `exited:true` → dead; nothing to drive.
3. **LABEL every takeover.** Each reattach you make — the first and every
   heal — carries `{"holder":"automation","holderId":"<your agent name>"}`.
   The desk shows "agent holds this terminal" the moment you take it, no
   keystroke needed. A `{}` reattach is the desk's own: it means the operator.
4. **A REFUSED WRITE IS READ, THEN HEALED.** On `403 FOREIGN_SESSION`, read
   the facet once:
   - `holder:"operator"` and `lastWriteAt` is null or OLDER than `since` →
     the desk only re-mounted (reload, HMR swap): heal — labelled
     reattach, retry the SAME keystroke.
   - `holder:"operator"` and `lastWriteAt` is newer than or equal to
     `since` → a human typed: STOP. Report and wait; never take a tab
     back from someone typing in it.
   - `holder:"automation"` under another name → another driver: stop and
     report. `holder:"unassigned"` → released: heal and take it.
   Never retry blind, never re-mint in a loop.
5. **RELEASE is your last wire act.** `action:"release"` hands the baton
   to nobody (`holder:"unassigned"`); the operator's next keystroke heals
   once — the priced cost. A desk still reading "agent holds" after you
   left is baton litter.
6. **THE DESK IS THE UX.** Run commands UNPIPED — the operator watches
   progress paint live. The PTY echoes reality: no echo = the write was
   refused or the shell is busy. NEVER type while a command is still
   running (keystrokes go into that process's stdin, silently).
7. **A RECEIPT PROVES NOTHING.** Check every response: `{"written":true}`
   | `403` → law 4 | `409 SEND_ACTIVE` → wait | `400` → fix the body.
   A dead session still answers `written:true` (RCA 2026-11-04):
   completion gates on ECHO + the exit marker in the ring, read as output —
   never the receipt, never how the typed line looks.

## The Readiness Gate (ADR-0080) ⛔ MANDATORY before typing

`GET /api/terminal` carries each session's `readiness: {settled, settledSince, reason}` — the server's promise that the shell produced NO output for ≥ `idleMs`. **`readiness.settled === true` is the gate to type; screen text is evidence, never the gate** (the 2026-11-24 ring-redraw artifact caught peek text lying). `drive.mjs type`/`take` refuses with a named CONCERN while `settled` is false (`--force` overrides) — the peek of the last line is demoted to ONE secondary check: the half-typed line (a settled shell can still hold a line the operator never pressed Enter on). A settled:false with a long-running command means WAIT and re-read; never guess from scrollback.

## When to Use

- User says `/dsi-drive-terminal {what to run}` or "drive T1"
- User asks to install/build/run something "on the terminal" while their
  desk tab is the surface they will judge
- Agent needs to execute on a remote box the operator's shell is SSH'd into

### Step 0: No Params — Usage Guide

`/dsi-drive-terminal` with no arguments asks for two things and replies
with this guide — NOT execution. Many commands → confirm the order first,
and do NOT take the baton until the goal is confirmed.

```
📋 **Drive Terminal** — No inputs specified. I need two things:

1. **Session** — the desk tab (T1, T2, …) or "open a new one"
2. **Command / goal** — what to run, e.g. "pnpm install then build"

Usage: `/dsi-drive-terminal {session} {command}`
```

Pipeline: Step 1 floor + facet + labelled baton → Step 2 type → Step 3 read
→ Step 4 on trouble → Step 5 release → report what the operator saw.

## Step 1: Floor + Baton ⛔ MANDATORY

Resolve the floor port by PROBE, never by memory of a previous session. The probe rides a discovery ladder (ADR-0080 D4, MAC AND LINUX): `lsof -nP -iTCP -sTCP:LISTEN` first, then `ss -ltn` when lsof is absent, then a 5100-5199 sweep — and every candidate is confirmed by the JSON probe (the GET must answer DSI's `{enabled,…}` JSON) before it counts as a floor; a port whose GET returns broken/non-JSON is never a floor. `drive.mjs` runs this ladder for you.
Resolve the session id from the desk badge — `T{position}:{id}` (`T1:7` =
tab index 1, session `t-7`) — never from the tab position: "T1" once drove
`t-7` while `t-1` sat dead for an hour, and 69 keystrokes vanished
(RCA 2026-11-04, "The Surface That Only Ever Said Yes").

```sh
PORT=5175      # only after a listener probe confirms it
ID=t-7         # the badge suffix, cross-checked against the list
curl -s http://127.0.0.1:$PORT/api/terminal     # ⛔ the facet read — laws 1 and 2, BEFORE anything else
```

Take it, labelled (law 3):

```sh
curl -s -o /tmp/t1-take.json -w '%{http_code}\n' -X POST http://127.0.0.1:$PORT/api/terminal/$ID/reattach \
  -H 'content-type: application/json' -d '{"holder":"automation","holderId":"lead"}'
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/t1-take.json","utf8"));if(!j.token){console.error(j);process.exit(1)}fs.writeFileSync("/tmp/t1-token",j.token);fs.writeFileSync("/tmp/t1-offset",String(j.fromByte))'
```

- The first line prints the status: `200` expected; `404` = `NO_SESSION`,
  a wrong id — re-resolve it from the badge. The second line exits non-zero
  when no token came back.
- No live session → open one WITH A DESK INTENT (ADR 2026-11-24 The
  Headless Split, D5): `"desk":"new-tab"` makes a new T-tab appear on the
  operator's desk the moment the session is born — a mint WITHOUT `desk`
  is a headless ghost: real, baton-holding, rendered NOWHERE. Default to
  `"desk":"new-tab"` when opening for the operator:
  `curl -s -X POST http://127.0.0.1:$PORT/api/terminal -H 'content-type: application/json' -d '{"holder":"automation","holderId":"lead","desk":"new-tab"}'` → `{sessionId, token}`.
  The visible-split form is `"desk":"split-down"` — it stacks a row under
  the desk's SELECTED tab (use it when the operator asked for a split).
  The adopted row streams token-free; the baton is YOURS until you release
  — the desk claims only when the operator actually types into it (D3).
- Freshly opened, the shell needs a moment: its first prompt lands ~1 s
  after open. Wait ~2 s, then make your FIRST line a marker (`echo READY` +
  Enter) and gate on `READY` in the ring. Never judge a typed line by how it
  looks in a stripped ring: keys sent before the first prompt are echoed by
  the terminal itself, and the line editor redraws with backspaces (`x\bxyz`
  stands for `xyz`). The marker's output is the proof.

## Step 2: Type ⛔ MANDATORY

One helper for every tokened call — define and use it in the SAME shell
call. It builds the body with node, so nothing is inline-quoted (one bad
escape is a silent `BAD_REQUEST`):

```sh
tt() {  # tt <action> [data] — one call to the send route, response printed
  node -e 'const fs=require("fs");const [a,d]=process.argv.slice(1);const b={token:fs.readFileSync("/tmp/t1-token","utf8").trim(),action:a};if(d!==undefined)b.data=d;fs.writeFileSync("/tmp/t1-body.json",JSON.stringify(b))' "$@"
  curl -s -X POST http://127.0.0.1:$PORT/api/terminal/$ID/send -H 'content-type: application/json' --data-binary @/tmp/t1-body.json; echo
}
for ch in e c h o ' ' A L I V E; do tt write "$ch"; sleep 0.12; done; tt write $'\r'
```

- **Human pace, ONE pace: one keystroke per write, ~120 ms apart, every
  response checked** (law 7). Faster bursts hit the write fence and DROP
  characters (live: `sudo apt update` → `sudoaptupdate`).
- Passwords: same pacing; PTY echo is off — the secret never lands in
  scrollback, the desk shows dots.
- End every long command with a marker: `; echo STEP-DONE-$?` — the marker
  is the completion gate (exit code included).

## Step 3: Read ⛔ MANDATORY

```sh
curl -s "http://127.0.0.1:$PORT/api/terminal/$ID/output?fromByte=$(cat /tmp/t1-offset)"
```

- The offset was captured BEFORE you typed; read right after the command
  finishes, and keep each read's `nextOffset` for the next one.
- ANSI strip, on the raw JSON text (the `.\b` pass undoes the line editor's redraw, so `x\bxyz` reads `xyz`): `sed 's/\\u001b\[[0-9;?]*[a-zA-Z=]//g; s/\\u0007//g; s/.\\b//g; s/\\r\\n/\n/g; s/\\n/\n/g; s/\\r//g'`
- Empty/short read → the ring rotated (it holds only the last few KB):
  re-read `fromByte=0`, or re-run with output redirected to a file and
  `cat` a slice.

## Step 4: Refused or Swallowed ⛔ MANDATORY

- `403 FOREIGN_SESSION` → law 4: read the facet, then heal or stop.
- `written:true` but nothing executes or echoes → a silent eater (credential
  prompt, commit editor, approve prompt). Escape with `tt write $'\003\003'`
  (Ctrl+C ×2) or ESC + `:qa!\r` (vi family), confirm with a marker (`echo ALIVE`),
  re-send. No echo at all → check `exited` in the list first.

## Step 5: Release ⛔ MANDATORY — hand the baton back

The LAST wire act, after the exit marker is in the ring and before
hands-off:

```sh
tt release
```

- Expect `200 {"released":true,"baton":{"holder":"unassigned",…}}` — the
  desk badge flips to "released" and your token is dead on purpose.
- `403` on release → you already lost the baton; nothing to release.
- Hold the baton while a long command runs if you want to keep watching;
  release the moment you stop writing — never leave it held after your report.

## Drive Checklist — MANDATORY

The ONLY checklist output to the user. Declared at the start, verified at
the end.

```
📋 drive-terminal: {session} — {goal}

   [ ]  1.1  ⛔ Facet read FIRST — whose word: named by the operator, or readyForAutomation true
   [ ]  1.2  ⛔ Floor port probed (listener confirmed, not assumed)
   [ ]  1.3  ⛔ Session id resolved from the badge suffix / list — NOT from the tab position
   [ ]  1.4  ⛔ Baton taken LABELED {holder:automation, holderId:<agent>} — token + offset captured; fresh shell: `echo READY` first
   [ ]  2.1  ⛔ Every write answered {"written":true}; any 403 read first → heal or STOP
   [ ]  2.2  ⛔ One keystroke per write, ~120 ms apart
   [ ]  2.3  ⛔ Long commands carry an exit marker; completion gated on its output in the ring
   [ ]  3.1  ⛔ Output read from the pre-captured offset, promptly
   [ ]  4.1  ⛔ Silent eater escaped + marker-confirmed; a dead session ruled out (exited)
   [ ]  5.1  ⛔ Baton RELEASED before hands-off (holder → unassigned)
   [ ]  6.1  ⛔ Commands ran UNPIPED — the operator could watch everything
   [ ]  6.2  ⛔ Report states what the desk showed, not just what was read

   ⛔ Behavioral Commitments:
   [ ]  I will NOT take a tab the operator did not name unless readyForAutomation is true
   [ ]  I will NOT take a tab back from someone who typed in it — a 403 is read, never retried blind
   [ ]  I will NOT leave the baton held — release is the last wire act
   [ ]  I will NOT type while a command is still running, or pipe away what the operator watches
   [ ]  I will NOT claim success without the exit marker in the read
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Check-Off Rules

Re-output the checklist with `[✅]` / `[🔄]` / `[ ]` at each step transition
(1→2, 2→3, 3→4); at completion output the final checklist — ALL `[✅]`, any
`[❌]` — and never deliver without it.
<!-- RCA: AI-Research/LLMs Skip Mandatory Steps/001. LLMs Skip Mandatory Steps/002.The Visible checklist Pattern/2026-06-11 - The Visible Checklist Pattern - AI Research v1 - report.md -->

## --peek — the Read-Only Mode

`/dsi-drive-terminal --peek {session or tab badge}` reports WHAT IS GOING
ON on that terminal and writes NOTHING — no baton is taken, so the
operator's tab never heals, never blinks. Resolve the session id from
evidence (the badge law in Step 1), read the ring tail token-free
(`curl -s "http://127.0.0.1:$PORT/api/terminal/$ID/output?fromByte=0"`, ANSI-stripped per Step 3),
and report: session id, exited or live, who holds the baton (the list's
`baton` — a read, never a probe write), the last screenful, and — if live —
the likely foreground command in the scrollback.

Peek NEVER: reattaches, writes bytes, mints or accepts a token. If the
operator then says "drive it", that is the word — Step 1.

The skill is the DO-path. The WHY and the CONTRACT live in the KB note
`dev/feature-contract-scenario/terminal-driving.md`; the decisions in ADR
The Surviving Shell (lease + auto-heal) and ADR-0079 The Baton Facet
(facet + label + release). Each law once, one helper, one pace — on purpose.
<!-- RCA: AI-Research/YT-Research/2026-06-22 - Why Long Instructions Make AI Dumber - Attention Degradation Science.md -->

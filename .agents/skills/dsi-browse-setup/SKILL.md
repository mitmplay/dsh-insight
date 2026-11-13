---
name: dsi-browse-setup
description: Set up @opencode/browse for DSH — detect the --playwright-mcp conflict (in-process glass brain, cannot have both), install the npm package if missing, wire the Cordis MCP patch into ~/.dsh/profiles/web/cordis.patch.yml, pair the Chrome extension via a one-time relay code, then verify live with "Open news.ycombinator.com and tell me the top story". Reserved keyword /dsi-browse-setup.
---

# dsi-browse-setup — the browse bridge, end to end

Companion KB: `dev/onboard/2026-11-13-opencode-browse-mcp.md` — read it for
WHY (where the install lands, where the pairing code is born, the SC#0/SC#1
diagrams). This skill is the DO-path: gate → install → patch → pair → verify,
stopping at any gate and reporting.

## Gate 1 — the --playwright-mcp conflict (HARD STOP)

The dev floor has ONE browser brain at a time (ADR-0029 D7):
`dsi dsh --sync --dev --playwright-mcp` embeds the in-process glass brain
(`DSI_MCP_IN_PROCESS=1`); browse's MCP is a second, independent driver of the
same browser. They must not run together.

Detect which floor is running (macOS):

```sh
ps axww -o pid,command | grep 'bin/dsi.mjs dsh' | grep -v grep
```

- Command line contains `--playwright-mcp` → **STOP**. Tell the operator:
  "the floor runs the in-process glass brain; browse MCP cannot coexist with
  it. Drop the flag and restart (`pnpm dsi dsh --sync --dev`), then re-run
  this skill." Do not patch, do not install.
- No `--playwright-mcp` → continue.
- Cross-check if argv is ambiguous: the marker env `DSI_MCP_IN_PROCESS=1` on
  the vite child means the glass brain is in (registry.ts reads it at
  `src/lib/server/browser/registry.ts:1319`).

## Gate 2 — install the package if missing

```sh
command -v browse >/dev/null 2>&1 || npm install -g @opencode/browse
```

After install, sanity-check the shape this machine expects (fnm global root,
`~/.local/bin/browse` → `dist/cli.mjs`; details in the KB §2):

```sh
browse --version && readlink ~/.local/bin/browse 2>/dev/null || ls -l ~/.local/bin/browse
```

## Gate 3 — the Cordis MCP patch (skip if already present)

```sh
grep -q 'browser-browse' ~/.dsh/profiles/web/cordis.patch.yml && echo present
```

If present → skip to Gate 4. If absent, append this block (agent-hygiene:
write the block to `/tmp/browse-insert.yml` and append with `cat ... >>` —
never inline YAML with `!!js` inside a JS template string):

```yaml
- insert:
    - id: browser-browse
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browse
        transport: stdio
        command: /Users/wharsojo/.local/bin/browse
        args: [mcp]
        env: {}
        cwd: !!js process.cwd()
```

Format is pinned by DSH's patch parser (`@deepseek-ai/cordis-plugin-include`);
the profile patch layer composes at boot, so the wiring survives restarts.
A restart is required for the insert to land: `pnpm dsi dsh --sync --dev`
(warn the operator: the restart briefly drops every session, including the
one running this skill).

## Gate 4 — extension + pairing

The extension is one-time install; pairing is one-time trust.

1. If `browse pair --list` already shows a paired browser → skip pairing.
2. Otherwise run in background (`--wait-seconds 300` gives the operator time):

```sh
browse pair --wait-seconds 300
```

3. The relay **mints the code locally** (random, one-time, 10 minutes; stored
   in `~/.local/share/browse/pairing-codes.json` — it is a handshake proof,
   not a vendor secret). Relay the printed instructions verbatim to the
   operator: **Chrome → Extensions menu → browse → Options → "Pair with a
   code" → enter the code → Connect.**
4. Collect the background job's output; success is the line
   `✓ Paired Chrome on ...`. Verify with `browse pair --list`.
5. The extension itself is obtained via `browse extension` (store page or
   unpacked folder) or `browse install --no-open` prints the steps — hand
   those to the operator if `browse pair` reports no extension.

## Final gate — the live verify (always this exact ask)

Once Gates 1–4 pass, verify end to end by asking the operator (or the fresh
session) the canonical probe:

> **"Open news.ycombinator.com and tell me the top story"**

Success = the ``mcp__browse__*`` tools are listed in a **fresh** session
(the patch layer only surfaces tools to sessions created after boot;
discovery is asynchronous — wait for the tools before calling) and a real
tab opens in the operator's Chrome with a real title+points answer.
Live-proven 2026-11-13: "Jensen Huang resigns — 2757 pts".

Failure handling:

- Tools missing → the patch insert did not compose; re-run Gate 3's grep,
  check the floor actually restarted.
- Tools listed but call fails with "not paired" → Gate 4 skipped or token
  stale; re-run `browse pair`.
- One story question, one pairing attempt — never loop codes.

## Boundaries

- Never run browse and the in-process glass brain in the same floor (Gate 1
  is absolute).
- Never patch DSH config files other than
  `~/.dsh/profiles/web/cordis.patch.yml` (append-only; never rewrite
  existing entries).
- Never mint more than one pairing code per run; codes are one-time and the
  operator's Chrome is the only redeemer.
- Kills/restarts of the floor are operator-visible actions — announce before,
  report after (port ledger habit: `dsi-ports`).

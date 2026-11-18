---
name: dsi-ports
description: Fast feedback-loop port inventory — run /dsi-ports (or ask "what's running / which ports are open / what's eating memory") to list every TCP listener with pid, process, memory usage, and its purpose (DSH host, DSI UI, Playwright, inspector, test floors). Backed by the Port Ledger KB.
---

# dsi-ports — the Port Ledger, live

Companion KB: `dev/kb/open-ports/2026-10-12 - The Port Ledger — Who Opens What, Why, and How Test Floors Stay Isolated.md` — read it for WHY each port exists. This skill is the LOOK-path: one command, one table, no judgment.

## Run

Execute this single pipeline (macOS; safe, read-only). AGENT HYGIENE: write
the block to a temp file (`/tmp/dsi-ports.sh`) and run `sh` on it — inlining
shell `$-expansions` inside a JS template string breaks the tool call
(observed 2026-10-12); the failure is the caller's, not the pipeline's.

```sh
for pid_port in $(lsof -nP -iTCP -sTCP:LISTEN | awk 'NR>1 {match($9, /[^:]*$/); print substr($9, RSTART) "/" $2}' | sort -u); do
  port=${pid_port%%/*}; pid=${pid_port##*/}
  rss=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0f MB", $1/1024}')
  cmd=$(ps -o command= -p "$pid" 2>/dev/null | cut -c1-70)
  echo "$port | $pid | ${rss:-?} | $cmd"
done | sort -n
```

## Format the output

Present EXACTLY this table (port ascending), then the purpose line:

| Port | PID | Process | Memory (RSS) | Purpose |
|---|---|---|---|---|
| 3080 | 1234 | node …/vite.js dev | 412 MB | **DSH host** — browser RPC + token announce |
| 5175 | 1234 | node …/vite.js dev | 388 MB | **DSI dev UI** — the page the operator uses |

Purpose lookup (from the Port Ledger KB — first match wins):

| Port | Purpose |
|---|---|
| 3080 | DSH host — browser RPC, token announce |
| 5174 | DSI built UI (production page) |
| 5175 | DSI dev UI (Vite, HMR) |
| 5176 | Playwright webServer (vite preview, e2e backend) |
| 9229 | Node inspector (D7 — one debugger for DSI + embedded host) |
| 1933 | OpenViking memory server |
| 34xx | test-floor DSH host (isolated) |
| 51xx (5180+) | test-floor UI (isolated) |
| 52xx (5200+) | worktree executor UI (Vite, HMR, isolated) — lane open only (ADR-0072) |
| anything else | **unknown — name the binary and ask** (never guess a purpose) |

## Reading the table (tell the operator, one line each)

- Same PID on TWO ports (e.g. 3080 + 5175) → the **in-process floor** (one process, D7).
- 5175 up but 3080 down → UI-only floor; the page will show "Failed to fetch".
- 3080 up but no 5175/5174 → bare host (tandem's other half missing, or runCli host only).
- Two PIDs on the same port → TWO listeners — list both rows, flag it.
- Biggest RSS → name it; vite dev floors routinely sit at 300–500 MB (normal).

## Boundaries

- Read-only: `lsof`, `ps`, `sort`. Never kill, never open, never edit — remediation is always a separate, confirmed step.
- IPv6 vs IPv4 duplicates: same port with different PIDs means TWO listeners — list both rows, flag it.
- The table is a snapshot; ports move between runs. Re-run, don't cache.

# Port env rename: DSI_PORT / DSH_PORT / GLASS_PORT — short design

Date: 2026-11-08 · Size: small change

## Intent and why

Running two DSI instances on one machine currently needs an awkward mixed
invocation — some ports as bare env vars, some as CLI flags:

    PORT=5176 DSI_MCP_PORT=19515 npx @deepseek-insight/dsi@latest dsh --sync --playwright-mcp --port 3081

The bare PORT is especially collision-prone (any tool on the shell may set
it). The rename gives every surface a scope-named env var:

    DSI_PORT=5176 GLASS_PORT=19515 DSH_PORT=3081 npx @deepseek-insight/dsi@latest dsh --sync --playwright-mcp

| Var | Names | Old name | Default |
|---|---|---|---|
| DSI_PORT | DSI UI (vite dev / built server) | PORT | 5174 build / 5175 dev |
| DSH_PORT | DSH host (dsh web) | --port <n> flag only | 3080 |
| GLASS_PORT | brain / glass MCP SSE | DSI_MCP_PORT | 9515 |

## Approaches

1. **Clean break (CHOSEN)** — old names ignored entirely. Simplest source
   and tests; matches the no-conflict goal. Give-up: scripts using
   PORT / DSI_MCP_PORT break loudly (wrong port), not silently.
2. **Legacy fallback** — old names honored with a deprecation warning.
   Rejected: keeps the collision-prone PORT alive forever, doubles the
   env contract surface and test matrix for a transition nobody asked for.
3. **Flags-only** — add --dsi-port / --glass-port CLI flags instead of
   env. Rejected: env vars compose better with multi-instance shell
   workflows (docker, launchd, per-terminal exports); the operator's
   own example is env-first.

## Decided

- D1: Clean break — PORT and DSI_MCP_PORT are no longer read.
- D2: --port <n> CLI flag beats DSH_PORT env when both are set (explicit
  intent > ambient config). DSH_PORT alone = same as --port today:
  forwarded to dsh web, DSI follows via DSH_BASE_URL.
- D3: stampedFloorEnv continues to stamp DSI_UI and DSI_MCP_URL into
  child env unchanged — the rename is about *inputs*; the stamped wire
  names stay (the preset's !!js expression reads DSI_MCP_URL).
- D4: Docs — README.md port table + example rewritten. The Stamped Floor
  ADR (2026-11-05) gets a short dated amendment noting the input rename.
  Dated specs/older ADRs stay untouched as history.

## Builder's leftover

Exact call sites: bin/dsi.mjs (PORT ×6 sites incl. stampedFloorEnv
callers and openBrowser; DSI_MCP_PORT ×1; new DSH_PORT readback in the
host-port derivation, keeping the forwarded-flag path),
src/lib/server/browser/registry.ts (DSI_MCP_PORT ×2). Tests to update:
stamped-floor.test.ts and browser-registry-config.test.ts (both grep the
src text as a source contract), browser-registry-branch-mop /
coverage-gap / function-floor / browser-mcp-inprocess. Verify with
pnpm test and a live two-instance boot: default floor + the renamed
example line above.
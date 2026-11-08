# Design — GLASS_BRAIN_URL: rename the brain stamp, add the operator override

Date: 2026-11-08 · Status: APPROVED (operator picked A2) · Size: small change

## Intent

Finish the port-env naming pass: the Stamped Floor's brain stamp `DSI_MCP_URL`
is the last `MCP`-named input left in DSI's env surface. Rename it to
`GLASS_BRAIN_URL` and, while touching it, give the operator the lever the VM
scenario wants: an operator-exported `GLASS_BRAIN_URL` wins over the floor's
own stamp, so a host DSI can point its whole floor at a brain running in an
OrbStack VM (or anywhere) without relying on implicit port forwarding.

## Goals

- The launcher stamps `GLASS_BRAIN_URL` (not `DSI_MCP_URL`) into every child env.
- The preset (`plugins/dsh-app-dev-preset/cordis.patch.yml`) reads `GLASS_BRAIN_URL`
  with the same `http://127.0.0.1:<GLASS_PORT>/sse` fallback idiom.
- Operator override: if `process.env.GLASS_BRAIN_URL` is already set at launcher
  start, it is passed through untouched (host floor can target a VM brain).
- Clean break, matching 0.11.0: the old name `DSI_MCP_URL` is ignored, no back-compat.

## Non-goals / anti-goals

- No discovery service, no auto-detect of VM brains — explicit env only.
- No change to `DSI_UI` (already surface-named), `GLASS_PORT`, `DSI_PORT`, `DSH_PORT`.
- No DSH-side changes (verified: no DSH consumer reads the stamp).

## Approaches

- **A1 — pure rename**: stamp + preset read + tests + docs move to `GLASS_BRAIN_URL`,
  fallback unchanged. Symmetric with 0.11.0; zero behavior change.
- **A2 — rename + operator override (CHOSEN)**: same rename, plus the launcher
  defers to a pre-set `GLASS_BRAIN_URL` instead of overwriting. Costs one branch
  and a test pin; buys the explicit VM/host-split lever. Slightly bends the
  Stamped Floor's 'stamp is authoritative' idea, but that is the established
  idiom (`GLASS_PORT`, `DSH_PORT` both beat defaults).
- Rejected: keep `DSI_MCP_URL` and add a separate override env — two names for one
  address is the confusion this pass exists to kill.

## Decisions

- **D1 — new ADR, not an amendment.** The Stamped Floor ADR stays as written
  (historical record); this change gets its own ADR citing it as predecessor.
  Rejected: amend-in-place — the rename+override changes the contract the old ADR
  froze, and a new ADR can state the cost honestly.
- **D2 — override beats stamp.** Pre-set `GLASS_BRAIN_URL` in the launcher env wins;
  the floor's computed stamp is only applied when the operator has not spoken.
  Rejected: stamp always wins — kills the VM use case this design exists for.
- **D3 — fallback reads GLASS_PORT at stamp time.** The preset's `!!js` fallback
  string stays `http://127.0.0.1:9515/sse` (bare-boot idiom, byte-for-byte); the
  launcher's own computed stamp keeps building from `GLASS_PORT`.
- **D4 — clean break.** `DSI_MCP_URL` is not read anywhere after this change;
  tests pin the new name. Rejected: back-compat aliasing — 0.11.0 set the norm.

## Footprint (implementation)

- `bin/dsi.mjs` — stamp site (:397) + the override branch; USAGE text.
- `plugins/dsh-app-dev-preset/cordis.patch.yml:234` — the `!!js` read.
- `tests/unit/stamped-floor.test.ts` — pins (new override test included).
- `README.md`, the new ADR, PRD/Tasks under dev/specs/.
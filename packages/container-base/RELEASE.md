# RELEASE — @deepseek-insight/container-base

## 0.1.1

Bumped from 0.1.0 — the capture buttons move into the package and the desk remembers before paint.

### Features
- **Panels boot script** — `panelsBootScript(baseKey)` in `src/storage/boot-script.ts` generates the pre-paint prefs hand-off inline script (ADR-0067 D2/D3): profile-suffixed key derivation mirrors `namespace.ts`, publishes `window.__BOOT_PREFS[baseKey] = { profile, raw }` — raw string only, no parsing. Consumers (DSI, playground) emit it via their sync scripts. Commit `a97833dd`.
- **Capture buttons promoted** — `CanvasCopyButton` + `PanelClose` join the package components (ADR-0066 D1–D3), consumed by DSI and the playground through the single entry. Commits `0b4018cf`…`2e6d8606`.
- **WidthBadge promoted** — the width chip moves into the package (ADR-0062 D10), badge snippet on `SidebarContainer`. Commits `27bb6860`, `541fe914`, `c796f726`.
- **Profile resolution in the base** (ADR-0065 R4 amendment) — an omitted profile auto-resolves from `?profile=` via the namespace resolver; consumer stores stay address-blind. Commit `dc7855bb`.
- **Panel-kind registry** — `definePanelKind` / `revivePanels` / `clampKindWidth` (ADR-0065 W2) with the key-grammar naming law (W1). Commits `b622f6d7`, `398b0b14`.

### Tests
- Package-level suites carried their waves' pins; branch-arm coverage raised across promoted components (`dddf74fc`); emitter idempotence + read-order pins for the boot script in the DSI repo (`tests/unit/panels-boot-emitter.test.ts`, `tests/unit/panel-prefs-boot-global.test.ts`, `tests/e2e/panels-boot-restore.spec.ts`).

---

## Publish runbook (OPERATOR-gated publish; agent sessions stop at the boundary)

Runbook for publishing a new version. **Steps marked OPERATOR are
credential-gated (2FA / OTP) and are NEVER executed by an agent session** —
the executor stops at the boundary and reports.

## Prerequisites (once)

- **OPERATOR** — create the npmjs org `deepseek-insight` with 2FA enforced
  and own the publish access (ADR-0064 D1).
- **OPERATOR** — `npm login` on this machine (provenance signing needs an
  authenticated npm identity).

## Release steps

1. **Machine gates (any session, no credentials):**
   - `pnpm --filter @deepseek-insight/container-base test` — package suites green
   - `pnpm --filter @deepseek-insight/container-base run build:package`
   - `pnpm --filter @deepseek-insight/container-base run lint:package` — publint clean
   - `node scripts/container-base-smoke.mjs` — cold-room smoke from the local tarball
   - `npx vitest run tests/e2e/survival-matrix.spec.ts` — 7/7 standing matrix

2. **Version + tag:** bump `version` in `packages/container-base/package.json`
   (pre-1.0: minor for features, patch for fixes — ADR-0064 D3), then tag:
   `git tag container-base-v<version>` at the release commit.

3. **OPERATOR — publish (2FA/OTP boundary):**
   ```sh
   cd packages/container-base
   NPM_CONFIG_OTP=<code> npm publish --provenance
   ```
   The executor does NOT run this command — ever (task 4.2 boundary).

4. **Registry smoke (after publish):** re-run the cold-room gate from the
   REGISTRY instead of the tarball:
   ```sh
   node scripts/container-base-smoke.mjs --registry
   ```
   Then the operator's live acceptance: follow the README install line in a
   fresh app, save a dark choice, hard reload — dark at first paint.

5. **Record:** push the tag (`git push origin container-base-v<version>`) and
   note the release in the GOAL tracker.

## Boundary summary

| Step | Actor |
| --- | --- |
| gates, version bump, tag | any maintainer / agent session |
| `npm publish --provenance` | **OPERATOR only** (2FA) |
| npmjs org / access management | **OPERATOR only** |

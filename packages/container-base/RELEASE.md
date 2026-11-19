# RELEASE — @deepseek-insight/container-base

## 0.3.0

Bumped from 0.2.0 — the corner grammar completes: the ControlBar tray (R10) and the SidebarHeaderActions cluster (R11) join the package; the playground becomes the greenfield template.

### Features
- **ControlBar / ControlBarTray (ADR-0073, R10, 2c139b8e)** — the hover-tray machine: gear trigger, 250ms hide grace (re-enter cancels), focus guards, Escape, portal to `document.body`, viewport clamp; fixed tray anatomy — capture row (prop-gated on `captureContainer`) → width slider → zoom slider → extras snippet. 15 suites (hover/portal/clamp/anatomy/bindings).
- **SidebarHeaderActions (ADR-0074, R11, 4da8d7ac)** — the sidebar header corner: copy camera → collapse chevron → extras snippet, fixed order; labels via props (the base never translates); capture target consumer-owned (null-container no-op contract); prop-overridable testids with DSI-compatible defaults; corner skin in scoped CSS via tokens (new `--color-surface-hover`). `CanvasCopyButton` gained an optional `testid` prop (default `canvas-copy-button` — backwards compatible). 8 cluster suites.

### Bug fixes
- **Literal html-to-image import (b3dab037)** — the variable-specifier peer import never resolved in the browser; captures were silent no-ops since R6. Literal import, visible degraded state (`aria-disabled` + opacity), loud error log. Gesture gate: `capture-clipboard.spec.ts`.
- **Corner skin self-sufficiency (4dde30e8 + 03d5c270)** — UA button chrome reset (`border: none; padding: 0`) moved into the corner skin; a fresh consumer has no global reset. The playground also gained its own reset stylesheet and resolves the package from `/src` for live HMR (vite alias — template-grade dev experience).

### Consumers
- Playground (now versioned 0.1.0 — the greenfield template): corner mount with page-shell capture (copy-image NEW), tray in extras, empty-floor messaging.
- DSI: ControlBar + SidebarHeaderActions thin consumers; `TrayButtons` and the hand-rolled corner + `:global` skin retired grep-zero.

### Tests
- Package suites grew to 378 (44 files): `controlbar` suites, `sidebar-header-actions.test.ts`, `capture-clipboard` e2e gesture gate, `playground-corner.spec.ts`.

## 0.2.0

Bumped from 0.1.1 — the listbox family and the filter organ (R8 + R9); the playground becomes the second app with a real two-tray sidebar.

### Features
- **PanelListbox family (ADR-0070, R8, ede24164)** — `PanelListbox` / `PanelListboxHeader` / `PanelListboxList` / `PanelListboxListItem` join `src/components/`: linked + unlinked modes, `--panel-listbox-*` consumer styling, injectable testids, empty-snippet law. Exported via `index.ts` (47e1194a mirror sync included).
- **PanelListboxFilter (ADR-0071 D1, edbd514d)** — the fifth organ: value + oninput + placeholder/testid, plumbing only.
- **Item href mode (ADR-0071 D2, edbd514d)** — anchor / button / inert renderings; anchors forward the MouseEvent to `onselect` so consumers can preventDefault (W1.5 amendment in 651b0fa9).
- **Header search slot (44ac105c)** — `PanelListboxHeader` gains an optional `search` snippet inside the title container; the five `--panel-listbox-filter-*` tokens join `tokens.css`.

### Consumers
- Playground: two-tray sidebar + journey (b200fb0d), tray filters persisted under `pg-tray-filters` (42972579), case-insensitive matching (084e754d).
- DSI: open-panels + spine + scheduler shelf all consume the family; both hand-drawn filter inputs retired same-commit (651b0fa9).

### Tests
- Package suites grew to 285 (36 files): `panel-listbox.test.ts` (organs + item modes), `panel-listbox-filter.test.ts`, `two-tray-host.test.ts`, `journey-revive.test.ts`, extended `playground-conformance.test.ts`.

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

### 0.1.1 — post-bump additions (recorded 2026-11-17, no version change per operator)

- **SidebarCollapseButton organ** joins the components (R7 W1/W2, ADR-0069): one collapse/restore button for every sidebar; DSI's four sites consume it through the single entry. Commits `05ab491c`, `58ebc025`.
- **Playground chrome fixes**: body margin 0 (phantom scrollbar, `bd36d36c`); restore-btn dressing via :global to reach the organ root (`29d51398`).

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
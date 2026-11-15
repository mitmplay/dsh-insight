# RELEASE — @deepseek-insight/container-base

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

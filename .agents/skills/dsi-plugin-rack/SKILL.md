---
name: dsi-plugin-rack
description: Use when asked to install or uninstall a dsh plugin from the plugins reference (~/.dsi/resources/plugins-reff.md) — dsh-delegated apply via rack.mjs, snapshot-first cache, manifest-recorded removes per the Plugin Rack ADR. Reserved keyword /dsi-plugin-rack.
---

# dsi-plugin-rack

Install and uninstall dsh plugins from the plugins reference (~/.dsi/resources/plugins-reff.md), cached at ~/.dsi/resources/pgr-cache.json. Implements the ADR "The Plugin Rack" (dev/architectural-decission/2026-09/, 2026-09-27).

## Engine

`rack.mjs` — plain Node, JSON on stdout, every payload carries `v: 1`.

```bash
# build snapshot (reuses existing unless --reload)
node rack.mjs refresh [--reload] [--reff PATH] [--cache PATH] [--manifest PATH] [--profile P] [--dsh-cmd CMD]

# dsh-delegated install / remove (D3: never hand-edit the profile)
node rack.mjs apply install 1            # numbers or ids; spec = git+<repo>.git
node rack.mjs apply remove dsh-rules-paths

node rack.mjs snapshot-status
```

## Rules (do not violate)

- **dsh is the writer.** Every install/remove goes through `dsh plugin --profile <p> add|remove` — the profile manifest, its lock, and reconcilePlugins are dsh's. Never write ~/.dsh/profiles/* by hand (D3).
- **The manifest's dependencies are the install authority (D4, amended 2026-09-27).** pnpm records git plugins under the package's OWN scoped name (`@owner/name`), not the reff id — matching is by repo identity (exact id, or the owner/name tail in the dep resolution), and the recorded key is captured as `pkg` and IS the remove target. Bundle entries are a derived hint, never the gate; after dsh reports success the engine re-reads the manifest and DISTRUSTS success it cannot see recorded.
- **Snapshot-first (D3):** refresh reuses an existing cache; only --reload rebuilds. Never delete the cache to force a rebuild.
- **Gates surface, never auto-clear (D6):** allowBuilds and version-approval failures relay dsh's own diagnostics verbatim; the operator unlocks, then retries.
- **Uninstall only what the manifest records AND the reff lists** — hand-added packages (e.g. the OV plugin) are invisible to the rack.
- Tests MUST use --reff + --cache + --manifest + --dsh-cmd fixture overrides — never the real home directories.

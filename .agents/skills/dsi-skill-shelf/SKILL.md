---
name: dsi-skill-shelf
description: Use when asked to install or uninstall agent skills from the SKR reference (~/.dsi/resources/skills-reff.md) — signed installs and signature-gated uninstalls via shelf.mjs, unstable tier opt-in, collision abort, per the Skill Shelf ADR. Reserved keyword /dsi-skill-shelf.
---

# dsi-skill-shelf

Install and uninstall agent skills from the SKR reference (`~/.dsi/resources/skills-reff.md`). Implements the ADR 'The Skill Shelf' (dev/architectural-decission/2026-09/, 2026-09-20).

## Engine

`shelf.mjs` — plain Node, JSON on stdout, every payload carries `v: 1`.

```bash
# build snapshot (reuses existing unless --reload)
node shelf.mjs refresh [--reload] [--skr PATH] [--cache PATH] [--skills-dir PATH] [--fixture-root PATH]

# signed install / uninstall
node shelf.mjs apply install 1.1 3.1-3.3        # numbers resolved by the caller; engine takes explicit targets
node shelf.mjs apply install 2.30 --allow-unstable   # in-progress tier is opt-in (D6)
node shelf.mjs apply uninstall <skill-id>       # refuses unsigned folders (D5)

node shelf.mjs snapshot-status                  # does the cache exist?
```

## Rules (do not violate)

- **No signature, no uninstall.** The engine hard-refuses to remove any folder without a valid `.dsi-provenance.json` (D5). Never work around this with rm.
- **No folder without signature.** A failed install cleans up its own folder (D4).
- **Snapshot-first (D3):** `refresh` reuses an existing cache; only `--reload` rebuilds. Never delete the cache to force a rebuild — pass `--reload`.
- **Unstable tiers (D6):** in-progress/deprecated skills install only with explicit `--allow-unstable`.
- **Collisions:** an existing folder aborts the install unless `--force`.
- Tests MUST use `--fixture-root` + `--cache` + `--skills-dir` overrides — never touch the real home directories from a test.


## Translate at install (The Shelf Voice ADR, D4)

An install SHOULD carry a voice: pass `--voice '<json>'` with the skill's name,
description and whenToUse TRANSLATED BY YOU (the installing agent) into the
operator's locales (en + zh/id/es as appropriate):

```bash
node shelf.mjs apply install 1.2 --voice '{"zh":{"name":"技能","description":"…","whenToUse":"…"},"id":{…}}'
```

Rules: translate faithfully, never invent behavior; keep `name` short; an
invalid payload degrades the install to en-only (never a blocker); `en` is
always written as the scaffold. Uninstall removes the voice with the folder.
## Shelf numbering

1.x pstack (47), 2.x mattpocock (38: engineering 2.1-2.18, productivity 2.19-2.25, misc 2.26-2.29, in-progress 2.30-2.38), 3.x superpowers (15).
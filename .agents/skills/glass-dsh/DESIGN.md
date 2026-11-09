# glass-dsh — short design (approved 2026-11-09)

**Intent.** One skill that owns the creator-mode verification loop for a new DSH
web-UI plugin: install → probe → real gestures → persistence → restore, ending in
a gate report the operator can trust. Plugin craft stays in the harness's
`cordis-plugin-development` skill.

**Approaches considered** (operator decision 2026-11-09, recorded in ADR-0045
Amendment 6 D12–D15):
- *Full creator loop* (chosen) vs verification-only half — the operator picked the loop.
- *Own driver scripts* (chosen) vs reusing glass-dsi's `_connect.mjs` — decoupling beats
  shared-drift risk at this size (accepted duplication, D1/D12 give-up).
- *Repo `skills/` folder* (chosen, operator override) + `~/.agents/skills/` mirror for
  the slash menu — same pattern as every DSI skill.
- *Probe-then-env port resolution* (chosen, D13): `--dsh-url`/`--dsh-port` argument >
  `DSH_PORT` env > default `3080`; CLI `--port` applies at boot, so the env/arg the agent
  sees is authoritative — stated first in SKILL.md.

**Goals.** Five machine-checkable gates (console baseline, origin tab pick, real
gestures with control assertions, localStorage persistence, state restore) runnable
against any slot-rendering DSH plugin with plugin-supplied selectors.

**Non-goals.** No plugin authoring; no DSI-surface verification (glass-dsi); no
foreign URLs (glass-url); no changes to sibling glass skills; no synthetic-event
"testing" (D15); no state files (the floor registry is the only truth, ADR-0030).

**Constraints.** playwright-core resolves only from the DSI repo root; the glass
session is claimed by harness-session identity or refused loudly (D7); a failing
gate ends the run with a report (D11 stop-loss).

**Left to the builder.** Per-plugin selectors and store keys come from the plugin's
own client module; the gesture composition (which verbs, which order) is the
calling agent's judgment inside the gates.

**Status:** built and gate-verified on the live sticky-notes plugin 2026-11-09 —
see completion notes in the spec folder.

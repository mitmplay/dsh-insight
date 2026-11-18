/**
 * Panel-kind registry — the mechanism that lets a host declare its panel
 * kinds ONCE and derive every kind-blind loop from those declarations
 * (ADR-0065: the three-switch-site law dies here). Pure addition: no
 * consumer is wired in this wave — DSI's declarations land in its own
 * Wave 3, the playground in Wave 4.
 *
 * Layering (ADR-0065 D4/D5):
 * - declarations are DATA: they never import host config; a clamp band
 *   reaches the host's settings only as a LAZY resolver — () => band —
 *   so a resolver evaluated before settings load cannot pin stale bounds.
 * - spawn factories stay host-side forever; nothing here spawns a panel.
 */
/** The panel-kind registry's registration door: validate the declaration
 * shape once and freeze it. A consumer writes ONE of these per kind —
 * the ergonomic entry ADR-0065 names (kind #11 is one declaration + one
 * spawn factory). */
export function definePanelKind(declaration) {
    if (typeof declaration.kind !== 'string' || declaration.kind.length === 0) {
        throw new Error('definePanelKind: kind must be a non-empty string');
    }
    if (typeof declaration.revive !== 'function' || typeof declaration.requiredKeys !== 'function') {
        throw new Error('definePanelKind: revive and requiredKeys are required functions');
    }
    if (typeof declaration.band !== 'function') {
        throw new Error('definePanelKind: band must be a lazy () => ({ min, max }) resolver (D5)');
    }
    return Object.freeze({ ...declaration });
}
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Apply the knob declarations to one revived panel (junk → default, valid → clamped). */
function applyKnobs(panel, knobs) {
    for (const knob of knobs) {
        const v = panel[knob.key];
        const valid = knob.validate ? knob.validate(v) : typeof v === 'number' && Number.isFinite(v);
        panel[knob.key] = valid
            ? knob.clamp
                ? knob.clamp(v)
                : v
            : knob.default;
    }
    return panel;
}
/**
 * Revive a blob's panel entries through the declarations.
 * Drop rules, in order: non-object entry; unknown kind string; kind
 * declared persisted:false (D6); failed requiredKeys; revive returns
 * null/throws. Survivors get the knob defaults/clamps applied.
 */
export function revivePanels(raw, declarations, knobs = [], hooks) {
    const byKind = new Map(declarations.map((d) => [d.kind, d]));
    const entries = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw['panels']) ? raw['panels'] : [];
    const panels = [];
    let dropped = 0;
    for (const entry of entries) {
        if (!isPlainObject(entry) || typeof entry['kind'] !== 'string') {
            dropped++;
            continue;
        }
        const decl = byKind.get(entry['kind']);
        if (!decl || decl.persisted === false || !decl.requiredKeys(entry)) {
            dropped++;
            continue;
        }
        let panel;
        try {
            panel = decl.revive(entry);
        }
        catch {
            panel = null;
        }
        if (panel === null || panel === undefined) {
            dropped++;
            continue;
        }
        panels.push(applyKnobs(panel, knobs));
    }
    const result = { panels, dropped };
    if (hooks && 'rawSelectedId' in hooks && hooks.crossCheckSelected) {
        result.selected = hooks.crossCheckSelected(hooks.rawSelectedId, panels);
    }
    return result;
}
/**
 * deskEntries — the WRITE-side counterpart of revivePanels (R10, operator
 * 2026-11-19): builds the persisted entry array from the LIVE state, so
 * consumers never hand-copy the blob shape the revive grammar demands
 * (universal required keys id + kind; width optional). Every persist site
 * — width commits, zoom commits, AND pure selection changes — goes through
 * this one builder, which is what makes "selection survives reload" hold:
 * a consumer that only persisted on width commits shipped the exact
 * selection-reverts-on-refresh bug this closes.
 */
export function deskEntries(args) {
    return args.panels.map((panel, i) => {
        const width = args.widths?.[i];
        return {
            id: panel.id,
            kind: args.kind,
            ...(width === undefined ? {} : { width }),
            journey: args.journey(panel)
        };
    });
}
/**
 * Clamp a width through a kind's band — the LAZY resolver is evaluated
 * HERE, at clamp time, never earlier (D5).
 */
export function clampKindWidth(width, declaration) {
    const { min, max } = declaration.band();
    return Math.min(max, Math.max(min, width));
}
/**
 * Apply a preset width across panels — only kinds flagged
 * resizableByPreset join the sweep, each through its OWN band. Today's
 * DSI parity: only 'conversation' is flagged (Tasks 3.2).
 * Returns a new array; untouched panels keep identity.
 */
export function resizeAllByRegistry(panels, width, declarations) {
    const byKind = new Map(declarations.map((d) => [d.kind, d]));
    return panels.map((panel) => {
        const decl = byKind.get(panel.kind);
        if (!decl || decl.resizableByPreset !== true)
            return panel;
        return { ...panel, width: clampKindWidth(width, decl) };
    });
}

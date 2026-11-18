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

/** A clamp band, resolved lazily so settings can load first (D5). */
export interface WidthBand {
	min: number;
	max: number;
}

/**
 * One panel kind's whole contract. The host writes one of these per kind;
 * every registry loop below reads only these.
 * persisted/resizableByPreset are opt-OUT flags with the safe defaults
 * (persist: true, resizableByPreset: FALSE) so an omitted flag can never
 * silently widen behavior (ADR-0030 A4 keeps the browser kind out of the
 * blob by declaration, not by if/else).
 */
export interface PanelKindDeclaration<P = unknown> {
	/** The storage kind string — the registry lookup key. */
	kind: string;
	/** Gate: does this raw entry carry the keys this kind requires? */
	requiredKeys: (entry: Record<string, unknown>) => boolean;
	/** Rebuild the typed panel from a raw entry; null/throw = drop. */
	revive: (entry: Record<string, unknown>) => P | null;
	/** The kind lane's default width (used by the host's default ladder). */
	laneDefaultWidth: number;
	/** LAZY band resolver — evaluated at clamp time, never at declaration (D5). */
	band: () => WidthBand;
	/** default true; false = the kind is never revived from the blob (D6). */
	persisted?: boolean;
	/** default FALSE; true = the kind joins resizeAllByRegistry sweeps. */
	resizableByPreset?: boolean;
}

/** One persistent knob on a panel: junk → default, valid → clamped. */
export interface KnobDeclaration {
	key: string;
	default: number;
	/** Final clamp applied to a valid value (the kind's own band, host-side). */
	clamp?: (v: number) => number;
	/** Numeric gate; omit to accept any finite number. Junk → default. */
	validate?: (v: unknown) => boolean;
}

/** Optional cross-entry hooks (e.g. D3: a dangling selectedPanelId → first survivor). */
export interface ReviveHooks {
	/** The raw selected-id value from the blob, untouched. */
	rawSelectedId?: unknown;
	/** Resolve the surviving selection from the raw value + revived panels. */
	crossCheckSelected?: (rawSelectedId: unknown, panels: { id: string }[]) => unknown;
}

export interface ReviveResult<P> {
	panels: P[];
	/** The cross-checked selection, when hooks supplied it; else undefined. */
	selected?: unknown;
	/** How many raw entries were dropped (diagnostics, not behavior). */
	dropped: number;
}

/** The panel-kind registry's registration door: validate the declaration
 * shape once and freeze it. A consumer writes ONE of these per kind —
 * the ergonomic entry ADR-0065 names (kind #11 is one declaration + one
 * spawn factory). */
export function definePanelKind<P>(declaration: PanelKindDeclaration<P>): PanelKindDeclaration<P> {
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Apply the knob declarations to one revived panel (junk → default, valid → clamped). */
function applyKnobs<P extends Record<string, unknown>>(panel: P, knobs: readonly KnobDeclaration[]): P {
	for (const knob of knobs) {
		const v = panel[knob.key];
		const valid = knob.validate ? knob.validate(v) : typeof v === 'number' && Number.isFinite(v);
		(panel as Record<string, unknown>)[knob.key] = valid
			? knob.clamp
				? knob.clamp(v as number)
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
export function revivePanels<P>(
	raw: unknown,
	declarations: readonly PanelKindDeclaration<P>[],
	knobs: readonly KnobDeclaration[] = [],
	hooks?: ReviveHooks
): ReviveResult<P> {
	const byKind = new Map(declarations.map((d) => [d.kind, d]));
	const entries = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw['panels']) ? (raw['panels'] as unknown[]) : [];
	const panels: P[] = [];
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
		let panel: P | null;
		try {
			panel = decl.revive(entry);
		} catch {
			panel = null;
		}
		if (panel === null || panel === undefined) {
			dropped++;
			continue;
		}
		panels.push(applyKnobs(panel as P & Record<string, unknown>, knobs));
	}
	const result: ReviveResult<P> = { panels, dropped };
	if (hooks && 'rawSelectedId' in hooks && hooks.crossCheckSelected) {
		result.selected = hooks.crossCheckSelected(hooks.rawSelectedId, panels as { id: string }[]);
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
export function deskEntries<P extends { id: string }>(args: {
	/** The kind label every entry carries (the declaration's kind). */
	kind: string;
	/** The live pane set in SAVE ORDER (the array order is persisted). */
	panels: readonly P[];
	/** Live width per pane, index-aligned with panels; undefined omits the key (the knob's default wins at revive). */
	widths?: readonly (number | undefined)[];
	/** The live journey per pane — the persisted tray-membership fact. */
	journey: (panel: P) => string;
}): { id: string; kind: string; width?: number; journey: string }[] {
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
export function clampKindWidth(width: number, declaration: PanelKindDeclaration): number {
	const { min, max } = declaration.band();
	return Math.min(max, Math.max(min, width));
}

/**
 * Apply a preset width across panels — only kinds flagged
 * resizableByPreset join the sweep, each through its OWN band. Today's
 * DSI parity: only 'conversation' is flagged (Tasks 3.2).
 * Returns a new array; untouched panels keep identity.
 */
export function resizeAllByRegistry<P extends { kind: string }>(
	panels: readonly P[],
	width: number,
	declarations: readonly PanelKindDeclaration[]
): P[] {
	const byKind = new Map(declarations.map((d) => [d.kind, d]));
	return panels.map((panel) => {
		const decl = byKind.get(panel.kind);
		if (!decl || decl.resizableByPreset !== true) return panel;
		return { ...panel, width: clampKindWidth(width, decl) } as P;
	});
}

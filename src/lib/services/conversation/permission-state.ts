/**
 * permission-state — the session's access mode, folded from the ledger
 * (ADR-0007, 2026-08-25). Pure mapping, no I/O, no Svelte: the same
 * functions run server-side (cold load, poll deltas) and client-side
 * (store accumulation).
 *
 * DSH parity (the read side is the harness's own projection rule —
 * packages/interaction/permission-presets/src/index.ts): every mode
 * change is three whole-value knob events in the session log —
 *
 *   permission/preset  data.preset  — "the user picked preset X"
 *   sandbox/mode       data.mode    — "the sandbox knob is now Y"
 *   approval/policy    data.policy  — "the approval knob is now Z"
 *
 * — and the current mode derives by the fold: the last picked preset
 * wins while its knobs still agree; otherwise the table entry matching
 * both knobs; otherwise `custom`. The host ships the resolved value on
 * the history TAIL page's projections block (`permissions` →
 * {currentValue} — options live in DSH's process catalog, never on this
 * wire; 2026-09-16 live probe) — DSI reads that as the authoritative
 * baseline, serves its local table as the menu, and refolds knob events
 * locally for the deltas.
 *
 * Known divergence (priced in ADR-0007 R6): the local preset table is
 * the shipped trio; a deployment-configured table still works — its
 * events arrive, `permissionFromProjection` carries its options verbatim
 * when the projections block is present, and unknown preset names
 * degrade to raw labels (never a guess, never a crash). `resolvePermission`
 * treats an UNKNOWN knob (null) as no basis to resolve: a partial triple
 * that matches nothing returns undefined and the projections baseline
 * stands, where DSH's host-side fold knows its composition defaults.
 */

import type { DshRawEvent } from './dsh-events';

/** One menu option the chip renders (host wire shape, labels sugared). */
export interface DsiPresetOption {
	/** Stable option value: the preset table key (`custom` is filtered on ingest). */
	value: string;
	/** Display label — Title Case, or the pinned `Full access` product label. */
	label: string;
	/** One user-facing sentence on what the preset means; omitted when unknown. */
	description?: string;
}

/** The chip's whole read state: the effective mode + the switchable options. */
export interface DsiPermission {
	/** The effective current value: a preset key, or `custom`. */
	current: string;
	/** Switchable presets in table order; NEVER contains `custom`. */
	options: DsiPresetOption[];
}

/** One preset table entry: the knob bundle + presentation (DSH PresetSpec). */
interface PresetSpec {
	sandbox: string;
	approval: string;
	label: string;
	description: string;
}

/** The derived not-a-preset state (read-only label; never a switch target). */
export const CUSTOM_PRESET = 'custom';
/** The machine name whose product label is pinned to `Full access`. */
export const FULL_ACCESS_PRESET = 'danger-full-access';

/**
 * The shipped preset table (bundle/base/cordis.patch.yml — the default
 * composition, not the law; see the module header's divergence note).
 */
export const PRESET_TABLE: Readonly<Record<string, PresetSpec>> = {
	'read-only': {
		sandbox: 'read-only',
		approval: 'ask',
		label: 'Read Only',
		description: 'Read files and run nothing that changes state; every action beyond reading requires approval.'
	},
	'workspace-write': {
		sandbox: 'workspace-write',
		approval: 'ask',
		label: 'Workspace Write',
		description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.'
	},
	[FULL_ACCESS_PRESET]: {
		sandbox: 'danger-full-access',
		approval: 'never',
		label: 'Full access',
		description: 'Full file access without approval prompts.'
	}
};

/** Label transform (DSH PermissionSelect parity): kebab-case → Title Case,
 *  the pinned product labels, and raw pass-through for unknown names. */
export function presetLabel(name: string): string {
	if (name === FULL_ACCESS_PRESET) return 'Full access';
	if (name === CUSTOM_PRESET) return 'Custom';
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
	return name
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/** Description lookup — local table only; unknown presets carry none. */
export function presetDescription(name: string): string | undefined {
	return PRESET_TABLE[name]?.description;
}

/** The three knob event types (SILENT_TYPES members — transcript noise,
 *  chip signal). */
const KNOB_TYPES: ReadonlySet<string> = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);

/** The projection unit's state: last seen value of each knob event (DSH KnobState). */
export interface KnobState {
	preset: string | null;
	sandbox: string | null;
	approval: string | null;
}

export const EMPTY_KNOBS: KnobState = { preset: null, sandbox: null, approval: null };

/** One-event knob transition; the SAME reference when the event is not a
 *  knob (the registry's change gate — DSH applyKnobEvent parity). */
export function applyKnobEvent(state: KnobState, event: DshRawEvent): KnobState {
	switch (event.type) {
		case 'permission/preset': {
			const preset = event.data?.preset;
			if (typeof preset !== 'string') return state;
			return { ...state, preset };
		}
		case 'sandbox/mode': {
			const mode = event.data?.mode;
			if (typeof mode !== 'string') return state;
			return { ...state, sandbox: mode };
		}
		case 'approval/policy': {
			const policy = event.data?.policy;
			if (typeof policy !== 'string') return state;
			return { ...state, approval: policy };
		}
		default:
			return state;
	}
}

/** Fold a whole event window's knob events into one state (log order). */
export function foldKnobs(events: readonly DshRawEvent[]): KnobState {
	let state = EMPTY_KNOBS;
	for (const event of events) state = applyKnobEvent(state, event);
	return state;
}

/** Filter an event window down to its knob events (poll/payload carrier). */
export function filterKnobEvents(events: readonly DshRawEvent[]): DshRawEvent[] {
	return events.filter((e) => KNOB_TYPES.has(e.type));
}

/**
 * Derive the current mode from one folded knob state. Undefined = no
 * basis to resolve (all-null, or a partial triple that matches nothing)
 * — the caller keeps its projections baseline. A KNOWN mismatch of both
 * knobs resolves `custom` exactly when DSH's fold would.
 */
export function resolvePermission(knobs: KnobState): string | undefined {
	const { preset, sandbox, approval } = knobs;
	if (preset === null && sandbox === null && approval === null) return undefined;
	// Last picked preset wins while no known knob contradicts its bundle.
	if (preset !== null) {
		const spec = PRESET_TABLE[preset];
		if (
			spec !== undefined &&
			(sandbox === null || sandbox === spec.sandbox) &&
			(approval === null || approval === spec.approval)
		) {
			return preset;
		}
	}
	// Both knobs known: the matching entry, or the honest not-a-preset state.
	if (sandbox !== null && approval !== null) {
		const entry = Object.entries(PRESET_TABLE).find(
			([name, spec]) => spec.sandbox === sandbox && spec.approval === approval
		);
		return entry?.[0] ?? CUSTOM_PRESET;
	}
	return undefined;
}

/**
 * Ingest the host's `permissions` projection value (the history tail
 * page's projections block) into the chip's read state. Structural and
 * conservative: a malformed member declines to undefined (the chip
 * hides — never renders a guessed mode). `custom` is filtered from the
 * options (readable as current, never switchable) and labels are sugared
 * through the pinned transform.
 */
export function permissionFromProjection(raw: unknown): DsiPermission | undefined {
	const v = raw as { options?: unknown; currentValue?: unknown } | undefined;
	if (v === null || typeof v !== 'object' || typeof v.currentValue !== 'string') {
		return undefined;
	}
	// Wire truth (2026-09-16 live probe): the host's PermissionSelection is
	// { currentValue } ONLY — DSH joins its process catalog client-side
	// (ui-permission-presets optionsOf) and never ships options in the
	// projection. When options are absent, serve the shipped local table
	// (ADR-0007's priced divergence: local trio in table order) so the chip
	// renders from the host's authoritative current value. When the host
	// DOES ship options, they stay authoritative and keep the strict ingest.
	let options: DsiPresetOption[];
	if (Array.isArray(v.options)) {
		options = [];
		for (const o of v.options) {
			const opt = o as { value?: unknown; name?: unknown; description?: unknown };
			if (typeof opt?.value !== 'string' || opt.value.length === 0) continue;
			if (opt.value === CUSTOM_PRESET) continue;
			const label = typeof opt.name === 'string' && opt.name.length > 0 ? opt.name : opt.value;
			options.push({
				value: opt.value,
				label: presetLabel(label),
				...(typeof opt.description === 'string' && opt.description.length > 0 ? { description: opt.description } : {})
			});
		}
		if (options.length === 0) return undefined;
	} else {
		options = localPermission().options;
	}
	return { current: v.currentValue, options };
}

/** Local read state from the shipped table (fallback when the host ships
 *  no projections block but knob events exist — the shipped trio in
 *  table order, defaulting to the composition default). */
export function localPermission(): DsiPermission {
	return {
		current: 'workspace-write',
		options: Object.entries(PRESET_TABLE).map(([value, spec]) => ({
			value,
			label: spec.label,
			description: spec.description
		}))
	};
}

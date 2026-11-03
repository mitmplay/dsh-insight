/**
 * key-chords.ts — the Alt+S width-preset chord machine (ADR-0006a).
 *
 * A PURE reducer: every transition is (state, event, facts) -> { state,
 * action }. No DOM, no stores, no timers — the caller owns the clock
 * (now) and the wiring (which element heard the key). This is what makes
 * the chord unit-testable to every branch, and keeps the route keydown
 * listener a three-line adapter.
 *
 * Grammar: press-and-release Alt+S arms a CHORD_WINDOW_MS window; a
 * following digit 1..9 fires { apply, n }; any other key or the window
 * expiring disarms. Alt+S never arms when the floor has no presets (D4:
 * silent absence — the feature gates itself).
 */

export const CHORD_WINDOW_MS = 2_000;

export interface ChordState {
	/** True between the Alt+S release and the digit / disarm. */
	armed: boolean;
	/** Date.now() of the arming keyup — the window clock. */
	since: number;
}

export const IDLE_CHORD: ChordState = { armed: false, since: 0 };

export type ChordVerb = 'a' | 'b' | 'c' | 'g' | 'k' | 'n' | 'p' | 's' | 't' | 'w';

/** Verb → label (the palette renders these; D16). */
export const CHORD_VERB_LABELS: Record<ChordVerb, string> = {
	a: 'Close agent extras (terminals + sub-agents + explorers)',
	b: 'Close all glass browsers',
	g: 'Toggle plugin manager',
	k: 'Toggle skill manager',
	c: 'Close config explorers',
	n: 'New session, same agent + workspace',
	p: 'Toggle prompt manager',
	s: 'Toggle sidebar',
	t: 'Toggle terminal',
	w: 'Close workspace explorers'
};

export type ChordAction =
	| { type: 'none' }
	| { type: 'disarm' }
	| { type: 'apply'; n: number }
	| { type: 'verb'; verb: ChordVerb };

/** Minimal key shape the wiring feeds in (a real KeyboardEvent fits). */
export interface ChordKey {
	key: string;
	/** PHYSICAL key identity — the layout-independent match site. The live
	 *  bug (operator report 2026-10-29): on macOS holding Alt remaps letters
	 *  (Option+S types key='ß'), so e.key matching never armed on a real
	 *  keyboard while every Playwright probe (synthetic key='s') passed.
	 *  Match e.code; key stays as the no-code fallback. */
	code?: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	/** string, not the union — a real KeyboardEvent.type IS a string and
	 *  the wiring passes the event whole (no lossy adapter). */
	type: string;
}

/** True when the chord can arm at all — any preset slot on any lane. */
export function hasAnyPreset(p: {
	agent: Record<number, unknown>;
	glass: Record<number, unknown>;
	sidebar: Record<number, unknown>;
	zoom?: Record<number, unknown>;
}): boolean {
	return (
		Object.keys(p.agent).length > 0 ||
		Object.keys(p.glass).length > 0 ||
		Object.keys(p.sidebar).length > 0 ||
		Object.keys(p.zoom ?? {}).length > 0
	);
}

/** Is the event target an editable surface? The wiring calls this FIRST —
 *  typing "1" in the composer must never fire a preset (AC 4). */
export function isEditableTarget(t: unknown): boolean {
	const el = t as { closest?: (sel: string) => unknown } | null;
	if (!el || typeof el.closest !== 'function') return false;
return el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') != null;
}

/** One key event through the machine. now is injectable for tests.
 *
 *  ARM ON KEYDOWN — the live-glass lesson (2026-10-29): svelte:window's
 *  onkeydown NEVER sees keyup events, so an arm-on-keyup rule is
 *  unreachable. Keyups pass through untouched: releasing Alt+S must not
 *  eat the chord it just armed. */
export function chordKey(
	state: ChordState,
	ev: ChordKey,
	canArm: boolean,
	now: number = Date.now()
): { state: ChordState; action: ChordAction } {
	const key = ev.key.toLowerCase();

	if (ev.type === 'keyup') return { state, action: { type: 'none' } };

	// PHYSICAL identity: code='KeyS' survives the macOS Alt remap (key='ß');
	// key==='s' stays as the fallback for events that carry no code.
	const isS = ev.code === 'KeyS' || (key === 's' && !ev.code);
	// Digits: Digit1..9 first (matches even with Alt still held), key fallback.
	const digit = /^Digit([1-9])$/.exec(ev.code ?? '')?.[1] ?? (/^[1-9]$/.test(ev.key) ? ev.key : null);

	// Arming: a clean Alt+S keydown (no ctrl/meta — those are browser verbs).
	if (isS && ev.altKey && !ev.ctrlKey && !ev.metaKey) {
		if (!canArm) return { state, action: { type: 'none' } };
		return { state: { armed: true, since: now }, action: { type: 'none' } };
	}

	if (!state.armed) return { state, action: { type: 'none' } };

	// The window expired on this keypress: disarm first, key never counts.
	if (now - state.since > CHORD_WINDOW_MS) {
		return { state: IDLE_CHORD, action: { type: 'disarm' } };
	}

	// A digit fires the preset (the operator taps; we don't grade the phase).
	if (digit) {
		return { state: IDLE_CHORD, action: { type: 'apply', n: Number(digit) } };
	}

	// A verb letter fires its floor action (D14/D15, 2026-10-31). code first
	// — the same physical-identity rule as arming — key fallback after.
	const verb =
		(/^[abcgknpstw]$/.test(ev.key) ? (ev.key as ChordVerb) : undefined) ??
		(/^Key([ABCGKNPSTW])$/.exec(ev.code ?? '')?.[1]?.toLowerCase() as ChordVerb | undefined);
	if (verb) {
		return { state: IDLE_CHORD, action: { type: 'verb', verb } };
	}

	// Any other key disarms.
	return { state: IDLE_CHORD, action: { type: 'disarm' } };
}

export interface ChordOptionRow {
	key: string;
	label: string;
}

/** The live palette rows (D16): derived PURELY from what exists right now.
 *  presets gate the digit lanes (D4), panelKinds (+ subagentCount) gate the
 *  verbs; the p/t toggles are always live — their add path creates the
 *  target. No registry import: the wiring feeds the facts in. */
export function chordOptions(facts: {
	presets: { agent: Record<number, unknown>; glass: Record<number, unknown>; sidebar: Record<number, unknown>; zoom?: Record<number, unknown> };
	panelKinds: string[];
	subagentCount: number;
	/** A conversation panel holds the focus — the n-lane's precondition. */
	focusedConversation: boolean;
}): ChordOptionRow[] {
	const rows: ChordOptionRow[] = [];
	const slots = new Set<number>([
		...Object.keys(facts.presets.agent).map(Number),
		...Object.keys(facts.presets.glass).map(Number),
		...Object.keys(facts.presets.sidebar).map(Number),
		...Object.keys(facts.presets.zoom ?? {}).map(Number)
	]);
	for (const n of [...slots].sort((x, y) => x - y)) rows.push({ key: String(n), label: `Width preset ${n}` });
	const kinds = new Set(facts.panelKinds);
	if (
		kinds.has('terminal') ||
		kinds.has('workspace-explorer') ||
		kinds.has('plugin-rack') ||
		kinds.has('skill-shelf') ||
		facts.subagentCount > 0
	)
		rows.push({ key: 'a', label: CHORD_VERB_LABELS.a });
	if (kinds.has('browser')) rows.push({ key: 'b', label: CHORD_VERB_LABELS.b });
	if (kinds.has('settings-home') || kinds.has('skill-shelf') || kinds.has('plugin-rack'))
		rows.push({ key: 'c', label: CHORD_VERB_LABELS.c });
	rows.push({ key: 'p', label: CHORD_VERB_LABELS.p });
	// g/k are always live like p/t (D25): their add path creates the target.
	rows.push({ key: 'g', label: CHORD_VERB_LABELS.g });
	rows.push({ key: 'k', label: CHORD_VERB_LABELS.k });
	rows.push({ key: 't', label: CHORD_VERB_LABELS.t });
	if (facts.focusedConversation) rows.push({ key: 'n', label: CHORD_VERB_LABELS.n });
	rows.push({ key: 's', label: CHORD_VERB_LABELS.s });
	if (kinds.has('workspace-explorer')) rows.push({ key: 'w', label: CHORD_VERB_LABELS.w });
	// A-Z by key (digits sort before letters) — the operator reads the
	// palette alphabetically, not in lane-registration order.
	return rows.sort((x, y) => x.key.localeCompare(y.key));
}

/** The capture-first decision (D12/D13) as a PURE function so the route
 *  adapter stays three lines and the capture rules unit-test without DOM.
 *  Ordering IS the contract: (1) a clean Alt+S keydown captures everywhere;
 *  (2) an armed chord captures the next keydown everywhere; (3) anything
 *  else — including an un-armed digit on an editable target — passes (old
 *  AC4). preventDefault is the swallowing the composer must never see. */
export function decideChordKeydown(
	state: ChordState,
	ev: ChordKey,
	canArm: boolean,
	now: number = Date.now()
): { state: ChordState; action: ChordAction; preventDefault: boolean } {
	const isArmS =
		(ev.code === 'KeyS' || (ev.key.toLowerCase() === 's' && !ev.code)) &&
		ev.altKey &&
		!ev.ctrlKey &&
		!ev.metaKey;
	if (ev.type === 'keydown' && isArmS) {
		return { ...chordKey(state, ev, canArm, now), preventDefault: true };
	}
	if (state.armed && ev.type === 'keydown') {
		return { ...chordKey(state, ev, canArm, now), preventDefault: true };
	}
	return { state, action: { type: 'none' }, preventDefault: false };
}

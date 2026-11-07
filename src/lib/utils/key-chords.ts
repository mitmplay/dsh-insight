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

export type ChordPrefix = 's' | 't';

export interface ChordState {
	/** True between the arming release and the digit / disarm. */
	armed: boolean;
	/** Date.now() of the arming keyup — the window clock. */
	since: number;
	/** Which prefix owns this chord — Alt+S (floor verbs + preset digits)
	 *  or Alt+T (terminal verbs: t new tab, s split down). ADR-0052 D1:
	 *  one reducer, the prefix names the follow-up table. */
	prefix: ChordPrefix;
}

export const IDLE_CHORD: ChordState = { armed: false, since: 0, prefix: 's' };

/** The Alt+T palette rows (ADR-0052 D4, truthful): t is always live (the
 *  add path creates the desk, D3); s only when a desk holds ≥1 tab —
 *  split-down on an empty desk would mint a session and drop it
 *  (TerminalDesk.applyAction's latent empty-desk drop). The layer stays
 *  PURE: labels arrive localized (paraglide m.*) from the render site —
 *  this module never hardcodes copy (i18n, 4 locales). */
export function terminalChordOptions(deskSessionCount: number, labels: Record<'t' | 's' | 'c', string>): ChordOptionRow[] {
	const rows: ChordOptionRow[] = [{ key: 't', label: labels.t }];
	if (deskSessionCount >= 1) rows.push({ key: 's', label: labels.s });
	// The clear verb (2026-11-07): truthful like s — nothing to clear unless
	// the desk renders at least one session (kill + prune + close the tab).
	if (deskSessionCount >= 1) rows.push({ key: 'c', label: labels.c });
	return rows;
}

/** The Alt+T verb → floor action routing (ADR-0052 D3 amendment,
 *  2026-11-07 double-spawn bug): PURE so the page adapter stays thin and
 *  the routing unit-tests without DOM.
 *  - desk live with ≥1 tab: apply the verb directly ('split-down' or
 *    'new-tab') — the single-spawn path.
 *  - closed desk: ADD ONLY — the virgin desk's self-open row IS the new
 *    tab; the old doAdd+tick+applyAction raced the desk ladder and minted
 *    a second session. Split-down additionally waits for the settle
 *    (mirror publishes ≥1 tab) before applying ('add-then-split').
 *  - desk live but 0 tabs (transient restore): the ladder fills it —
 *    'noop'; splitting nothing is a no-op (truthful D4 gating). */
export type TerminalChordPlan =
	| { kind: 'apply'; action: 'new-tab' | 'split-down' }
	| { kind: 'add' }
	| { kind: 'add-then-split' }
	| { kind: 'noop' };

export function resolveTerminalChordPlan(
	verb: 'term-new-tab' | 'term-split-down',
	deskPresent: boolean,
	deskTabCount: number
): TerminalChordPlan {
	if (deskPresent) {
		if (deskTabCount < 1) return { kind: 'noop' };
		return verb === 'term-split-down'
			? { kind: 'apply', action: 'split-down' }
			: { kind: 'apply', action: 'new-tab' };
	}
	return verb === 'term-split-down' ? { kind: 'add-then-split' } : { kind: 'add' };
}

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
	| { type: 'verb'; verb: ChordVerb | 'term-new-tab' | 'term-split-down' | 'term-clear-tab'; prefix: ChordPrefix };

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

	// PHYSICAL identity: code='KeyS'/'KeyT' survives the macOS Alt remap
	// (key='ß'); key==='s'/'t' stays as the fallback for code-less events.
	// ADR-0052 D1: the arming key NAMES the prefix; the prefix owns the
	// follow-up table (s = floor verbs + preset digits, t = terminal verbs).
	const prefix: ChordPrefix | null =
		ev.code === 'KeyS' || (key === 's' && !ev.code)
			? 's'
			: ev.code === 'KeyT' || (key === 't' && !ev.code)
				? 't'
				: null;
	// Digits: Digit1..9 first (matches even with Alt still held), key fallback.
	// Digits are Alt+S lanes only (ADR-0052 D1) — under Alt+T they disarm.
	const digit =
		state.prefix === 's'
			? (/^Digit([1-9])$/.exec(ev.code ?? '')?.[1] ?? (/^[1-9]$/.test(ev.key) ? ev.key : null))
			: null;

	// Arming: a clean Alt+S / Alt+T keydown (no ctrl/meta — browser verbs).
	if (prefix && ev.altKey && !ev.ctrlKey && !ev.metaKey) {
		if (!canArm) return { state, action: { type: 'none' } };
		// D5 (ADR-0052): last prefix wins — an armed chord re-arms cleanly.
		return { state: { armed: true, since: now, prefix }, action: { type: 'none' } };
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
	// ADR-0052 D1: the armed prefix namespaces the letters — Alt+T's table
	// owns only t/s, mapped to the desk's two spawn verbs; any other letter
	// falls through and disarms (the table is truthful, D4).
	const letter =
		(/^[abcgknpstw]$/.test(ev.key) ? ev.key : undefined) ??
		(/^Key([ABCGKNPSTW])$/.exec(ev.code ?? '')?.[1]?.toLowerCase());
	if (letter) {
		if (state.prefix === 't') {
			// The clear verb (2026-11-07): c = kill + prune every session the
			// selected tab renders, close the tab (panel close on the last).
			if (letter === 'c') return { state: IDLE_CHORD, action: { type: 'verb', verb: 'term-clear-tab', prefix: 't' } };
			if (letter !== 't' && letter !== 's') return { state: IDLE_CHORD, action: { type: 'disarm' } };
			return {
				state: IDLE_CHORD,
				action: {
					type: 'verb',
					verb: letter === 't' ? 'term-new-tab' : 'term-split-down',
					prefix: 't'
				}
			};
		}
		return { state: IDLE_CHORD, action: { type: 'verb', verb: letter as ChordVerb, prefix: 's' } };
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
 *  Ordering IS the contract: (1) a clean Alt+S / Alt+T keydown captures
 *  everywhere (ADR-0052 D5);
 *  (2) an armed chord captures the next keydown everywhere; (3) anything
 *  else — including an un-armed digit on an editable target — passes (old
 *  AC4). preventDefault is the swallowing the composer must never see. */
export function decideChordKeydown(
	state: ChordState,
	ev: ChordKey,
	canArm: boolean,
	now: number = Date.now()
): { state: ChordState; action: ChordAction; preventDefault: boolean } {
	const isArm =
		((ev.code === 'KeyS' || (ev.key.toLowerCase() === 's' && !ev.code)) ||
			(ev.code === 'KeyT' || (ev.key.toLowerCase() === 't' && !ev.code))) &&
		ev.altKey &&
		!ev.ctrlKey &&
		!ev.metaKey;
	if (ev.type === 'keydown' && isArm) {
		return { ...chordKey(state, ev, canArm, now), preventDefault: true };
	}
	if (state.armed && ev.type === 'keydown') {
		return { ...chordKey(state, ev, canArm, now), preventDefault: true };
	}
	return { state, action: { type: 'none' }, preventDefault: false };
}

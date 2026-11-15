/**
 * chord-machine — the armed two-stroke keyboard chord reducer (ADR-0006a
 * port; container-base W5, ADR-0062 D5: the MACHINE moves, the PREFIX
 * TABLES stay consumer config).
 *
 * A PURE reducer: every transition is (state, event, facts) -> { state,
 * action }. No DOM, no stores, no timers — the caller owns the clock
 * (now) and the wiring (which element heard the key).
 *
 * Grammar: press-and-release the arming key within CHORD_WINDOW_MS; a
 * digit fires { apply, n }; a verb letter fires { verb } through the
 * consumer's table; any other key or the expiring window disarms.
 *
 * D5 (the consumer-table rule): the machine never learns WHICH letters
 * are verbs or what a terminal prefix maps to — the consumer passes
 * ChordTables. The arming prefixes (Alt+first / Alt+second) and the
 * digit lanes are machine semantics; "the arming key names the prefix;
 * the prefix owns the follow-up table" is the ADR-0052 D1 rule the
 * tables express.
 */

export const CHORD_WINDOW_MS = 2_000;

export type ChordPrefix = 's' | 't';

export interface ChordState {
	/** True between the arming release and the digit / disarm. */
	armed: boolean;
	/** Date.now() of the arming keyup — the window clock. */
	since: number;
	/** Which prefix owns this chord — the prefix names the follow-up table. */
	prefix: ChordPrefix;
}

export const IDLE_CHORD: ChordState = { armed: false, since: 0, prefix: 's' };

export interface ChordOptionRow {
	key: string;
	label: string;
}

export type ChordAction =
	| { type: 'none' }
	| { type: 'disarm' }
	| { type: 'apply'; n: number }
	| { type: 'verb'; verb: string; prefix: ChordPrefix };

/** Minimal key shape the wiring feeds in (a real KeyboardEvent fits). */
export interface ChordKey {
	key: string;
	/** PHYSICAL key identity — the layout-independent match site. Holding
	 *  Alt remaps letters on macOS (Option+S types key='ß'), so e.key
	 *  matching never arms on a real keyboard. Match e.code; key stays as
	 *  the no-code fallback. */
	code?: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	/** string, not the union — a real KeyboardEvent.type IS a string and
	 *  the wiring passes the event whole (no lossy adapter). */
	type: string;
}

/** The consumer's chord tables (D5): WHICH letters are verbs under the
 *  plain prefix, and what the terminal prefix's letters map to. Absence
 *  of a letter in the terminal map disarms; a letter outside `verbs`
 *  disarms. An empty default table keeps the machine neutral — the
 *  consumer's config module owns the real table. */
export interface ChordTables {
	/** Letters that fire `{ type: 'verb', verb: letter }` under the
	 *  plain (first) prefix. */
	verbs: string;
	/** The terminal prefix's letter → verb-name map (a verb name the
	 *  host dispatches; the machine never interprets it). */
	terminal?: Record<string, string>;
	/** Which prefix is the terminal one (default 't'). */
	terminalPrefix?: ChordPrefix;
}

const NO_TABLES: ChordTables = { verbs: '' };

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
 *  typing "1" in a composer must never fire a preset. */
export function isEditableTarget(t: unknown): boolean {
	const el = t as { closest?: (sel: string) => unknown } | null;
	if (!el || typeof el.closest !== 'function') return false;
	return el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') != null;
}

/** One key event through the machine. now is injectable for tests.
 *
 *  ARM ON KEYDOWN — keyup is unreachable through window keydown wiring,
 *  and an arm-on-keyup rule would eat the chord it just armed: keyups
 *  pass through untouched. */
export function chordKey(
	state: ChordState,
	ev: ChordKey,
	canArm: boolean,
	now: number = Date.now(),
	tables: ChordTables = NO_TABLES
): { state: ChordState; action: ChordAction } {
	const key = ev.key.toLowerCase();

	if (ev.type === 'keyup') return { state, action: { type: 'none' } };

	// PHYSICAL identity: code='KeyS'/'KeyT' survives the macOS Alt remap;
	// key==='s'/'t' stays as the fallback for code-less events. The
	// arming key NAMES the prefix; the prefix owns the follow-up table.
	const terminalPrefix = tables.terminalPrefix ?? 't';
	const prefix: ChordPrefix | null =
		ev.code === 'KeyS' || (key === 's' && !ev.code)
			? 's'
			: ev.code === 'KeyT' || (key === 't' && !ev.code)
				? 't'
				: null;
	// Digits: Digit1..9 first (matches even with Alt still held), key
	// fallback. Digits are the FIRST prefix's lanes — under the terminal
	// prefix they disarm (the table is truthful).
	const digit =
		state.prefix === 's'
			? (/^Digit([1-9])$/.exec(ev.code ?? '')?.[1] ?? (/^[1-9]$/.test(ev.key) ? ev.key : null))
			: null;

	// Arming: a clean Alt+<prefix key> keydown (no ctrl/meta — browser verbs).
	if (prefix && ev.altKey && !ev.ctrlKey && !ev.metaKey) {
		if (!canArm) return { state, action: { type: 'none' } };
		// last prefix wins — an armed chord re-arms cleanly.
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

	// A verb letter fires its table action — code first (the same
	// physical-identity rule as arming), key fallback after. The LETTER
	// SETS are the consumer's tables (D5), never this module's.
	const letter =
		(/^[a-z]$/.test(ev.key) ? ev.key : undefined) ??
		(/^Key([A-Z])$/.exec(ev.code ?? '')?.[1]?.toLowerCase());
	if (letter) {
		if (state.prefix === terminalPrefix && tables.terminal) {
			const verb = tables.terminal[letter];
			if (verb === undefined) return { state: IDLE_CHORD, action: { type: 'disarm' } };
			return { state: IDLE_CHORD, action: { type: 'verb', verb, prefix: state.prefix } };
		}
		if (tables.verbs.includes(letter)) {
			return { state: IDLE_CHORD, action: { type: 'verb', verb: letter, prefix: state.prefix } };
		}
		return { state: IDLE_CHORD, action: { type: 'disarm' } };
	}

	// Any other key disarms.
	return { state: IDLE_CHORD, action: { type: 'disarm' } };
}

/** The capture-first decision as a PURE function so the route adapter
 *  stays three lines and the capture rules unit-test without DOM.
 *  Ordering IS the contract: (1) a clean arming keydown captures
 *  everywhere; (2) an armed chord captures the next keydown everywhere;
 *  (3) anything else — including an un-armed digit on an editable
 *  target — passes. preventDefault is the swallowing the composer must
 *  never see. */
export function decideChordKeydown(
	state: ChordState,
	ev: ChordKey,
	canArm: boolean,
	now: number = Date.now(),
	tables: ChordTables = NO_TABLES
): { state: ChordState; action: ChordAction; preventDefault: boolean } {
	const k = ev.key.toLowerCase();
	const isArm =
		((ev.code === 'KeyS' || (k === 's' && !ev.code)) ||
			(ev.code === 'KeyT' || (k === 't' && !ev.code))) &&
		ev.altKey &&
		!ev.ctrlKey &&
		!ev.metaKey;
	if (ev.type === 'keydown' && isArm) {
		return { ...chordKey(state, ev, canArm, now, tables), preventDefault: true };
	}
	if (state.armed && ev.type === 'keydown') {
		return { ...chordKey(state, ev, canArm, now, tables), preventDefault: true };
	}
	return { state, action: { type: 'none' }, preventDefault: false };
}

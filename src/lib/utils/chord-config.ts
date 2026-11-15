/**
 * chord-config — DSI's CHORD TABLES (ADR-0062 W5, D5): the machine lives
 * in @deepseek-insight/container-base; the prefix tables, the verb labels
 * and the kind-gated palette live HERE, in DSI, as config the machine
 * consumes. The machine never learns these letters.
 */
import type { ChordOptionRow, ChordPrefix, ChordTables } from '@deepseek-insight/container-base';

/** DSI's verb letters under the plain (Alt+S) prefix + the Alt+T table
 *  (ADR-0052 D1: the arming key names the prefix; the prefix owns the
 *  follow-up table). */
export const FLOOR_CHORD_TABLES: ChordTables = {
	verbs: 'abcgknpstw',
	terminalPrefix: 't',
	terminal: {
		t: 'term-new-tab',
		s: 'term-split-down',
		// The clear verb (2026-11-07): c = kill + prune the tab's sessions.
		c: 'term-clear-tab'
	}
};

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

/** The Alt+T palette rows (ADR-0052 D4, truthful): t is always live (the
 *  add path creates the desk, D3); s only when a desk holds ≥1 tab —
 *  split-down on an empty desk would mint a session and drop it. The
 *  layer stays PURE: labels arrive localized from the render site. */
export function terminalChordOptions(deskSessionCount: number, labels: Record<'t' | 's' | 'c', string>): ChordOptionRow[] {
	const rows: ChordOptionRow[] = [{ key: 't', label: labels.t }];
	if (deskSessionCount >= 1) rows.push({ key: 's', label: labels.s });
	if (deskSessionCount >= 1) rows.push({ key: 'c', label: labels.c });
	return rows;
}

/** The Alt+T verb → floor action routing (ADR-0052 D3 amendment,
 *  2026-11-07 double-spawn bug): PURE so the page adapter stays thin.
 *  - desk live with ≥1 tab: apply the verb directly.
 *  - closed desk: ADD ONLY — the virgin desk's self-open row IS the new
 *    tab; split-down additionally waits for the settle ('add-then-split').
 *  - desk live but 0 tabs (transient restore): 'noop'. */
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

/** The live palette rows (D16): derived PURELY from what exists right
 *  now — the DSI kind table gates the verbs; presets gate the digits.
 *  No registry import: the wiring feeds the facts in. */
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
	rows.push({ key: 'g', label: CHORD_VERB_LABELS.g });
	rows.push({ key: 'k', label: CHORD_VERB_LABELS.k });
	rows.push({ key: 't', label: CHORD_VERB_LABELS.t });
	if (facts.focusedConversation) rows.push({ key: 'n', label: CHORD_VERB_LABELS.n });
	rows.push({ key: 's', label: CHORD_VERB_LABELS.s });
	if (kinds.has('workspace-explorer')) rows.push({ key: 'w', label: CHORD_VERB_LABELS.w });
	// A-Z by key — the operator reads the palette alphabetically.
	return rows.sort((x, y) => x.key.localeCompare(y.key));
}

export type { ChordPrefix };

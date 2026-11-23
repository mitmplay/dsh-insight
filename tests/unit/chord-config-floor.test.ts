import { describe, expect, it } from 'vitest';
import { chordOptions } from '$lib/utils/chord-config';

/**
 * chord-config floor pins (src/lib/utils/chord-config.ts) — the ONE arm the
 * sibling suite (tests/unit/width-preset-chord.test.ts) never reaches:
 *
 *  - L93 `[...slots].sort((x, y) => x - y)` — the preset-slot comparator.
 *    Every sibling call carries at most ONE distinct slot (agent: {2: 808},
 *    or every lane empty), and Array.prototype.sort never consults its
 *    comparator on a 0- or 1-element array — so that function is never
 *    invoked anywhere in the suite. The condition that reaches it is
 *    ≥ 2 DISTINCT slots across the four lanes (L87-92: agent, glass,
 *    sidebar, zoom merged through one Set).
 *
 * What the operator sees (L86-93): every lane's slots fold into ONE list,
 * each slot rendered exactly once as `Width preset <n>` (a slot two lanes
 * both configure is still ONE row — the Set dedupes), every lane
 * contributing the slots it alone owns, in ascending slot
 * order whatever order the lanes arrived in, ahead of the letter verbs
 * (the L114 A-Z pass: digits sort before letters).
 *
 * Evidence for the lead — NOT pinnable from the return value: the NUMERIC
 * nature of `x - y` is shadowed. L114 re-sorts every row by its string key
 * with localeCompare, and keys are unique after the Set dedupe, so that
 * final pass is a total order that does not depend on the comparator's
 * work (e.g. slots 2 and 10 come back '10','2' either way). A regression of
 * the comparator ALONE cannot change the output; only a product change
 * (dropping the redundant L93 sort) could make it observable. These tests
 * therefore run the arm through real input and pin the behaviour AROUND
 * it (merge, dedupe, labels, order) — they claim nothing about the
 * comparator beyond running cleanly on real input.
 */
describe('chordOptions — the preset-slot comparator arm (chord-config floor)', () => {
	const noPanels = { panelKinds: [], subagentCount: 0, focusedConversation: false };

	it('several slots across lanes: one row per slot, deduped across lanes, ascending, before the verbs', () => {
		const rows = chordOptions({
			...noPanels,
			presets: {
				// Slots arrive out of order; slot 3 is owned by TWO lanes (agent +
				// sidebar) and must still render once, while every lane also owns a
				// slot nobody else carries (9 / 1 / 2 / 4) — drop any lane and this fails.
				agent: { 9: 300, 3: 300 },
				glass: { 1: 100 },
				sidebar: { 2: { state: 'collapse' }, 3: { width: 340 } },
				zoom: { 4: 80 }
			}
		});
		expect(rows.slice(0, 5)).toEqual([
			{ key: '1', label: 'Width preset 1' },
			{ key: '2', label: 'Width preset 2' },
			{ key: '3', label: 'Width preset 3' },
			{ key: '4', label: 'Width preset 4' },
			{ key: '9', label: 'Width preset 9' }
		]);
		expect(rows.map((r) => r.key)).toEqual(['1', '2', '3', '4', '9', 'g', 'k', 'p', 's', 't']);
	});

	it('the threshold: TWO distinct slots in one lane is the smallest input that consults the comparator', () => {
		const rows = chordOptions({ ...noPanels, presets: { agent: { 2: 808, 1: 660 }, glass: {}, sidebar: {} } });
		expect(rows.slice(0, 2)).toEqual([
			{ key: '1', label: 'Width preset 1' },
			{ key: '2', label: 'Width preset 2' }
		]);
		// The digit rows never displace a verb — g/k/p/s/t stay live below them.
		expect(rows.slice(2).map((r) => r.key)).toEqual(['g', 'k', 'p', 's', 't']);
	});
});

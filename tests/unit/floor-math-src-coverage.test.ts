/**
 * floor-math-src-coverage.test.ts — coverage companion for the ROUTE-side
 * src/lib/services/panels/floor-math.ts (the original floor copy: clamps
 * routed through panel-prefs directly, no injected clamp). The existing
 * floor-math.test.ts pins the PACKAGED math
 * (@deepseek-insight/container-base), so the src file sat at 0%: this
 * suite imports the src module DIRECTLY and pins the branches the
 * packaged suite does not reach here — the zero/negative-total guards,
 * negative delta drags, empty inputs, and every movePanelWithin edge.
 */
import { describe, expect, it } from 'vitest';
import {
	isUniformRow,
	movePanelWithin,
	resizeOne,
	scaleProportionally
} from '../../src/lib/services/panels/floor-math';
import type { DsiPanelEntry } from '$lib/types';

function p(id: string, width = 730): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId: 's-' + id, agentPreset: null, width };
}

function widths(panels: readonly DsiPanelEntry[]): number[] {
	return panels.map((x) => x.width);
}

function ids(panels: readonly DsiPanelEntry[]): string[] {
	return panels.map((x) => x.id);
}

describe('resizeOne — src copy (panel-prefs clamp site)', () => {
	const panels = [p('a', 600), p('b', 700)];

	it('changes ONLY the target panel, clamped to the kind band', () => {
		// 600 - 200 = 400 → floor-clamped to 480 (PANEL_MIN_WIDTH)
		expect(widths(resizeOne(panels, [600, 700], 0, -200))).toEqual([480, 700]);
		// 700 + 300 = 1000 → ceiling-clamped to 860 (PANEL_MAX_WIDTH)
		expect(widths(resizeOne(panels, [600, 700], 1, 300))).toEqual([600, 860]);
	});

	it('a zero delta is the identity on widths', () => {
		expect(widths(resizeOne(panels, [600, 700], 0, 0))).toEqual([600, 700]);
	});

	it('the input array is never mutated; entries keep identity', () => {
		const next = resizeOne(panels, [600, 700], 0, 10);
		expect(widths(panels)).toEqual([600, 700]);
		expect(next[1]).toBe(panels[1]);
		expect(next[0]).not.toBe(panels[0]);
	});
});

describe('scaleProportionally — src copy guards', () => {
	it('a zero snapshot total returns an untouched copy (no NaN widths)', () => {
		const panels = [p('a', 0), p('b', 0)];
		const next = scaleProportionally(panels, [0, 0], 100);
		expect(next).not.toBe(panels);
		expect(widths(next)).toEqual([0, 0]);
	});

	it('a NEGATIVE snapshot total also short-circuits (the <= 0 guard)', () => {
		const panels = [p('a', 100), p('b', 200)];
		const next = scaleProportionally(panels, [-150, -50], 999);
		expect(widths(next)).toEqual([100, 200]);
	});

	it('an empty row returns an empty copy', () => {
		expect(scaleProportionally([], [], 50)).toEqual([]);
	});

	it('a positive delta grows both panels inside the band (ratios held)', () => {
		// snapshots 480/480 of 960, delta +40 → each 480 + 20 = 500
		const next = scaleProportionally([p('a', 480), p('b', 480)], [480, 480], 40);
		expect(widths(next)).toEqual([500, 500]);
	});

	it('a negative delta shrinks both panels proportionally', () => {
		// snapshots 600/600 of 1200, delta -200 → each 600 - 100 = 500
		const next = scaleProportionally([p('a', 600), p('b', 600)], [600, 600], -200);
		expect(widths(next)).toEqual([500, 500]);
	});

	it('a saturating drag clamps at the band, not NaN', () => {
		// snapshots 480/480, delta -500 → each lands at the 480 floor
		const next = scaleProportionally([p('a', 480), p('b', 480)], [480, 480], -500);
		expect(widths(next)).toEqual([480, 480]);
	});
});

describe('isUniformRow — src copy', () => {
	it('an empty row is NOT uniform', () => {
		expect(isUniformRow([])).toBe(false);
	});
	it('a single panel is trivially uniform', () => {
		expect(isUniformRow([p('a', 555)])).toBe(true);
	});
	it('all-equal widths are uniform; any mismatch breaks it', () => {
		expect(isUniformRow([p('a', 500), p('b', 500)])).toBe(true);
		expect(isUniformRow([p('a', 500), p('b', 501)])).toBe(false);
	});
});

describe('movePanelWithin — src copy branch matrix', () => {
	const row = [p('a'), p('b'), p('c')];

	it.each([
		['left', ['b', 'a', 'c']],
		['up', ['b', 'a', 'c']],
		['right', ['a', 'c', 'b']],
		['down', ['a', 'c', 'b']]
	] as const)('%s swaps with the neighbor', (dir, expected) => {
		expect(ids(movePanelWithin(row, 'b', dir))).toEqual(expected);
	});

	it('both edges and an unknown id are no-ops returning the input order', () => {
		for (const dir of ['left', 'up'] as const) {
			expect(ids(movePanelWithin(row, 'a', dir))).toEqual(['a', 'b', 'c']);
			expect(ids(movePanelWithin(row, 'c', dir === 'left' ? 'right' : 'down'))).toEqual(['a', 'b', 'c']);
		}
		expect(ids(movePanelWithin(row, 'ghost', 'left'))).toEqual(['a', 'b', 'c']);
	});

	it('never mutates the input; a single-panel row cannot move', () => {
		const next = movePanelWithin(row, 'a', 'right');
		expect(next).not.toBe(row);
		expect(ids(row)).toEqual(['a', 'b', 'c']);
		for (const dir of ['left', 'right', 'up', 'down'] as const) {
			expect(ids(movePanelWithin([p('a')], 'a', dir))).toEqual(['a']);
		}
	});
});

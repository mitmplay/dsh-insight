/**
 * floor-math.test.ts — the remaining pure drag/order math in
 * src/lib/services/panels/floor-math.ts that panel-resize.test.ts does
 * not pin: movePanelWithin (every edge/unknown/dir branch) and
 * scaleProportionally's degenerate zero-total guard.
 */
import { describe, expect, it } from 'vitest';
import {
	isUniformRow,
	movePanelWithin,
	resizeOne,
	scaleProportionally
} from '$lib/services/panels/floor-math';
import type { DsiPanelEntry } from '$lib/types';

function p(id: string, width = 730): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId: 's-' + id, agentPreset: null, width };
}

function ids(panels: readonly DsiPanelEntry[]): string[] {
	return panels.map((x) => x.id);
}

describe('movePanelWithin — swap order math', () => {
	const row = [p('a'), p('b'), p('c')];

	it.each([['left', ['b', 'a', 'c']], ['up', ['b', 'a', 'c']]] as const)(
		'%s swaps with the predecessor',
		(dir, expected) => {
			expect(ids(movePanelWithin(row, 'b', dir))).toEqual(expected);
		}
	);

	it.each([['right', ['a', 'c', 'b']], ['down', ['a', 'c', 'b']]] as const)(
		'%s swaps with the successor',
		(dir, expected) => {
			expect(ids(movePanelWithin(row, 'b', dir))).toEqual(expected);
		}
	);

	it('a move at the LEFT edge (up/left of index 0) is a no-op returning the input order', () => {
		for (const dir of ['left', 'up'] as const) {
			expect(ids(movePanelWithin(row, 'a', dir))).toEqual(['a', 'b', 'c']);
		}
	});

	it('a move at the RIGHT edge (right/down of the last slot) is a no-op', () => {
		for (const dir of ['right', 'down'] as const) {
			expect(ids(movePanelWithin(row, 'c', dir))).toEqual(['a', 'b', 'c']);
		}
	});

	it('an unknown panel id is a no-op (never throws, never reorders)', () => {
		expect(ids(movePanelWithin(row, 'ghost', 'left'))).toEqual(['a', 'b', 'c']);
	});

	it('the result is a fresh array; the input is never mutated, entries keep identity', () => {
		const next = movePanelWithin(row, 'a', 'right');
		expect(next).not.toBe(row);
		expect(ids(row)).toEqual(['a', 'b', 'c']);
		// the swap relocates entries, identity travels with them
		expect(next[0]).toBe(row[1]);
		expect(next[1]).toBe(row[0]);
		expect(next[2]).toBe(row[2]);
	});

	it('a single-panel row cannot move in any direction', () => {
		const solo = [p('a')];
		for (const dir of ['left', 'right', 'up', 'down'] as const) {
			expect(ids(movePanelWithin(solo, 'a', dir))).toEqual(['a']);
		}
	});
});

describe('scaleProportionally — degenerate guards', () => {
	it('a zero snapshot total returns a copy of the input, untouched', () => {
		const panels = [p('a', 0), p('b', 0)];
		const next = scaleProportionally(panels, [0, 0], 100);
		expect(next).not.toBe(panels);
		expect(widthsOf(next)).toEqual([0, 0]);
	});

	it('an empty row (total 0) returns an empty copy', () => {
		expect(scaleProportionally([], [], 50)).toEqual([]);
	});
});

/** width accessor shared by the two describes above. */
function widthsOf(panels: readonly DsiPanelEntry[]): number[] {
	return panels.map((x) => x.width);
}

// Cheap re-pins of the already-covered exports so this file stands alone.
describe('floor-math sanity re-pins', () => {
	it('resizeOne and isUniformRow keep their pinned contracts', () => {
		const panels = [p('a', 600), p('b', 700)];
		expect(widthsOf(resizeOne(panels, [600, 700], 1, 10))).toEqual([600, 710]);
		expect(isUniformRow(panels)).toBe(false);
		expect(isUniformRow([p('a', 500), p('b', 500)])).toBe(true);
		expect(isUniformRow([])).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import {
	isUniformRow,
	movePanelWithin,
	resizeOne,
	scaleProportionally,
	type PaneCore,
	type WidthClamp
} from '../../src/index';

const p = (id: string, width: number, kind?: string): PaneCore => ({ id, width, ...(kind ? { kind } : {}) });
const ids = (row: readonly PaneCore[]) => row.map((r) => r.id);
const widthsOf = (row: readonly PaneCore[]) => row.map((r) => r.width);

/** A bounded clamp mirroring a consumer's config band — proves the clamp
 *  is applied INSIDE the resize math, not bolted on after. */
const bandClamp: WidthClamp = (w, kind) => {
	const max = kind === 'file' ? 1000 : 1200;
	return Math.max(100, Math.min(max, w));
};

describe('resizeOne — plain drag (clamp injected)', () => {
	it('only the pane left of the gutter changes; others untouched', () => {
		const row = [p('a', 600), p('b', 700)];
		expect(widthsOf(resizeOne(row, [600, 700], 1, 10, bandClamp))).toEqual([600, 710]);
		expect(ids(resizeOne(row, [600, 700], 1, 10, bandClamp))).toEqual(['a', 'b']);
	});
	it('the injected clamp bounds the dragged pane', () => {
		const row = [p('a', 780), p('b', 700)];
		expect(widthsOf(resizeOne(row, [780, 700], 0, 500, bandClamp))[0]).toBe(1200);
		const fileRow = [p('f', 900, 'file')];
		expect(widthsOf(resizeOne(fileRow, [900], 0, 500, bandClamp))[0]).toBe(1000);
		expect(widthsOf(resizeOne(fileRow, [900], 0, -5000, bandClamp))[0]).toBe(100);
	});
	it('kind rides through to the clamp (opaque to the module)', () => {
		const seen: Array<string | undefined> = [];
		const spy: WidthClamp = (w, kind) => {
			seen.push(kind);
			return w;
		};
		resizeOne([p('f', 100, 'file')], [100], 0, 5, spy);
		expect(seen).toEqual(['file']);
	});
	it('out-of-range index degrades to a no-op clone (no phantom pane)', () => {
		const row = [p('a', 600)];
		const next = resizeOne(row, [600, 700], 5, 10, bandClamp);
		expect(next).toHaveLength(1);
		expect(next[0].width).toBe(600);
	});
});

describe('scaleProportionally — ratio math (clamp injected)', () => {
	it('preserves ratios until a bound saturates', () => {
		const row = [p('a', 400), p('b', 800)];
		const next = scaleProportionally(row, [400, 800], 120, bandClamp);
		expect(next[0].width).toBe(440);
		expect(next[1].width).toBe(880);
	});
	it('an extreme drag clamps at the band', () => {
		const row = [p('a', 400), p('b', 800)];
		const next = scaleProportionally(row, [400, 800], 100000, bandClamp);
		expect(next.every((n) => n.width <= 1200)).toBe(true);
	});
	it('degenerate totals: zero and negative return the input order untouched', () => {
		const row = [p('a', 500), p('b', 500)];
		const next = scaleProportionally(row, [0, 0], 100, bandClamp);
		expect(widthsOf(next)).toEqual([500, 500]);
		expect(scaleProportionally([], [], 50, bandClamp)).toEqual([]);
	});
});

describe('isUniformRow — honest-slider check', () => {
	it('uniform only when every width equals the first; empty is NOT uniform', () => {
		expect(isUniformRow([p('a', 500), p('b', 500)])).toBe(true);
		expect(isUniformRow([p('a', 500), p('b', 600)])).toBe(false);
		expect(isUniformRow([])).toBe(false);
	});
});

describe('movePanelWithin — swap order math', () => {
	const row = [p('a', 1), p('b', 1), p('c', 1)];
	it('left/up swap with the predecessor', () => {
		expect(ids(movePanelWithin(row, 'b', 'left'))).toEqual(['b', 'a', 'c']);
		expect(ids(movePanelWithin(row, 'b', 'up'))).toEqual(['b', 'a', 'c']);
	});
	it('right/down swap with the successor', () => {
		expect(ids(movePanelWithin(row, 'b', 'right'))).toEqual(['a', 'c', 'b']);
		expect(ids(movePanelWithin(row, 'b', 'down'))).toEqual(['a', 'c', 'b']);
	});
	it('edges and unknown ids are no-ops returning the input order', () => {
		expect(ids(movePanelWithin(row, 'a', 'left'))).toEqual(['a', 'b', 'c']);
		expect(ids(movePanelWithin(row, 'c', 'right'))).toEqual(['a', 'b', 'c']);
		expect(ids(movePanelWithin(row, 'ghost', 'left'))).toEqual(['a', 'b', 'c']);
		expect(ids(movePanelWithin([], 'a', 'left'))).toEqual([]);
	});
	it('selection needs no repair — the pane travels with its id', () => {
		const next = movePanelWithin(row, 'a', 'right');
		expect(next[1].id).toBe('a');
	});
});

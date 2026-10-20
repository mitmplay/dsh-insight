import { describe, expect, it, vi } from 'vitest';

import { containedRect, createMoveCoalescer, scaleFor, scalePoint } from '../../src/lib/components/browser/mirror-input.ts';

describe('mirror-input (D6 scale + rAF coalescing)', () => {
	it('scale = displayed ÷ viewport; null when either size unknown', () => {
		expect(scaleFor(800, 1280)).toBeCloseTo(0.625);
		expect(scaleFor(0, 1280)).toBeNull();
		expect(scaleFor(800, 0)).toBeNull();
	});

	it('scaled click coordinates land in viewport CSS pixels (same-aspect case)', () => {
		// displayed 800x600 of a 1280x960 viewport (same 4:3 aspect → no
		// letterbox): a click at displayed (400, 250) is viewport (640, 400)
		const p = scalePoint(400, 250, 0, 0, 800, 600, 1280, 960);
		expect(p).toEqual({ x: 640, y: 400 });
	});

	it('coalesces N moves in one frame into ONE dispatch, last wins', async () => {
		const fired: Array<{ x: number; y: number }> = [];
		const raf = vi.fn((cb: () => void) => {
			queueMicrotask(cb); // one frame = one microtask drain in the test
			return 1;
		});
		const c = createMoveCoalescer(raf, (x, y) => fired.push({ x, y }));
		c.push(1, 1);
		c.push(2, 2);
		c.push(3, 3);
		// the raf frame drains on a microtask — yield to it before asserting
		await new Promise((r) => setTimeout(r, 0));
		expect(fired).toEqual([{ x: 3, y: 3 }]);
		// a move AFTER the frame schedules a NEW dispatch
		c.push(9, 9);
		await new Promise((r) => setTimeout(r, 0));
		expect(fired).toEqual([{ x: 3, y: 3 }, { x: 9, y: 9 }]);
		expect(raf).toHaveBeenCalledTimes(2);
	});

	it('containedRect returns null when any dimension is zero (letterbox guard)', () => {
		expect(containedRect(0, 0, 0, 600, 1280, 960)).toBeNull();
		expect(containedRect(0, 0, 800, 0, 1280, 960)).toBeNull();
		expect(containedRect(0, 0, 800, 600, 0, 960)).toBeNull();
		expect(containedRect(0, 0, 800, 600, 1280, 0)).toBeNull();
	});

	it('scalePoint returns null when the bounds cannot contain the viewport', () => {
		expect(scalePoint(10, 10, 0, 0, 0, 0, 1280, 960)).toBeNull();
	});

	it('scalePoint returns null for a click on the left/right letterbox bar (x outside)', () => {
		// wide frame, tall viewport → image letterboxes LEFT/RIGHT:
		// contained rect is x ∈ [100, 500), y ∈ [0, 600]
		expect(scalePoint(50, 300, 0, 0, 600, 600, 800, 1200)).toBeNull(); // left bar
		expect(scalePoint(550, 300, 0, 0, 600, 600, 800, 1200)).toBeNull(); // right bar
	});

	it('scalePoint returns null for a click on the top/bottom letterbox bar (y outside)', () => {
		// tall frame, wide viewport → image letterboxes TOP/BOTTOM:
		// contained rect is x ∈ [0, 600), y ∈ [100, 500)
		expect(scalePoint(300, 50, 0, 0, 600, 600, 1200, 800)).toBeNull(); // top bar
		expect(scalePoint(300, 550, 0, 0, 600, 600, 1200, 800)).toBeNull(); // bottom bar
	});

	it('coalescer ignores a spurious frame whose queue is already drained', async () => {
		const fired: Array<{ x: number; y: number }> = [];
		let frame: (() => void) | null = null;
		const raf = (cb: () => void) => {
			frame = cb; // store; do not auto-run
			return 1;
		};
		const c = createMoveCoalescer(raf, (x, y) => fired.push({ x, y }));
		c.push(4, 4);
		frame!(); // the real frame drains and fires once
		expect(fired).toEqual([{ x: 4, y: 4 }]);
		frame!(); // a spurious second frame with an empty queue fires nothing
		expect(fired).toEqual([{ x: 4, y: 4 }]);
	});
});
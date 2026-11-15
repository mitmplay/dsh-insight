import { describe, expect, it, vi } from 'vitest';
import { createGutterResize } from '@deepseek-insight/container-base';

/** The base gutter-resize machine (SSC#2 extraction): snapshot -> clamped
 *  delta moves -> settle. Synthetic MouseEvents; no DOM beyond window
 *  listeners the machine attaches and releases itself. */
describe('createGutterResize — the shared sidebar-drag skeleton', () => {
	function fire(type: string, clientX: number): void {
		window.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY: 300 }));
	}

	it('arms on start, applies clamped deltas, settles once with the final width', () => {
		const onResize = vi.fn();
		const onSettle = vi.fn();
		const machine = createGutterResize({
			onStart: () => 400,
			clamp: (w) => Math.min(600, Math.max(200, w)),
			onResize,
			onSettle
		});
		machine.start(new MouseEvent('mousedown', { clientX: 100 }));
		expect(machine.active).toBe(true);
		fire('mousemove', 140);
		fire('mousemove', 180);
		expect(onResize).toHaveBeenNthCalledWith(1, 440, expect.any(MouseEvent));
		expect(onResize).toHaveBeenNthCalledWith(2, 480, expect.any(MouseEvent));
		// a move past the max applies the CLAMPED width — settle reports
		// the last APPLIED width, never the raw cursor position
		fire('mousemove', 750);
		expect(onResize).toHaveBeenLastCalledWith(600, expect.any(MouseEvent));
		fire('mouseup', 750);
		expect(onSettle).toHaveBeenCalledTimes(1);
		expect(onSettle).toHaveBeenCalledWith(600); // the clamped applied width
		expect(machine.active).toBe(false);
		// post-settle moves are inert
		fire('mousemove', 900);
		expect(onResize).toHaveBeenCalledTimes(3); // the 750 move was the last
	});

	it('onStart null = ignored gesture — listeners armed nothing', () => {
		const onResize = vi.fn();
		const onSettle = vi.fn();
		const machine = createGutterResize({
			onStart: () => null,
			clamp: (w) => w,
			onResize,
			onSettle
		});
		machine.start(new MouseEvent('mousedown', { clientX: 100 }));
		expect(machine.active).toBe(false);
		fire('mousemove', 200);
		fire('mouseup', 200);
		expect(onResize).not.toHaveBeenCalled();
		expect(onSettle).not.toHaveBeenCalled();
	});

	it('destroy releases the listeners mid-drag without settling', () => {
		const onSettle = vi.fn();
		const machine = createGutterResize({
			onStart: () => 300,
			clamp: (w) => w,
			onResize: () => {},
			onSettle
		});
		machine.start(new MouseEvent('mousedown', { clientX: 100 }));
		machine.destroy();
		fire('mousemove', 500);
		fire('mouseup', 500);
		expect(onSettle).not.toHaveBeenCalled();
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGutterResize } from '../../src/interaction/gutter-resize';

function mouseEvent(clientX: number, type: 'mousemove' | 'mouseup' | 'mousedown' = 'mousemove'): MouseEvent {
	return new MouseEvent(type, { clientX });
}

type Handlers = Parameters<typeof createGutterResize>[0];

function baseHandlers(overrides: Partial<Handlers> = {}): Handlers {
	return {
		onStart: () => 300,
		clamp: (w) => w,
		onResize: () => {},
		...overrides
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('gutter-resize machine — snapshot / clamp / settle lifecycle (SSC#2)', () => {
	it('start arms the machine and attaches window listeners', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');
		const m = createGutterResize(baseHandlers());
		expect(m.active).toBe(false);
		m.start(mouseEvent(100, 'mousedown'));
		expect(m.active).toBe(true);
		const types = addSpy.mock.calls.map((c) => c[0]);
		expect(types).toContain('mousemove');
		expect(types).toContain('mouseup');
	});

	it('null snapshot from onStart arms nothing — collapsed/ignored gesture', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');
		const onResize = vi.fn();
		const m = createGutterResize(baseHandlers({ onStart: () => null, onResize }));
		m.start(mouseEvent(100, 'mousedown'));
		expect(m.active).toBe(false);
		expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
		window.dispatchEvent(mouseEvent(200));
		expect(onResize).not.toHaveBeenCalled();
	});

	it('mousemove applies snapshot + clamped delta while armed', () => {
		const onResize = vi.fn();
		const clamp = vi.fn((w: number) => Math.min(Math.max(w, 120), 800));
		const m = createGutterResize(baseHandlers({ clamp, onResize }));
		m.start(mouseEvent(100, 'mousedown'));
		window.dispatchEvent(mouseEvent(180));
		expect(clamp).toHaveBeenCalledWith(300 + 80);
		expect(onResize).toHaveBeenCalledWith(380, expect.any(MouseEvent));
		window.dispatchEvent(mouseEvent(40)); // candidate 240, inside bounds
		expect(onResize).toHaveBeenLastCalledWith(240, expect.any(MouseEvent));
	});

	it('clamp enforces min/max bounds on every move', () => {
		const onResize = vi.fn();
		const clamp = (w: number) => Math.min(Math.max(w, 120), 800);
		const m = createGutterResize(baseHandlers({ clamp, onResize }));
		m.start(mouseEvent(100, 'mousedown'));
		window.dispatchEvent(mouseEvent(2000)); // 300+1900 -> max
		expect(onResize).toHaveBeenLastCalledWith(800, expect.anything());
		window.dispatchEvent(mouseEvent(-1000)); // 800-1100 -> min
		expect(onResize).toHaveBeenLastCalledWith(120, expect.anything());
	});

	it('settle fires once on mouseup with the last clamped width, then disarms and detaches', () => {
		const removeSpy = vi.spyOn(window, 'removeEventListener');
		const onSettle = vi.fn();
		const onResize = vi.fn();
		const clamp = (w: number) => Math.min(Math.max(w, 120), 800);
		const m = createGutterResize(baseHandlers({ clamp, onResize, onSettle }));
		m.start(mouseEvent(100, 'mousedown'));
		window.dispatchEvent(mouseEvent(150)); // 350
		window.dispatchEvent(mouseEvent(250)); // 450
		window.dispatchEvent(mouseEvent(250, 'mouseup'));
		expect(onSettle).toHaveBeenCalledTimes(1);
		expect(onSettle).toHaveBeenCalledWith(450);
		expect(m.active).toBe(false);
		const types = removeSpy.mock.calls.map((c) => c[0]);
		expect(types).toContain('mousemove');
		expect(types).toContain('mouseup');
		// listeners are gone: further moves do nothing
		onResize.mockClear();
		window.dispatchEvent(mouseEvent(999));
		expect(onResize).not.toHaveBeenCalled();
	});

	it('mouseup without start, and moves before start, are no-ops', () => {
		const onSettle = vi.fn();
		const onResize = vi.fn();
		const m = createGutterResize(baseHandlers({ onResize, onSettle }));
		window.dispatchEvent(mouseEvent(500, 'mouseup'));
		window.dispatchEvent(mouseEvent(500));
		expect(onSettle).not.toHaveBeenCalled();
		expect(onResize).not.toHaveBeenCalled();
		expect(m.active).toBe(false);
	});

	it('second start while armed re-snapshots from the new gesture', () => {
		const onResize = vi.fn();
		const m = createGutterResize(baseHandlers({ onResize }));
		m.start(mouseEvent(100, 'mousedown'));
		window.dispatchEvent(mouseEvent(130)); // 330
		m.start(mouseEvent(0, 'mousedown')); // new snapshot 300 at x=0
		window.dispatchEvent(mouseEvent(50)); // 350
		expect(onResize).toHaveBeenLastCalledWith(350, expect.anything());
	});

	it('destroy releases the window listeners without settling', () => {
		const removeSpy = vi.spyOn(window, 'removeEventListener');
		const onSettle = vi.fn();
		const onResize = vi.fn();
		const m = createGutterResize(baseHandlers({ onResize, onSettle }));
		m.start(mouseEvent(100, 'mousedown'));
		m.destroy();
		expect(m.active).toBe(false);
		expect(onSettle).not.toHaveBeenCalled();
		const types = removeSpy.mock.calls.map((c) => c[0]);
		expect(types).toContain('mousemove');
		expect(types).toContain('mouseup');
		window.dispatchEvent(mouseEvent(300));
		expect(onResize).not.toHaveBeenCalled();
	});

	it('leaked listeners: move and mouseup after settle are inert early-returns', () => {
		// simulate a host that leaks the window listeners (detach failed): the
		// machine must still no-op via its unarmed guards on move and mouseup
		const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
		const onSettle = vi.fn();
		const onResize = vi.fn();
		const m = createGutterResize(baseHandlers({ onResize, onSettle }));
		m.start(mouseEvent(100, 'mousedown'));
		window.dispatchEvent(mouseEvent(120)); // 320, armed move
		window.dispatchEvent(mouseEvent(120, 'mouseup')); // settle once
		expect(onSettle).toHaveBeenCalledTimes(1);
		expect(onSettle).toHaveBeenCalledWith(320);
		// listeners leaked but disarmed: move and mouseup hit the unarmed guards
		window.dispatchEvent(mouseEvent(500));
		window.dispatchEvent(mouseEvent(500, 'mouseup'));
		expect(onSettle).toHaveBeenCalledTimes(1);
		expect(onResize).toHaveBeenCalledTimes(1);
		expect(m.active).toBe(false);
		removeSpy.mockRestore();
	});

	it('destroy on an idle machine is a safe no-op', () => {
		const m = createGutterResize(baseHandlers());
		expect(() => m.destroy()).not.toThrow();
		expect(m.active).toBe(false);
	});
});

import { flushSync, mount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob, toCanvas } from 'html-to-image';
import CanvasCopyButton from '../../src/components/CanvasCopyButton.svelte';

/**
 * 1.1-T (Container Base R6, ADR-0066) - the capture button's contract
 * survives the promotion: testid, the opaque CAPTURE_BACKING floor,
 * the engine option plumbing - with html-to-image mocked as a WORKING
 * peer here; the ABSENT-peer degradation lives in the sibling file.
 */

vi.mock('html-to-image', () => ({
	toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
	toCanvas: vi.fn()
}));

function mountCapture(container: HTMLElement | null, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(CanvasCopyButton, { target, props: { container, ...props } });
	flushSync();
	const btn = target.querySelector<HTMLButtonElement>('[data-testid="canvas-copy-button"]')!;
	return { instance, btn, target };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('CanvasCopyButton (R6 promotion, peer present)', () => {
	it('keeps the canvas-copy-button testid verbatim (D5)', () => {
		const { btn } = mountCapture(document.createElement('div'));
		expect(btn.dataset.testid).toBe('canvas-copy-button');
	});

	it('captures through the lazy engine with the opaque floor (D2)', async () => {
		const container = document.createElement('div');
		container.style.width = '400px';
		container.style.height = '300px';
		const { btn } = mountCapture(container);
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
		const opts = (toBlob as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect(opts.backgroundColor).toBe('#f8f9fa');
		expect(opts.skipAutoScale).toBe(true);
		expect(opts.pixelRatio).toBeGreaterThan(0);
	});

	it('Shift+Click saves as a file instead of the clipboard', async () => {
		const urlSpy = vi.fn(() => 'blob:fake');
		const revokeSpy = vi.fn();
		Object.defineProperty(URL, 'createObjectURL', { value: urlSpy, configurable: true });
		Object.defineProperty(URL, 'revokeObjectURL', { value: revokeSpy, configurable: true });
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const container = document.createElement('div');
		const { btn } = mountCapture(container);
		const shift = new MouseEvent('click', { shiftKey: true, bubbles: true });
		btn.dispatchEvent(shift);
		await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled());
		expect(urlSpy).toHaveBeenCalled();
		expect(revokeSpy).toHaveBeenCalled();
	});

	it('ignores clicks when no container is bound', async () => {
		const { btn } = mountCapture(null);
		btn.click();
		await new Promise((r) => setTimeout(r, 20));
		expect(toBlob).not.toHaveBeenCalled();
	});
});

describe('CanvasCopyButton branch coverage (peer present)', () => {
	function stubComputed(el: HTMLElement, props: Record<string, string>) {
	const real = window.getComputedStyle.bind(window);
	return vi.spyOn(window, 'getComputedStyle').mockImplementation((node: Element | null) => {
		const cs = real(node!);
		if (node === el) {
			for (const [k, v] of Object.entries(props)) {
				Object.defineProperty(cs, k, { value: v, configurable: true });
			}
		}
		return cs;
	});
}

/** jsdom's canvas has no 2d context — fake one so the tall-element
 *  tiling loop (toCanvas + drawImage) actually runs; restore after. */
function stubCanvas2d() {
	const fakeCtx = { fillStyle: '', fillRect: () => {}, drawImage: () => {} };
	const ctxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
	const blobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
		cb(null);
	});
	return () => {
		ctxSpy.mockRestore();
		blobSpy.mockRestore();
	};
}

function installClipboard(write: (items: ClipboardItem[]) => Promise<void>) {
		Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
	}

	/** Tall element (> TILE_HEIGHT 7900): jsdom's canvas has no 2d
	 *  context, so compositing throws and the click lands in catch. */
	it('degrades a tall-element capture failure back to idle (catch branch)', async () => {
		const container = document.createElement('div');
		Object.defineProperty(container, 'offsetHeight', { value: 9000, configurable: true });
		Object.defineProperty(container, 'offsetWidth', { value: 300, configurable: true });
		const restore = stubCanvas2d();
		try {
			const { btn } = mountCapture(container);
			btn.click();
			await vi.waitFor(() => expect(toCanvas).toHaveBeenCalled());
			// canvas.toBlob gives null → composite rejects → idle camera icon
			await vi.waitFor(() => expect(btn.querySelector('.ccb-spin')).toBeFalsy());
			expect(btn.querySelector('.ccb-icon')).toBeTruthy();
		} finally {
			restore();
		}
	});

	it('copies the PNG to the clipboard and flips to the done state', async () => {
		const write = vi.fn(async () => {});
		installClipboard(write);
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		const { btn } = mountCapture(container);
		btn.click();
		await vi.waitFor(() => expect(write).toHaveBeenCalled());
		const items = write.mock.calls[0][0] as ClipboardItem[];
		expect(items[0]).toBeInstanceOf(ClipboardItem);
		await vi.waitFor(() => expect(btn.querySelector('.ccb-spin')).toBeFalsy());
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-pass)');
	});

	it('returns to idle after the done state settles (2s feedback timer)', async () => {
		installClipboard(vi.fn(async () => {}));
		const { btn } = mountCapture(document.createElement('div'));
		btn.click();
		await vi.waitFor(() =>
			expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-pass)')
		);
		await new Promise((r) => setTimeout(r, 2100));
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-fail)');
	});

	it('catches a clipboard write rejection and falls back to idle', async () => {
		const write = vi.fn(async () => {
			throw new Error('denied');
		});
		installClipboard(write);
		const { btn } = mountCapture(document.createElement('div'));
		btn.click();
		await vi.waitFor(() => expect(write).toHaveBeenCalled());
		await vi.waitFor(() => expect(btn.querySelector('.ccb-spin')).toBeFalsy());
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-fail)');
	});

	it('hijacks to the first child only when the container really clips (scroll container)', async () => {
		const container = document.createElement('div');
		const inner = document.createElement('div');
		inner.style.width = '300px';
		inner.style.height = '200px';
		container.appendChild(inner);
		Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
		Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
		const spy = stubComputed(container, { overflowY: 'auto' });
		try {
			const { btn } = mountCapture(container);
			btn.click();
			await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
			expect((toBlob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toBe(inner);
		} finally {
			spy.mockRestore();
		}
	});

	it('keeps the container itself as target when overflow is visible despite tall content', async () => {
		const container = document.createElement('div');
		container.appendChild(document.createElement('div'));
		Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
		Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
		const { btn } = mountCapture(container);
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
		expect((toBlob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toBe(container);
	});

	it('renders the visible mode crop (width/height pinned to the container box)', async () => {
		const container = document.createElement('div');
		Object.defineProperty(container, 'offsetWidth', { value: 320, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 240, configurable: true });
		const { btn } = mountCapture(container, { mode: 'visible' });
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
		const opts = (toBlob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
		expect(opts.width).toBe(320);
		expect(opts.height).toBe(240);
	});

	it('compensates a scrolled nested pane in full mode, then restores it', async () => {
		const scroller = document.createElement('div');
		const content = document.createElement('div');
		scroller.appendChild(content);
		scroller.style.overflowY = 'auto';
		Object.defineProperty(scroller, 'scrollTop', { value: 120, configurable: true });
		Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true });
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		container.appendChild(scroller);
		const spy = stubComputed(scroller, { overflowY: 'auto' });
		try {
			const { btn } = mountCapture(container);
			btn.click();
			await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
			// the render-time translation is undone after the capture
			expect(content.style.transform).toBe('');
		} finally {
			spy.mockRestore();
		}
	});

	/** Visible-mode with a genuinely scrolled inner pane: exercises the
	 *  child translation, native-bar hide + fake track/thumb overlay, the
	 *  static→relative position pin, and both color-var fallbacks (jsdom
	 *  resolves no CSS custom properties → the trim() || FALLBACK arms). */
	it('visible mode overlays a fake scrollbar on a scrolled pane, then restores everything', async () => {
		const scroller = document.createElement('div');
		const child = document.createElement('div');
		scroller.appendChild(child);
		scroller.style.position = 'relative';
		Object.defineProperty(scroller, 'scrollTop', { value: 80, configurable: true });
		Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
		Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
		Object.defineProperty(scroller, 'clientWidth', { value: 300, configurable: true });
		const container = document.createElement('div');
		Object.defineProperty(container, 'offsetWidth', { value: 300, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 400, configurable: true });
		container.appendChild(scroller);
		const spy = stubComputed(scroller, { overflowY: 'auto', position: 'static', paddingRight: '0' });
		try {
			const { btn } = mountCapture(container, { mode: 'visible' });
			btn.click();
			await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
			await vi.waitFor(() => expect(btn.querySelector('.ccb-spin')).toBeFalsy());
			// everything pinned/moved/overlaid during the render is undone
			expect(child.style.transform).toBe('');
			expect(scroller.style.overflowY).toBe('');
			expect(scroller.style.paddingRight).toBe('');
			expect(scroller.querySelector('[style*="background:var(--color-surface)"]')).toBeFalsy();
		} finally {
			spy.mockRestore();
		}
	});

	it('visible-mode Shift+Click saves the visible crop as a file', async () => {
		const urlSpy = vi.fn(() => 'blob:fake');
		Object.defineProperty(URL, 'createObjectURL', { value: urlSpy, configurable: true });
		Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const container = document.createElement('div');
		Object.defineProperty(container, 'offsetWidth', { value: 300, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 200, configurable: true });
		const { btn } = mountCapture(container, { mode: 'visible' });
		btn.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled());
		const opts = (toBlob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
		expect(opts.width).toBe(300);
	});

	it('skips a scrollLeft-only nested scroller compensation, then restores (overflowX branch)', async () => {
		const scroller = document.createElement('div');
		const content = document.createElement('div');
		// a non-HTMLElement child rides along — the instanceof guard skips it
		scroller.appendChild(document.createTextNode('x'));
		scroller.appendChild(content);
		// a child that ALREADY carries a transform — appended, not replaced
		content.style.transform = 'scale(2)';
		Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true });
		Object.defineProperty(scroller, 'scrollLeft', { value: 90, configurable: true });
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		container.appendChild(scroller);
		const spy = stubComputed(scroller, { overflowX: 'scroll', overflowY: 'visible' });
		try {
			const { btn } = mountCapture(container);
			btn.click();
			await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
			// during-render transform is restored to the previous value
			await new Promise((r) => setTimeout(r, 20));
			expect(content.style.transform).toBe('scale(2)');
		} finally {
			spy.mockRestore();
		}
	});

	it('keeps the container when its first child is a text node despite clipping', async () => {
		const container = document.createElement('div');
		container.appendChild(document.createTextNode('plain text'));
		Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
		Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
		const spy = stubComputed(container, { overflowY: 'auto' });
		try {
			const { btn } = mountCapture(container);
			btn.click();
			await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
			expect((toBlob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toBe(container);
		} finally {
			spy.mockRestore();
		}
	});

	it('hijacks to the first child on overflowX-only clipping (x-axis branch)', async () => {
		const container = document.createElement('div');
		const inner = document.createElement('div');
		container.appendChild(inner);
		Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
		Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
		const spy = stubComputed(container, { overflowY: 'visible', overflowX: 'clip' });
		try {
			const { btn } = mountCapture(container);
			btn.click();
			await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
			expect((toBlob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toBe(inner);
		} finally {
			spy.mockRestore();
		}
	});

	it('falls back to idle when the engine returns a null blob', async () => {
		(toBlob as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		const { btn } = mountCapture(container);
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
		await vi.waitFor(() => expect(btn.querySelector('.ccb-spin')).toBeFalsy());
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-fail)');
	});

	it('visible mode falls back to idle on a null blob too', async () => {
		(toBlob as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		const container = document.createElement('div');
		Object.defineProperty(container, 'offsetWidth', { value: 300, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 200, configurable: true });
		const { btn } = mountCapture(container, { mode: 'visible' });
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalled());
		await vi.waitFor(() => expect(btn.querySelector('.ccb-spin')).toBeFalsy());
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-fail)');
	});
	it('reuses the cached engine on a second click (engine memo branch)', async () => {
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		const { btn } = mountCapture(container);
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1));
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalledTimes(2));
	});
});

/**
 * 1.1-T (ADR-0076, the prepare hook) - the optional pre-render hook:
 * awaited after the guard before the raster, its returned restore runs
 * in finally (success AND failure), and a throwing restore is swallowed.
 */
describe('CanvasCopyButton prepare hook (ADR-0076)', () => {
	function installClipboard(write: (items: ClipboardItem[]) => Promise<void>) {
		Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
	}

	// (a) default no-op — no prepare prop: behavior byte-identical (no
	// extra awaits between click and render, no restore stage).
	it('runs byte-identical without a prepare prop (default no-op)', async () => {
		installClipboard(vi.fn(async () => {}));
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		const { btn } = mountCapture(container);
		btn.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1));
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-pass)');
	});

	// (b) prepare awaited BEFORE the render; the mock engine records order.
	it('awaits prepare before the raster (order recorded by the mock engine)', async () => {
		installClipboard(vi.fn(async () => {}));
		const order: string[] = [];
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		(toBlob as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
			order.push('render');
			return new Blob(['png'], { type: 'image/png' });
		});
		const { btn } = mountCapture(container, {
			prepare: () => {
				order.push('prepare');
			}
		});
		btn.click();
		await vi.waitFor(() => expect(order.length).toBe(2));
		expect(order).toEqual(['prepare', 'render']);
	});

	// (c) the returned restore runs after a SUCCESSFUL capture.
	it('runs the returned restore after a successful capture', async () => {
		const write = vi.fn(async () => {});
		installClipboard(write);
		const restore = vi.fn();
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		const { btn } = mountCapture(container, { prepare: () => restore });
		btn.click();
		await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
		expect(write).toHaveBeenCalled();
		expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-pass)');
	});

	// (d) restore runs on a LOUD render failure too (finally, not success-only).
	it('runs the returned restore when the render fails (loud error path)', async () => {
		installClipboard(vi.fn(async () => {}));
		(toBlob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('render blew up'));
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const restore = vi.fn();
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		try {
			const { btn } = mountCapture(container, { prepare: () => restore });
			btn.click();
			await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
			// failure surfaced loudly AND state fell back to idle
			await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
			expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-fail)');
		} finally {
			errSpy.mockRestore();
		}
	});

	// (e) a throwing restore is swallowed — never masks the capture result.
	it('swallows a throw from the restore itself', async () => {
		installClipboard(vi.fn(async () => {}));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const restore = vi.fn(() => {
			throw new Error('restore blew up');
		});
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		try {
			const { btn } = mountCapture(container, { prepare: () => restore });
			btn.click();
			await vi.waitFor(() =>
				expect(btn.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-pass)')
			);
			expect(restore).toHaveBeenCalledTimes(1);
			await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
		} finally {
			warnSpy.mockRestore();
		}
	});

	// (f) an async prepare (returns a Promise<void>) is awaited.
	it('awaits an async prepare promise before the raster', async () => {
		installClipboard(vi.fn(async () => {}));
		const order: string[] = [];
		const container = document.createElement('div');
		container.style.width = '300px';
		container.style.height = '200px';
		(toBlob as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
			order.push('render');
			return new Blob(['png'], { type: 'image/png' });
		});
		const { btn } = mountCapture(container, {
			prepare: async () => {
				await new Promise((r) => setTimeout(r, 10));
				order.push('prepare');
			}
		});
		btn.click();
		await vi.waitFor(() => expect(order.length).toBe(2));
		expect(order).toEqual(['prepare', 'render']);
	});
});

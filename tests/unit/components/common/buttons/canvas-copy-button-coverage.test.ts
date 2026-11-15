/**
 * CanvasCopyButton unit tests — capture state machine (idle → busy → done),
 * clipboard vs Shift+Click save dispatch, capture-target selection (plain
 * container vs clipped scroll container), the single-pass vs tiled render
 * split, visible-mode scroll compensation, and the error fallback to idle.
 * html-to-image is mocked at the module seam; canvas 2D is stubbed on the
 * prototype because happy-dom has no real rasterizer.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CanvasCopyButton } from '@deepseek-insight/container-base';

const toBlobMock = vi.fn();
const toCanvasMock = vi.fn();
vi.mock('html-to-image', () => ({
	toBlob: (...args: unknown[]) => toBlobMock(...args),
	toCanvas: (...args: unknown[]) => toCanvasMock(...args)
}));

const PNG = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

type MountOpts = {
	container?: HTMLElement | null;
	mode?: 'full' | 'visible';
};

function mountButton(opts: MountOpts = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(CanvasCopyButton, {
		target,
		props: { container: opts.container ?? null, mode: opts.mode ?? 'full' }
	});
	flushSync();
	return { target, instance };
}

function button(target: HTMLElement): HTMLButtonElement {
	return target.querySelector<HTMLButtonElement>('[data-testid="canvas-copy-button"]')!;
}

function click(target: HTMLElement, shift = false) {
	button(target).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: shift }));
}

/** Happy-dom canvas has no rasterizer — stub a fake 2D context + toBlob. */
function stubCanvas2d() {
	const ctx = {
		fillStyle: '',
		fillRect: vi.fn(),
		drawImage: vi.fn()
	};
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
		cb(PNG());
	});
	return ctx;
}

/** Pin scroll geometry happy-dom doesn't compute. */
function pinGeometry(el: HTMLElement, geo: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
	if (geo.scrollHeight !== undefined)
		Object.defineProperty(el, 'scrollHeight', { value: geo.scrollHeight, configurable: true });
	if (geo.clientHeight !== undefined)
		Object.defineProperty(el, 'clientHeight', { value: geo.clientHeight, configurable: true });
	if (geo.scrollTop !== undefined)
		Object.defineProperty(el, 'scrollTop', { value: geo.scrollTop, configurable: true });
}

const clipboardWrite = vi.fn().mockResolvedValue(undefined);
const createObjectURL = vi.fn(() => 'blob:mock');
const revokeObjectURL = vi.fn();

beforeAll(() => {
	Object.assign(URL, { createObjectURL, revokeObjectURL });
	Object.defineProperty(navigator, 'clipboard', {
		value: { write: clipboardWrite },
		configurable: true
	});
	vi.stubGlobal(
		'ClipboardItem',
		class {
			items: Record<string, Blob>;
			constructor(items: Record<string, Blob>) {
				this.items = items;
			}
		}
	);
});

afterEach(() => {
	toBlobMock.mockReset();
	toCanvasMock.mockReset();
	clipboardWrite.mockClear();
	createObjectURL.mockClear();
	revokeObjectURL.mockClear();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function anchorDownload(): string | null {
	const a = document.querySelector('a[download]');
	return a?.getAttribute('download') ?? null;
}

/** happy-dom resolves no computed cascade (every value reads '') — overlay
 *  per-element answers the component's whitelist checks really need. */
const computedOverlay = new WeakMap<Element, Record<string, string>>();
function spyComputedStyle() {
	const real = window.getComputedStyle.bind(window);
	return vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
		const cs = real(el);
		const over = computedOverlay.get(el);
		if (!over) return cs;
		return new Proxy(cs, {
			get(t, prop) {
				if (prop in over) return over[prop as string];
				return Reflect.get(t, prop);
			}
		});
	});
}

/** happy-dom: capture the anchor the save path creates without appending it. */
function spyAnchorClick(): { current: HTMLAnchorElement | null } {
	const box: { current: HTMLAnchorElement | null } = { current: null };
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
		box.current = this;
	});
	return box;
}

describe('CanvasCopyButton — copy path (idle → busy → done)', () => {
	it('a plain click renders the container and lands on the check state', async () => {
		vi.useFakeTimers();
		const container = document.createElement('div');
		const { target, instance } = mountButton({ container });
		expect(target.querySelector('svg.animate-spin')).toBeNull();
		expect(target.querySelector('.text-status-pass')).toBeNull();

		toBlobMock.mockResolvedValue(PNG());
		click(target);
		flushSync();
		// busy spinner paints before the async render settles
		expect(target.querySelector('svg.animate-spin')).not.toBeNull();

		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		expect(toBlobMock).toHaveBeenCalledTimes(1);
		expect(toBlobMock.mock.calls[0][0]).toBe(container);
		// opaque backing + single-pass options
		expect(toBlobMock.mock.calls[0][1]).toMatchObject({
			backgroundColor: '#f8f9fa',
			skipAutoScale: true
		});
		expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);

		// the done state resets to idle after 2s
		vi.advanceTimersByTime(2000);
		flushSync();
		expect(target.querySelector('.text-status-pass')).toBeNull();
		expect(target.querySelector('svg.animate-spin')).toBeNull();
		unmount(instance);
		vi.useRealTimers();
	});

	it('a container that clips hijacks to its first element child', async () => {
		const container = document.createElement('div');
		container.style.overflowY = 'auto';
		const child = document.createElement('div');
		container.appendChild(child);
		pinGeometry(container, { scrollHeight: 900, clientHeight: 300 });
		computedOverlay.set(container, { overflowY: 'auto' });
		const restore = spyComputedStyle();
		const { target, instance } = mountButton({ container });
		toBlobMock.mockResolvedValue(PNG());
		click(target);
		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		expect(toBlobMock.mock.calls[0][0]).toBe(child);
		restore.mockRestore();
		unmount(instance);
	});

	it('a container whose overflow does NOT clip keeps the container itself', async () => {
		const container = document.createElement('div');
		const child = document.createElement('div');
		container.appendChild(child);
		pinGeometry(container, { scrollHeight: 900, clientHeight: 300 });
		const { target, instance } = mountButton({ container });
		toBlobMock.mockResolvedValue(PNG());
		click(target);
		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		expect(toBlobMock.mock.calls[0][0]).toBe(container);
		unmount(instance);
	});

	it('a null toBlob resolution falls back to idle', async () => {
		const container = document.createElement('div');
		const { target, instance } = mountButton({ container });
		toBlobMock.mockResolvedValue(null);
		click(target);
		await vi.waitFor(() => {
			expect(toBlobMock).toHaveBeenCalled();
		});
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		// error path: back to idle, never done
		expect(target.querySelector('.text-status-pass')).toBeNull();
		expect(target.querySelector('svg.animate-spin')).toBeNull();
		unmount(instance);
	});
});

describe('CanvasCopyButton — Shift+Click save path', () => {
	it('saves a file via an object URL and an anchor click', async () => {
		const container = document.createElement('div');
		const { target, instance } = mountButton({ container });
		toBlobMock.mockResolvedValue(PNG());
		const anchorBox = spyAnchorClick();
		click(target, true);
		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
		// the anchor carries the object URL + a timestamped png name
		const a = anchorBox.current!;
		expect(a.href).toBe('blob:mock');
		expect(a.download).toMatch(/^canvas-\d{4}-\d{2}-\d{2}T/);
		expect(a.download.endsWith('.png')).toBe(true);
		// clipboard untouched on the save verb
		expect(navigator.clipboard.write).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('CanvasCopyButton — tiled render for tall elements', () => {
	it('an element taller than one tile renders slices and composites', async () => {
		const ctx = stubCanvas2d();
		const container = document.createElement('div');
		const { target, instance } = mountButton({ container });
		// 577af42: the component measures LAYOUT size (offsetWidth/Height,
		// transform-blind), not the scaled rect — pin those
		Object.defineProperty(container, 'offsetWidth', { value: 100, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 16000, configurable: true });
		toCanvasMock.mockResolvedValue({ width: 200, height: 15800 });
		toBlobMock.mockResolvedValue(PNG());
		click(target);
		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		// 16000 / 7900 → 3 tiles via toCanvas, each translated + cropped
		expect(toCanvasMock).toHaveBeenCalledTimes(3);
		expect(toCanvasMock.mock.calls[0][1]).toMatchObject({ pixelRatio: 2, width: 100, height: 7900 });
		expect(toCanvasMock.mock.calls[0][1].style.transform).toBe('translateY(-0px)');
		expect(toCanvasMock.mock.calls[1][1].style.transform).toBe('translateY(-7900px)');
		// last tile is the remainder: 16000 - 2*7900 = 200
		expect(toCanvasMock.mock.calls[2][1].height).toBe(200);
		expect(ctx.drawImage).toHaveBeenCalledTimes(3);
		expect(ctx.fillStyle).toBe('#f8f9fa');
		// composite goes out through canvas.toBlob, not the library
		expect(toBlobMock).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('a null 2D context on the composite canvas fails cleanly to idle', async () => {
		stubCanvas2d();
		// the composite canvas is built and its context checked BEFORE any
		// tile renders — a null ctx aborts before the first toCanvas
		const ctxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
		const container = document.createElement('div');
		const { target, instance } = mountButton({ container });
		// 577af42: the component measures LAYOUT size (offsetWidth/Height,
		// transform-blind), not the scaled rect — pin those
		Object.defineProperty(container, 'offsetWidth', { value: 100, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 16000, configurable: true });
		toCanvasMock.mockResolvedValue({ width: 200, height: 15800 });
		click(target);
		await vi.waitFor(() => {
			expect(ctxSpy).toHaveBeenCalled();
		});
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		// composite construction failed → idle, never done; no tile rendered
		expect(toCanvasMock).not.toHaveBeenCalled();
		expect(target.querySelector('.text-status-pass')).toBeNull();
		expect(target.querySelector('svg.animate-spin')).toBeNull();
		unmount(instance);
	});
});

describe('CanvasCopyButton — visible mode', () => {
	function visibleTree() {
		const scroller = document.createElement('div');
		scroller.style.overflowY = 'auto';
		const rowA = document.createElement('div');
		const rowB = document.createElement('span');
		scroller.appendChild(rowA);
		scroller.appendChild(rowB);
		const idle = document.createElement('div');
		idle.style.overflowY = 'auto';
		const idleChild = document.createElement('div');
		idle.appendChild(idleChild);
		const container = document.createElement('div');
		container.appendChild(scroller);
		container.appendChild(idle);
		pinGeometry(scroller, { scrollHeight: 600, clientHeight: 200, scrollTop: 100 });
		pinGeometry(idle, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
		pinGeometry(container, { scrollHeight: 100, clientHeight: 100, scrollTop: 0 });
		return { container, scroller, rowA, rowB, idle, idleChild };
	}

	it('descendant scrollers get compensated + scrollbar overlays, restored in finally', async () => {
		const { container, scroller, rowA, rowB, idle, idleChild } = visibleTree();
		computedOverlay.set(scroller, { overflowY: 'auto', position: 'static', paddingRight: '4px' });
		computedOverlay.set(idle, { overflowY: 'auto', position: 'static', paddingRight: '4px' });
		const restore = spyComputedStyle();
		const { target, instance } = mountButton({ container, mode: 'visible' });
		let duringTransforms: string[] = [];
		toBlobMock.mockImplementation(async () => {
			duringTransforms = [rowA.style.transform, rowB.style.transform];
			return PNG();
		});
		// 577af42: visible mode crops to LAYOUT size (offsetWidth/Height)
		Object.defineProperty(container, 'offsetWidth', { value: 300, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 200, configurable: true });
		click(target);
		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		// every child of the scrolled pane shifted by scrollTop during render
		expect(duringTransforms).toEqual(['translateY(-100px)', 'translateY(-100px)']);
		// visible-mode crops to the container's box
		expect(toBlobMock.mock.calls[0][1]).toMatchObject({ width: 300, height: 200 });
		// the zero-scroll scroller was skipped entirely
		expect(idleChild.style.transform).toBe('');
		// finally-block restoration: transforms + inline pins
		expect(rowA.style.transform).toBe('');
		expect(rowB.style.transform).toBe('');
		expect(scroller.style.overflowY).toBe('auto');
		// overlay track+thumb removed
		expect(scroller.querySelectorAll('div[style*="pointer-events:none"]').length).toBe(0);
		unmount(instance);
		restore.mockRestore();
	});

	it('a failed visible render still restores the live DOM', async () => {
		const { container, scroller, rowA } = visibleTree();
		computedOverlay.set(scroller, { overflowY: 'auto', position: 'static', paddingRight: '4px' });
		const restore = spyComputedStyle();
		const { target, instance } = mountButton({ container, mode: 'visible' });
		toBlobMock.mockResolvedValue(null);
		// 577af42: visible mode crops to LAYOUT size (offsetWidth/Height)
		Object.defineProperty(container, 'offsetWidth', { value: 300, configurable: true });
		Object.defineProperty(container, 'offsetHeight', { value: 200, configurable: true });
		click(target);
		// settle = the live DOM is back to its pre-render shape (the busy
		// spinner may never paint — the failure path can resolve within a
		// single effect flush)
		await vi.waitFor(() => {
			expect(rowA.style.transform).toBe('');
		});
		expect(target.querySelector('.text-status-pass')).toBeNull();
		expect(rowA.style.transform).toBe('');
		expect(scroller.style.overflowY).toBe('auto');
		unmount(instance);
		restore.mockRestore();
	});

	it('visible mode with no container throws into the catch → idle', async () => {
		const { target, instance } = mountButton({ container: null, mode: 'visible' });
		click(target);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(target.querySelector('.text-status-pass')).toBeNull();
		expect(target.querySelector('svg.animate-spin')).toBeNull();
		expect(toBlobMock).not.toHaveBeenCalled();
		unmount(instance);
	});
});

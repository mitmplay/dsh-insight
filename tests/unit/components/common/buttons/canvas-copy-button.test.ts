/**
 * CanvasCopyButton unit tests — DOM→PNG capture with two payoffs
 * (click → clipboard, Shift+Click → file) over html-to-image.
 *
 * html-to-image is mocked (render logic under test is the component's
 * tiling/composite decision, not the library). happy-dom has no canvas
 * rasteriser, so HTMLCanvasElement.prototype.getContext/toBlob are
 * replaced with recording fakes — that also exercises the component's
 * runtime max-canvas probe honestly through those fakes.
 *
 * Color contract (The Opaque Backing ADR, 2026-09-07): every raster path
 * receives the opaque CAPTURE_BACKING floor — never a computed background.
 * A decoy computed style proves the derivation is gone; pixel truth lives
 * in tests/e2e/canvas-copy.spec.ts (Wave 2).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasCopyButton } from '@deepseek-insight/container-base';
import { toBlob, toCanvas } from 'html-to-image';

vi.mock('html-to-image', () => ({
	toBlob: vi.fn(),
	toCanvas: vi.fn()
}));

const mockedToBlob = vi.mocked(toBlob);
const mockedToCanvas = vi.mocked(toCanvas);

/** Recording 2D-context fake (happy-dom has none). */
const ctxCalls = {
	fillRect: [] as Array<[number, number, number, number]>,
	drawImage: [] as unknown[],
	fillStyles: [] as Array<string | null>
};
const fakeCtx = {
	get fillRect() {
		const self = this as { fillStyle?: string | null };
		return (...args: [number, number, number, number]) => {
			ctxCalls.fillStyles.push(self.fillStyle ?? null);
			ctxCalls.fillRect.push(args);
		};
	},
	get drawImage() {
		return (...args: unknown[]) => ctxCalls.drawImage.push(args);
	}
} as unknown as CanvasRenderingContext2D;

/** The blob canvas.toBlob hands back (identifiable sentinel content). */
let compositeBlob: Blob;

// The promoted package component (ADR-0066) encodes state on the single
// rendered svg.ccb-icon's stroke, not on text-status/animate-spin classes.
const stateIcon = (target: HTMLElement): string => {
	if (target.querySelector('svg.ccb-icon.ccb-spin')) return 'busy';
	if (target.querySelector('svg.ccb-icon[stroke="var(--color-status-pass)"]')) return 'done';
	return 'idle';
};

/** Element with a controllable box (happy-dom lays out nothing).
 *  Both boxes are pinned: getBoundingClientRect (historic) AND
 *  offsetWidth/offsetHeight — since 577af42 (2026-10-07 PanelsZoom
 *  right-side-cutoff fix) the component reads LAYOUT size, which is
 *  0 in happy-dom unless stubbed. */
function sizedEl(w: number, h: number): HTMLElement {
	const el = document.createElement('div');
	el.getBoundingClientRect = () =>
		({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
	Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
	Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
	return el;
}

function makeContainer(w = 400, h = 300): HTMLElement {
	const outer = sizedEl(w, h);
	outer.appendChild(document.createElement('div')); // candidate first child
	return outer;
}

function render(props: { container?: HTMLElement | null; title?: string } = {}): { target: HTMLElement; button: HTMLElement } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(CanvasCopyButton, { target, props: { container: props.container ?? null, ...(props.title ? { title: props.title } : {}) } });
	const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLElement;
	return { target, button, ...(comp ? {} : {}) } as { target: HTMLElement; button: HTMLElement };
}

/** Advance the async capture chain (multiple awaits + 0ms toBlob timers). */
async function settle(rounds = 15): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

describe('CanvasCopyButton — capture + copy/save payoffs', () => {
	let clipboardWrites: unknown[];
	let createdAnchors: Array<{ download: string; href: string }>;

	beforeEach(() => {
		vi.clearAllMocks();
		ctxCalls.fillRect = [];
		ctxCalls.drawImage = [];
		ctxCalls.fillStyles = [];
		compositeBlob = new Blob(['png-bytes'], { type: 'image/png' });
		mockedToBlob.mockResolvedValue(new Blob(['single-pass'], { type: 'image/png' }));
		mockedToCanvas.mockResolvedValue(sizedEl(10, 10) as unknown as HTMLCanvasElement);

		clipboardWrites = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async (items: unknown[]) => void clipboardWrites.push(...items)) }
		});
		vi.stubGlobal(
			'ClipboardItem',
			class {
				payload: Record<string, Blob>;
				constructor(p: Record<string, Blob>) {
					this.payload = p;
				}
			}
		);

		createdAnchors = [];
		vi.stubGlobal('URL', Object.assign(URL, {
			createObjectURL: vi.fn(() => 'blob:mock-url'),
			revokeObjectURL: vi.fn()
		}));

		// Canvas fakes: 2D context always "available", toBlob always succeeds.
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
			(callback: BlobCallback) => void setTimeout(() => callback(compositeBlob), 0)
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('renders an idle icon with the default title', () => {
		const { target, button } = render({ container: makeContainer() });
		expect(button.getAttribute('title')).toBe('Copy canvas as image (Shift+Click to save)');
		expect(stateIcon(target)).toBe('idle');
	});

	it('a custom title overrides the default', () => {
		const { button } = render({ container: makeContainer(), title: 'Snap the board' });
		expect(button.getAttribute('title')).toBe('Snap the board');
	});

	it('null container: click is a no-op — no render, no clipboard write', async () => {
		const { target, button } = render({ container: null });
		button.click();
		await settle();
		expect(mockedToBlob).not.toHaveBeenCalled();
		expect(clipboardWrites).toHaveLength(0);
		expect(stateIcon(target)).toBe('idle');
	});

	it('click copies the rendered PNG to the clipboard and flips to done', async () => {
		const container = makeContainer();
		const { target, button } = render({ container });
		button.click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		const [el, options] = mockedToBlob.mock.calls[0];
		expect(el).toBe(container); // normal-sized element: the container itself
		expect(options?.skipAutoScale).toBe(true); // 16384-clamp avoidance
		expect(clipboardWrites).toHaveLength(1);
		const item = clipboardWrites[0] as { payload: Record<string, Blob> };
		expect(item.payload['image/png'].size).toBe(11); // the single-pass blob ("single-pass")
		expect(item.payload['image/png'].type).toBe('image/png');
		expect(stateIcon(target)).toBe('done');
	});

	it('the raster options carry the opaque CAPTURE_BACKING — a hostile computed background never feeds the seam (Opaque Backing ADR D1)', async () => {
		// Decoy: if the computed-background derivation still existed, this
		// translucent oklab would leak into the backgroundColor option — the
		// constant is the only color source now.
		const real = window.getComputedStyle.bind(window);
		const decoy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
			((el: Element, pseudo?: string | null) => {
				const cs = real(el, pseudo);
				return new Proxy(cs, {
					get(target, prop) {
						if (prop === 'backgroundColor') return 'oklab(0.5 -0.1 -0.1 / 0.15)';
						return Reflect.get(target as object, prop, target);
					}
				}) as CSSStyleDeclaration;
			}) as typeof window.getComputedStyle
		);
		try {
			const container = makeContainer();
			const { button } = render({ container });
			button.click();
			await settle();
			const [, options] = mockedToBlob.mock.calls[0];
			expect(options?.backgroundColor).toBe('#f8f9fa');
			expect(String(options?.backgroundColor)).not.toMatch(/oklab/);
			// The clone box pin: live width in px, stale percentage max-width
			// neutralized (Opaque Backing addendum, 2026-09-08 — the border
			// must own the full artifact width).
			expect(options?.style).toEqual({
				width: '400px',
				maxWidth: 'none',
				position: 'static',
				top: 'auto',
				left: 'auto',
				right: 'auto',
				bottom: 'auto',
				transform: 'none',
				margin: '0'
			});
		} finally {
			decoy.mockRestore();
		}
	});

	it('done settles back to idle after the 2s feedback window', async () => {
		vi.useFakeTimers();
		try {
			const container = makeContainer();
			const { target, button } = render({ container });
			button.click();
			for (let i = 0; i < 15; i++) {
				flushSync();
				await vi.advanceTimersByTimeAsync(0);
				await Promise.resolve();
			} // settle: the composite canvas.toBlob mock fires on a 0ms timer,
			// so fake timers must be advanced, not just microtasks flushed
			expect(stateIcon(target)).toBe('done');
			await vi.advanceTimersByTimeAsync(2000);
			flushSync();
			expect(stateIcon(target)).toBe('idle');
		} finally {
			vi.useRealTimers();
		}
	});

	it('Shift+Click saves a timestamped PNG file instead of the clipboard', async () => {
		// The save anchor is never attached to the DOM — record its
		// programmatic click at the prototype level.
		const downloads: string[] = [];
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement
		) {
			if (this.download) downloads.push(this.download);
		});
		try {
			const container = makeContainer();
			const { button } = render({ container });
			button.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
			await settle();
			expect(downloads).toHaveLength(1);
			expect(downloads[0]).toMatch(/^canvas-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
			expect(clipboardWrites).toHaveLength(0);
			// The save path is the same renderer — same opaque backing (ADR D3):
			expect(mockedToBlob.mock.calls[0][1]?.backgroundColor).toBe('#f8f9fa');
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
		} finally {
			clickSpy.mockRestore();
		}
	});

	it('a visible-overflow box with content extent > client box captures ITSELF — the skin never gets hijacked (Opaque Backing ADR Wave 2)', async () => {
		const container = makeContainer();
		Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 2000 });
		Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 });
		// happy-dom computes NO overflow values (empty strings), so the
		// clip-container branch (auto/scroll/hidden/clip → first child) is
		// unexpressible here — its truth is pinned by the e2e pixel spec and
		// the manual gate. What happy-dom CAN pin is the no-hijack side: a
		// visible box with content extent exceeding its client box (the exact
		// real-app shape that hijacked captures to the unstyled inner div).
		const { button } = render({ container });
		button.click();
		await settle();
		expect(mockedToBlob.mock.calls[0][0]).toBe(container);
	});

	it('toBlob returning null is an error lane → back to idle, nothing copied', async () => {
		mockedToBlob.mockResolvedValue(null);
		const { target, button } = render({ container: makeContainer() });
		button.click();
		await settle();
		expect(clipboardWrites).toHaveLength(0);
		expect(stateIcon(target)).toBe('idle');
	});

	it('clipboard rejection is an error lane → back to idle', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async () => Promise.reject(new Error('clipboard denied'))) }
		});
		const { target, button } = render({ container: makeContainer() });
		button.click();
		await settle();
		expect(stateIcon(target)).toBe('idle');
	});
});

describe('CanvasCopyButton — tall-element tiling (OCI port)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ctxCalls.fillRect = [];
		ctxCalls.drawImage = [];
		ctxCalls.fillStyles = [];
		compositeBlob = new Blob(['tiled-png'], { type: 'image/png' });
		mockedToCanvas.mockResolvedValue(sizedEl(10, 10) as unknown as HTMLCanvasElement);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async (items: unknown[]) => void clipboardWrites.push(...items)) }
		});
		vi.stubGlobal(
			'ClipboardItem',
			class {
				payload: Record<string, Blob>;
				constructor(p: Record<string, Blob>) {
					this.payload = p;
				}
			}
		);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
			(callback: BlobCallback) => void setTimeout(() => callback(compositeBlob), 0)
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	let clipboardWrites: unknown[];

	it('a 16,000px element renders in 3 tiles at 2× and composites once', async () => {
		clipboardWrites = [];
		const container = makeContainer(400, 16000); // > 2 × TILE_HEIGHT(7900) → 3 tiles
		const { button } = render({ container });
		button.click();
		await settle(30);

		expect(mockedToBlob).not.toHaveBeenCalled(); // no single-pass attempt
		expect(mockedToCanvas).toHaveBeenCalledTimes(3);
		// Every tile renders at full 2× with skipAutoScale and a translateY window
		for (const [, options] of mockedToCanvas.mock.calls) {
			expect(options?.pixelRatio).toBe(2);
			expect(options?.skipAutoScale).toBe(true);
			expect(options?.width).toBe(400);
		}
		expect(mockedToCanvas.mock.calls[1][1]?.style?.transform).toBe('translateY(-7900px)');
		expect(ctxCalls.drawImage).toHaveLength(3);
		expect(ctxCalls.fillRect).toHaveLength(1); // background wash on the composite
		expect(ctxCalls.fillStyles).toEqual(['#f8f9fa']); // opaque floor, not a computed tint (ADR D1)
		expect(clipboardWrites).toHaveLength(1);
		const item = clipboardWrites[0] as { payload: Record<string, Blob> };
		expect(item.payload['image/png']).toBe(compositeBlob); // composite canvas is the payload
	});

	it('a failing composite toBlob is an error lane → idle, nothing copied', async () => {
		clipboardWrites = [];
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
			(callback: BlobCallback) => void setTimeout(() => callback(null), 0)
		);
		const { target, button } = render({ container: makeContainer(400, 16000) });
		button.click();
		await settle(30);
		expect(clipboardWrites).toHaveLength(0);
		expect(target.querySelector('svg.ccb-icon[stroke="var(--color-status-pass)"]')).toBeNull();
	});
});

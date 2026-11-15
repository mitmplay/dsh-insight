/**
 * CanvasCopyButton unit tests — the nested-scroll compensation of FULL-mode
 * captures (2026-10-06) and the max-canvas probe's fallback lane.
 *
 * html-to-image is mocked at the module seam; happy-dom computes no cascade,
 * so computed-style answers are overlaid per element (same pattern as the
 * coverage suite). What gets pinned here:
 *   - a clipped, scrolled pane inside the capture shifts ALL its children by
 *     the live scroll offset for the render and restores them after;
 *   - horizontal scroll compensates through overflowX;
 *   - non-clipping or zero-scroll boxes are left untouched;
 *   - a non-HTMLElement child (inline SVG) is skipped, and a child that
 *     already carries a transform keeps it prefixed after the shift;
 *   - a crashing canvas probe falls back to the safe 16384 constant.
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

const PNG = () => new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' });

const clipboardWrite = vi.fn().mockResolvedValue(undefined);

beforeAll(() => {
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
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function mountButton(container: HTMLElement | null) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(CanvasCopyButton, { target, props: { container } });
	flushSync();
	return { target, instance };
}

function click(target: HTMLElement) {
	target
		.querySelector<HTMLButtonElement>('[data-testid="canvas-copy-button"]')!
		.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function pinGeometry(
	el: HTMLElement,
	geo: { scrollHeight?: number; clientHeight?: number; scrollTop?: number; scrollLeft?: number }
) {
	for (const key of ['scrollHeight', 'clientHeight', 'scrollTop', 'scrollLeft'] as const) {
		if (geo[key] !== undefined)
			Object.defineProperty(el, key, { value: geo[key], configurable: true });
	}
}

/** happy-dom resolves no computed cascade — overlay per-element answers. */
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

describe('CanvasCopyButton — nested-scroll compensation in full mode', () => {
	function captureTree() {
		// The container itself never clips (equal geometry) so the capture
		// target IS the container and the compensation walks the whole tree.
		const container = document.createElement('div');
		const pane = document.createElement('div'); // clipped + scrolled
		const rowA = document.createElement('div');
		const rowB = document.createElement('span');
		rowB.style.transform = 'rotate(1deg)'; // pre-existing transform prefix
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); // non-HTMLElement child
		const idle = document.createElement('div'); // zero scroll → skipped early
		const loose = document.createElement('div'); // scrolled but NOT clipping
		pane.appendChild(rowA);
		pane.appendChild(rowB);
		pane.appendChild(svg);
		idle.appendChild(document.createElement('div'));
		loose.appendChild(document.createElement('div'));
		container.appendChild(pane);
		container.appendChild(idle);
		container.appendChild(loose);
		pinGeometry(pane, { scrollHeight: 600, clientHeight: 200, scrollTop: 120 });
		pinGeometry(idle, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
		pinGeometry(loose, { scrollHeight: 600, clientHeight: 200, scrollTop: 120 });
		pinGeometry(container, { scrollHeight: 100, clientHeight: 100 });
		computedOverlay.set(pane, { overflowY: 'auto', overflowX: '' });
		computedOverlay.set(idle, { overflowY: 'auto', overflowX: '' });
		computedOverlay.set(loose, { overflowY: '', overflowX: '' }); // no clipping at all
		return { container, pane, rowA, rowB, svg, idle, loose };
	}

	it('a scrolled clipped pane shifts every HTMLElement child for the render, restoring transforms (and their prefixes) after', async () => {
		const { container, rowA, rowB, svg, idle, loose } = captureTree();
		const restore = spyComputedStyle();
		const { target, instance } = mountButton(container);
		let during: { rowA: string; rowB: string; svg: string; idle: string; loose: string } | null =
			null;
		toBlobMock.mockImplementation(async () => {
			during = {
				rowA: rowA.style.transform,
				rowB: rowB.style.transform,
				svg: (svg as unknown as { style: CSSStyleDeclaration }).style.transform,
				idle: (idle.firstElementChild as HTMLElement).style.transform,
				loose: (loose.firstElementChild as HTMLElement).style.transform
			};
			return PNG();
		});
		click(target);
		await vi.waitFor(() => {
			expect(during).not.toBeNull();
		});
		// let the render settle and the finally-restore run
		await vi.waitFor(() => {
			expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
		});
		// during the render: the clipped pane's children carry the offset,
		// the pre-existing transform is preserved as a suffix…
		expect(during!.rowA).toBe('translate(0px, -120px)');
		expect(during!.rowB).toBe('translate(0px, -120px) rotate(1deg)');
		// …the non-HTMLElement (SVG) child is untouched…
		expect(during!.svg).toBe('');
		// …and neither the zero-scroll pane nor the non-clipping scroller moved.
		expect(during!.idle).toBe('');
		expect(during!.loose).toBe('');
		// after the render everything is back to its pre-capture shape.
		expect(rowA.style.transform).toBe('');
		expect(rowB.style.transform).toBe('rotate(1deg)');
		expect((idle.firstElementChild as HTMLElement).style.transform).toBe('');
		unmount(instance);
		restore.mockRestore();
	});

	it('a horizontally scrolled pane compensates through overflowX alone', async () => {
		const container = document.createElement('div');
		const pane = document.createElement('div');
		const child = document.createElement('div');
		pane.appendChild(child);
		container.appendChild(pane);
		pinGeometry(pane, { scrollHeight: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 80 });
		computedOverlay.set(pane, { overflowY: '', overflowX: 'scroll' });
		const restore = spyComputedStyle();
		const { target, instance } = mountButton(container);
		let during: string | null = null;
		toBlobMock.mockImplementation(async () => {
			during = child.style.transform;
			return PNG();
		});
		click(target);
		await vi.waitFor(() => {
			expect(during).not.toBeNull();
		});
		// let the render settle and the finally-restore run
		await vi.waitFor(() => {
			expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
		});
		expect(during).toBe('translate(-80px, 0px)');
		expect(child.style.transform).toBe('');
		unmount(instance);
		restore.mockRestore();
	});
});

describe('CanvasCopyButton — max-canvas probe fallback', () => {
	it('a crashing canvas probe settles on the safe 16384 constant and the copy still succeeds', async () => {
		const origCreate = document.createElement.bind(document);
		const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			if (tag === 'canvas') throw new Error('canvas unavailable');
			return origCreate(tag);
		});
		const container = document.createElement('div');
		const { target, instance } = mountButton(container);
		toBlobMock.mockResolvedValue(PNG());
		click(target);
		await vi.waitFor(() => {
			expect(target.querySelector('.text-status-pass')).not.toBeNull();
		});
		// the single-pass ratio fell back through the catch lane (16384 side
		// of the min()) and the capture went out anyway
		expect(toBlobMock).toHaveBeenCalledTimes(1);
		expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
		unmount(instance);
		createSpy.mockRestore();
	});
});

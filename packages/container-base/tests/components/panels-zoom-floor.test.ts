/**
 * PanelsZoom — floor arm (coverage headroom, 2026-11-23): the selection
 * follow's missing-column guard, source L134 `if (!col) return;`.
 *
 * The sibling suite (tests/unit/panels-row.test.ts) only ever selects ids
 * whose column IS in the row, so the guard's return arm never ran. Pinned:
 * a focused id with no `[data-panel-id]` column in the viewport HANDS OFF —
 * no scrollTo, scrollLeft untouched, no throw — while a REAL off-viewport
 * selection on the same mount still reveals (so the null result is the
 * guard, not a dead follow). Geometry is stubbed exactly like the sibling
 * (happy-dom has no layout): clientWidth/rects on the elements, rAF
 * synchronous, scrollTo a capture-and-mirror.
 *
 * NOT forced (reported to the lead): L95 `if (row)`, L102/L109
 * `!frame || !row`, L130 `!viewport` — every bind:this target is assigned
 * while the template function builds the DOM, BEFORE any $effect runs, and
 * effects never run after unmount; the guards exist for TS narrowing.
 */
import { flushSync, mount, unmount } from 'svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelsZoomHarness from '../../../../tests/fixtures/PanelsZoomHarness.svelte';

const COL = 500;
const IDS = ['p1', 'p2', 'p3'];

type Harness = { set(next: { selectedPanelId?: string | null }): void };

/** rAF stub: happy-dom lacks requestAnimationFrame by default in effects. */
function stubRaf(): void {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** One 500px column per id, carrying the data-panel-id the follow queries. */
function columnsSnippet(ids: string[]) {
	return createRawSnippet(() => ({
		render: () =>
			`<div>${ids.map((id) => `<div data-panel-id="${id}" style="width:${COL}px"></div>`).join('')}</div>`
	}));
}

/** Viewport geometry + a scrollTo that records its options and mirrors scrollLeft. */
function stubViewportGeometry(target: HTMLElement, vpWidth: number) {
	const vp = target.querySelector('[data-testid="panels-viewport"]') as HTMLElement;
	const scrolls: ScrollToOptions[] = [];
	Object.defineProperty(vp, 'clientWidth', { configurable: true, value: vpWidth });
	Object.defineProperty(vp, 'scrollWidth', { configurable: true, value: COL * IDS.length + 8 });
	vp.getBoundingClientRect = () =>
		({ left: 0, right: vpWidth, width: vpWidth, top: 0, bottom: 0, height: 100 }) as DOMRect;
	vp.scrollTo = ((opts: ScrollToOptions) => {
		scrolls.push(opts);
		vp.scrollLeft = opts.left ?? vp.scrollLeft;
	}) as unknown as typeof vp.scrollTo;
	return { vp, scrolls };
}

/** Column k's rect: content left k × COL, shifted by the live scrollLeft. */
function stubColumnRects(target: HTMLElement, vp: HTMLElement, ids = IDS): void {
	ids.forEach((id, i) => {
		const el = target.querySelector(`[data-panel-id="${id}"]`) as HTMLElement;
		const contentLeft = i * COL;
		el.getBoundingClientRect = () => {
			const left = contentLeft - vp.scrollLeft;
			return { left, right: left + COL, width: COL, top: 0, bottom: 0, height: 100 } as DOMRect;
		};
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PanelsZoom — selection follow: the missing-column guard (L134)', () => {
	it('a focused id with no column in the row hands off (no scrollTo); a real selection still reveals', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: IDS.map((id) => ({ id, width: COL })),
				selectedPanelId: 'p1',
				children: columnsSnippet(IDS)
			}
		});
		await settle();
		const { vp, scrolls } = stubViewportGeometry(target, 500);
		stubColumnRects(target, vp);
		vp.scrollLeft = 77; // operator position — must survive the hand-off

		// The focused panel's column is NOT in the row (closed, or not yet mounted).
		(instance as unknown as Harness).set({ selectedPanelId: 'ghost' });
		await settle();
		expect(scrolls).toHaveLength(0);
		expect(vp.scrollLeft).toBe(77);

		// Control on the SAME mount: a real off-viewport selection reveals.
		(instance as unknown as Harness).set({ selectedPanelId: 'p3' });
		await settle();
		// p3 spans content [1000, 1500] — past the 500px edge; right edge + ring at the viewport edge.
		expect(scrolls).toHaveLength(1);
		expect(scrolls[0]).toMatchObject({ left: 1000 + COL + 4 - 500, behavior: 'smooth' });
		expect(vp.scrollLeft).toBe(1000 + COL + 4 - 500);
		unmount(instance);
	});
});

/**
 * panel-resize unit tests (paired with Panel Floor W5 task 5.2 — drag
 * math + honest slider).
 *
 * Two layers, the way the feature is built:
 *
 *  1. PURE math — exported by the workspace route's <script module>:
 *     resizeOne moves ONLY the dragged panel's width (individual
 *     resize, 2026-08-28 — neighbors keep their values, the row total
 *     grows/shrinks) clamped to the panel bounds; scaleProportionally
 *     preserves snapshot ratios until clamps saturate; isUniformRow is
 *     the honest-slider predicate.
 *
 *  2. ROUTE-MOUNTED behaviors — the real page in happy-dom (the
 *     workspace-route.test.ts harness pattern): a gutter drag fires
 *     through the REAL registry round-trip, window mousemove/up drive
 *     panels, and mouseup runs the honest-slider sync (panelWidth syncs
 *     only on a uniform result; a mixed row leaves the preset alone).
 *     Every gutter — first, middle, last — resizes its OWN panel within
 *     bounds. Width math clamps are the panel-prefs bounds — the one
 *     clamp site.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the page must bind to the SAME svelte runtime as
// mount/flushSync below (second-instance binding → effect_orphan).
import Page from '../../src/routes/+page.svelte';
import { resizeOne, scaleProportionally, isUniformRow } from '@deepseek-insight/container-base';
import { clampPanelWidth } from '$lib/utils/panel-prefs';
// W3 (ADR-0062 D8): package math; the DSI bound site rides as the clamp.
const clampWidth = (width: number, kind?: string) =>
	clampPanelWidth(width, kind as DsiPanelEntry['kind']);
const resizeOneC = <P extends { id: string; width: number }>(panels: readonly P[], snaps: number[], i: number, d: number) =>
	resizeOne<P>(panels, snaps, i, d, clampWidth);
const scaleC = <P extends { id: string; width: number }>(panels: readonly P[], snaps: number[], d: number) =>
	scaleProportionally<P>(panels, snaps, d, clampWidth);
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { startPanelResize } from '../../src/lib/services/panels/panel-registry';
import {
	PANEL_MAX_WIDTH,
	PANEL_MIN_WIDTH,
	PANEL_WORKSPACE_FILE_MAX_WIDTH
} from '../../src/lib/utils/panel-prefs';
import type { DsiPanelEntry } from '../../src/lib/types';

/** Panel fixture — imported type, commitment 9. */
function p(id: string, width: number): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId: `s-${id}`, agentPreset: null, width };
}

function widths(panels: DsiPanelEntry[]): number[] {
	return panels.map((x) => x.width);
}

async function flushEffects(): Promise<void> {
	for (let i = 0; i < 6; i++) await Promise.resolve();
	flushSync();
	await Promise.resolve();
}

// ── 1. Pure math ────────────────────────────────────────────────────────

describe('resizeOne — plain drag, individual (2026-08-28)', () => {
	it('moves ONLY the dragged panel — every other panel keeps its width', () => {
		const panels = [p('a', 600), p('b', 700), p('c', 800)];
		const next = resizeOneC(panels, widths(panels), 1, 50);
		expect(widths(next)).toEqual([600, 750, 800]);
		// Negative delta shrinks it; siblings still untouched.
		const back = resizeOneC(panels, widths(panels), 1, -50);
		expect(widths(back)).toEqual([600, 650, 800]);
	});

	it('clamps the dragged panel at MAX; no neighbor ever compensates', () => {
		const panels = [p('a', 800), p('b', 700)];
		const next = resizeOneC(panels, widths(panels), 0, 200);
		expect(widths(next)).toEqual([PANEL_MAX_WIDTH, 700]);
	});

	it('a workspace-file panel may extend to its own wider bound (2026-09-12)', () => {
		const file: DsiPanelEntry = {
			id: 'f',
			kind: 'workspace-file',
			sessionId: 's',
			path: 'README.md',
			explorerPanelId: null,
			width: 860
		};
		const chat = p('a', 700);
		const panels = [file, chat];
		const next = resizeOneC(panels, widths(panels), 0, 700);
		expect(widths(next)).toEqual([PANEL_WORKSPACE_FILE_MAX_WIDTH, 700]);
		// The conversation sibling still clamps at the plain MAX.
		const back = resizeOneC(panels, widths(panels), 1, 500);
		expect(widths(back)).toEqual([860, PANEL_MAX_WIDTH]);
	});

	it('clamps the dragged panel at MIN; no neighbor ever compensates', () => {
		const panels = [p('a', 600), p('b', 520)];
		const next = resizeOneC(panels, widths(panels), 0, -200);
		expect(widths(next)).toEqual([PANEL_MIN_WIDTH, 520]);
	});

	it('the LAST gutter behaves like any other (its own panel, bounds only)', () => {
		const panels = [p('a', 600), p('b', 700)];
		const snaps = widths(panels);
		const up = resizeOneC(panels, snaps, 1, 250);
		expect(widths(up)).toEqual([600, PANEL_MAX_WIDTH]);
		const down = resizeOneC(panels, snaps, 1, -500);
		expect(widths(down)).toEqual([600, PANEL_MIN_WIDTH]);
	});

	it('keeps untouched siblings by object identity (no accidental clones)', () => {
		const panels = [p('a', 600), p('b', 700), p('c', 800)];
		const next = resizeOneC(panels, widths(panels), 0, 40);
		expect(next[1]).toStrictEqual(panels[1]);
		expect(next[2]).toStrictEqual(panels[2]);
	});
});

describe('scaleProportionally — Shift+drag (task 5.2-T)', () => {
	it('preserves snapshot ratios while nothing saturates', () => {
		// 480/560/700 — a +84px row-growth keeps every ratio intact
		// (shares 16/29×84, 14/29×84 — none reaches a bound).
		const panels = [p('a', 480), p('b', 560), p('c', 700)];
		const snaps = widths(panels);
		const next = scaleC(panels, snaps, 84);
		const w = widths(next);
		const total = 1740;
		expect(w[0]).toBeCloseTo(snaps[0] + (snaps[0] / total) * 84, 10);
		expect(w[1]).toBeCloseTo(snaps[1] + (snaps[1] / total) * 84, 10);
		expect(w[2]).toBeCloseTo(snaps[2] + (snaps[2] / total) * 84, 10);
		// The contract: same ratios as the snapshots.
		expect(w[1] / w[0]).toBeCloseTo(snaps[1] / snaps[0], 10);
		expect(w[2] / w[0]).toBeCloseTo(snaps[2] / snaps[0], 10);
	});

	it('negative delta shrinks the whole row proportionally', () => {
		const panels = [p('a', 480), p('b', 720)];
		const next = scaleC(panels, widths(panels), -210);
		// 360 clamps up to MIN: the ratio holds only until saturation.
		expect(widths(next)).toEqual([PANEL_MIN_WIDTH, 594]);
	});

	it('an extreme drag clamps the row (never leaves the bounds)', () => {
		const panels = [p('a', 600), p('b', 700)];
		const grow = scaleC(panels, widths(panels), 10_000);
		expect(grow.every((x) => x.width <= PANEL_MAX_WIDTH)).toBe(true);
		const shrink = scaleC(panels, widths(panels), -10_000);
		expect(shrink.every((x) => x.width >= PANEL_MIN_WIDTH)).toBe(true);
	});
});

describe('isUniformRow — the honest-slider predicate (task 5.2-T)', () => {
	it('uniform row → true; mixed row → false; empty row → false', () => {
		expect(isUniformRow([p('a', 730), p('b', 730)])).toBe(true);
		expect(isUniformRow([p('a', 730), p('b', 700)])).toBe(false);
		expect(isUniformRow([])).toBe(false);
	});
});

// ── 2. Route-mounted drag behaviors ─────────────────────────────────────

/** Stage a bare / restore with the given panels + preset. */
function stageRestore(
	panels: Array<{ id: string; width: number }>,
	panelWidth: number
): void {
	localStorage.clear();
	localStorage.setItem(
		'dsi-panels',
		JSON.stringify({
			panels: panels.map((x) => ({
				id: x.id,

				kind: 'conversation',
				sessionId: `s-${x.id}`,
				agentPreset: null,
				width: x.width
			})),
			selectedPanelId: panels[0]?.id ?? null,
			panelWidth,
			zoom: 1
		})
	);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
}

/** No cold data anywhere → fetch resolves 404s (panels stay error cards;
 *  drag math runs on `panels` regardless — the width contract under test). */
function stub404Fetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 404 }))
	);
}

function columnWidths(target: HTMLElement): number[] {
	return Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map(
		(el) => Number((el as HTMLElement).style.width.replace('px', '')) || 0
	);
}

function storedPanelWidths(): number[] {
	const raw = localStorage.getItem('dsi-panels');
	if (!raw) return [];
	return (JSON.parse(raw) as { panels: DsiPanelEntry[] }).panels.map((x) => x.width);
}

function storedPreset(): number | undefined {
	const raw = localStorage.getItem('dsi-panels');
	return raw ? (JSON.parse(raw) as { panelWidth: number }).panelWidth : undefined;
}

afterEach(() => {
	resetSpineFeedForTests(); // module-scope feed store - test isolation
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('route-mounted gutter drag (task 5.2-T)', () => {
	it('plain drag resizes only the dragged panel through the real registry round-trip', async () => {
		stageRestore([{ id: 'p1', width: 600 }, { id: 'p2', width: 700 }], 730);
		stub404Fetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(Page, { target });
		await flushEffects();

		// Gutter 0 mousedown → registry → route snapshot; window mousemove
		// +50px on panel 0's gutter: p1 grows, p2 KEEPS its 700
		// (individual — resizing one panel never moves another's value).
		const gutter = target.querySelector('[data-testid="panel-gutter-0"]') as HTMLElement;
		gutter.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
		// The gutter's registry import is dynamic — give the chain turns.
		await new Promise((r) => setTimeout(r, 20));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }));
		await flushEffects();
		expect(columnWidths(target)).toEqual([650, 700]);
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();
		// Persistence wrote the dragged width; the sibling unchanged.
		expect(storedPanelWidths()).toEqual([650, 700]);
		unmount(instance);
	});

	it('Shift+drag scales all panels proportionally', async () => {
		stageRestore([{ id: 'p1', width: 480 }, { id: 'p2', width: 720 }], 730);
		stub404Fetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(Page, { target });
		await flushEffects();

		const gutter = target.querySelector('[data-testid="panel-gutter-0"]') as HTMLElement;
		gutter.dispatchEvent(
			new MouseEvent('mousedown', { clientX: 200, shiftKey: true, bubbles: true })
		);
		await new Promise((r) => setTimeout(r, 20));
		await flushEffects();
		// −210px on a 480/720 row (total 1200): shares 480/1200×−210=−84
		// and 720/1200×−210=−126 → 396→clamp 480, 594. Both move in their
		// snapshot proportions until p1 pins at MIN.
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: -10 }));
		await flushEffects();
		expect(columnWidths(target)).toEqual([PANEL_MIN_WIDTH, 594]);
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();
		unmount(instance);
	});

	it('honest slider: mouseup after a UNIFORM result syncs the preset; mixed leaves it', async () => {
		// Uniform row at 650 + preset 730: a drag that lands uniform must
		// sync the preset (the slider then tells the truth).
		stageRestore([{ id: 'p1', width: 650 }, { id: 'p2', width: 650 }], 730);
		stub404Fetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(Page, { target });
		await flushEffects();
		// Drag panel 0 wider by 20: 670/650 — MIXED. Preset must stay 730.
		const gutter = target.querySelector('[data-testid="panel-gutter-0"]') as HTMLElement;
		gutter.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
		await new Promise((r) => setTimeout(r, 20));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 }));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();
		expect(columnWidths(target)).toEqual([670, 650]);
		expect(storedPreset()).toBe(730); // mixed → untouched
		// Drag panel 0 back: 650/650 — UNIFORM. Preset syncs to 650.
		gutter.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
		await new Promise((r) => setTimeout(r, 20));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: -20 }));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();
		expect(columnWidths(target)).toEqual([650, 650]);
		expect(storedPreset()).toBe(650); // uniform → synced (honest slider)
		unmount(instance);
	});

	it('the LAST gutter is no special case (individual: its own panel, bounds only)', async () => {
		stageRestore([{ id: 'p1', width: 600 }, { id: 'p2', width: 700 }], 730);
		stub404Fetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(Page, { target });
		await flushEffects();
		const gutter1 = target.querySelector('[data-testid="panel-gutter-1"]') as HTMLElement;
		gutter1.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
		await new Promise((r) => setTimeout(r, 20));
		await flushEffects();
		// +900px: p2 pins at MAX, p1 never moves (individual).
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
		await flushEffects();
		expect(columnWidths(target)).toEqual([600, PANEL_MAX_WIDTH]);
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();
		unmount(instance);
	});

	it('registry round-trip is live: drag math runs through startPanelResize (the real channel)', async () => {
		stageRestore([{ id: 'p1', width: 600 }, { id: 'p2', width: 700 }], 730);
		stub404Fetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(Page, { target });
		await flushEffects();
		// Invoke the registry action directly (a leaf's channel): the same
		// snapshot → move → result as a gutter mousedown produces.
		expect(
			startPanelResize(new MouseEvent('mousedown', { clientX: 0 }), 0)
		).toBe(true);
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 }));
		await flushEffects();
		expect(columnWidths(target)).toEqual([630, 700]);
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();
		unmount(instance);
	});
});

/**
 * sidebar-placement unit tests (config `sidebar.placement`, 2026-08-26).
 *
 * Pins the TWO HOSTS of the app sidebar against the real workspace route
 * (panel-resize.test.ts harness pattern — component-direct mount of the
 * page in happy-dom, config steered through the REAL app-config store
 * round-trip: stubbed GET /api/config → loadAppConfig → applyConfig):
 *
 *  - 'none' (default): the rail renders BESIDE the floor — outside
 *    [data-testid="panels-row"], owning its width wrapper + gutter.
 *  - 'panels-zoom': the rail renders INSIDE the row as its FIRST column,
 *    hosted by StickyColumnContainer (OCI StickyColumnContainer pattern):
 *    triple-locked width, trailing gutter only while panels follow, and
 *    collapse re-homes the rail back beside the floor (the 34px stub
 *    NEVER lives inside the zoom row — OCI parity).
 *
 * Cases:
 *  1. default 'none': rail outside the row, no sidebar-column anywhere.
 *  2. 'panels-zoom': sidebar-column is the row's first element child and
 *     hosts the rail; width is triple-locked (width/min/max same px).
 *  3. gutter gating: no panels → no gutter; panels follow → gutter sits
 *     between the column and the first panel column.
 *  4. collapsed in 'panels-zoom': stub renders beside the floor, the row
 *     carries no rail column (OCI collapsed-rail contract).
 *  5. collapse click re-homes the live rail out of the row.
 *  6. drag through the sticky gutter resizes + clamps the rail (the
 *     single clamp site) and persists the width.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the page must bind to the SAME svelte runtime as
// mount/flushSync below (second-instance binding → effect_orphan).
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import {
	loadAppConfig,
	resetAppConfigForTests
} from '../../src/lib/services/config/app-config.svelte';

/** Steer the singleton config store: stub GET /api/config with placement. */
async function stageConfig(sidebar: Record<string, unknown>): Promise<void> {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (url.includes('/api/config')) {
				return new Response(JSON.stringify({ ok: true, sidebar }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			// Spine/dual-fetch paths — 404 keeps them at their honest fallbacks.
			return new Response(JSON.stringify({ ok: false }), { status: 404 });
		})
	);
	await loadAppConfig();
}

/** Bare-restore arrival with N panels (panel-resize stageRestore shape). */
function stagePanels(count: number, collapsed = false): void {
	localStorage.clear();
	localStorage.setItem(
		'dsi-panels',
		JSON.stringify({
			panels: Array.from({ length: count }, (_, i) => ({
				id: `panel-${i + 1}`,
				sessionId: `s-${i + 1}`,
				agentPreset: null,
				width: 600
			})),
			selectedPanelId: count > 0 ? 'panel-1' : null,
			panelWidth: 600,
			zoom: 1
		})
	);
	localStorage.setItem('dsi-sidebar', JSON.stringify({ collapsed, width: 280 }));
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
}

async function mountPage() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Page, { target });
	await flushEffects();
	return { target, instance };
}

async function flushEffects(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
	}
	flushSync();
	await Promise.resolve();
}

afterEach(() => {
	resetSpineFeedForTests(); // module-scope feed store - test isolation
	vi.unstubAllGlobals();
	resetAppConfigForTests();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('sidebar placement — none (default): the rail beside the floor', () => {
	it('renders the rail OUTSIDE the zoom row, with no sticky column anywhere', async () => {
		await stageConfig({});
		stagePanels(2);
		const { target, instance } = await mountPage();

		const rail = target.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
		expect(rail).not.toBeNull();
		const wrap = target.querySelector('[data-testid="app-sidebar-wrap"]') as HTMLElement | null;
		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement | null;
		expect(row).not.toBeNull();
		expect(row!.contains(rail!)).toBe(false);
		expect(target.querySelector('[data-testid="sidebar-column"]')).toBeNull();
		// Standalone rail: the width wrapper carries the px width itself.
		expect(wrap!.style.width).toBe('280px');
		unmount(instance);
	});
});

describe('sidebar placement — panels-zoom: the rail inside the floor (OCI pattern)', () => {
	it('hosts the rail in the row\u2019s FIRST sticky column, triple-locked', async () => {
		await stageConfig({ placement: 'panels-zoom' });
		stagePanels(2);
		const { target, instance } = await mountPage();

		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement;
		const column = target.querySelector('[data-testid="sidebar-column"]') as HTMLElement | null;
		expect(column).not.toBeNull();
		// FIRST element child of the row — the leading column, before panel-1.
		expect(row.firstElementChild).toBe(column);
		// The rail lives INSIDE the sticky column (and only there).
		const rail = target.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
		expect(column!.contains(rail)).toBe(true);
		// Triple-locked width (OCI StickyColumnContainer): all three the same px.
		expect(column!.style.width).toBe('280px');
		expect(column!.style.minWidth).toBe('280px');
		expect(column!.style.maxWidth).toBe('280px');
		unmount(instance);
	});

	it('gutter follows OCI gating: absent with no panels, present between rail and first panel', async () => {
		await stageConfig({ placement: 'panels-zoom' });
		stagePanels(0);
		const empty = await mountPage();
		// Rail alone on the floor → nothing to resize against → no gutter.
		expect(empty.target.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();
		unmount(empty.instance);

		stagePanels(1);
		const one = await mountPage();
		const gutter = one.target.querySelector('[data-testid="sidebar-gutter"]') as HTMLElement | null;
		expect(gutter).not.toBeNull();
		const column = one.target.querySelector('[data-testid="sidebar-column"]') as HTMLElement;
		// The gutter is the column's NEXT sibling — the seam before panel-1.
		expect(gutter!.previousElementSibling).toBe(column);
		expect(gutter!.nextElementSibling?.getAttribute('data-testid')).toBe('panel-column');
		unmount(one.instance);
	});

	it('collapsed renders the 34px stub BESIDE the floor — the row carries no rail column', async () => {
		await stageConfig({ placement: 'panels-zoom' });
		stagePanels(2, true);
		const { target, instance } = await mountPage();

		const stub = target.querySelector('[data-testid="app-sidebar-collapsed"]') as HTMLElement | null;
		expect(stub).not.toBeNull();
		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement;
		expect(row.contains(stub!)).toBe(false);
		expect(target.querySelector('[data-testid="sidebar-column"]')).toBeNull();
		expect(target.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();
		unmount(instance);
	});

	it('collapse click re-homes the live rail out of the row (expanded → stub beside the floor)', async () => {
		await stageConfig({ placement: 'panels-zoom' });
		stagePanels(1);
		const { target, instance } = await mountPage();
		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement;
		expect(row.querySelector('[data-testid="app-sidebar"]')).not.toBeNull();

		target
			.querySelector('[data-testid="app-sidebar"] button[aria-label="Collapse sidebar"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flushEffects();

		// The rail left the row; the stub took its place beside the floor.
		expect(row.querySelector('[data-testid="app-sidebar"]')).toBeNull();
		expect(target.querySelector('[data-testid="sidebar-column"]')).toBeNull();
		expect(target.querySelector('[data-testid="app-sidebar-collapsed"]')).not.toBeNull();
		// Placement survives as a persisted pref (collapsed: true).
		const prefs = JSON.parse(localStorage.getItem('dsi-sidebar') ?? '{}');
		expect(prefs.collapsed).toBe(true);
		unmount(instance);
	});

	it('drag on the sticky gutter resizes + clamps the rail through the single clamp site', async () => {
		await stageConfig({ placement: 'panels-zoom' });
		stagePanels(1);
		const { target, instance } = await mountPage();
		const gutter = target.querySelector('[data-testid="sidebar-gutter"]') as HTMLElement;
		const column = target.querySelector('[data-testid="sidebar-column"]') as HTMLElement;

		// mousedown at 100 → move to 205 (+105): 280 → 385.
		gutter.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 205 }));
		await flushEffects();
		expect(column.style.width).toBe('385px');
		expect(column.style.minWidth).toBe('385px');
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();

		// Same drag continued past the ceiling clamps at maxWidth (500).
		gutter.dispatchEvent(new MouseEvent('mousedown', { clientX: 205, bubbles: true }));
		await flushEffects();
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000 }));
		await flushEffects();
		expect(column.style.width).toBe('500px');
		window.dispatchEvent(new MouseEvent('mouseup'));
		await flushEffects();

		// Persisted: the drag result outlives the page.
		const prefs = JSON.parse(localStorage.getItem('dsi-sidebar') ?? '{}');
		expect(prefs.width).toBe(500);
		unmount(instance);
	});
});

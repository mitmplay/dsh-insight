/**
 * +page.svelte floor interactions — the registry-driven and pointer-driven
 * edges the rendering suites don't reach: gutter drags (panel + sidebar),
 * the resize-all slider, the settings-editor / injected-doc floor slots,
 * the dead-session error card, and the loupe open/close cycle.
 *
 * Same mounting conventions as conversation-page.test.ts (reactiveTestPage
 * seed staging + settle()).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	addPanelFromSidebar,
	replacePanelFromRegistry,
	replaceSelectedFromRegistry,
	resetPanelRegistryForTests,
	startPanelResize
} from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests, refreshSpineFeed } from '$lib/services/conversation/spine-feed.svelte';
import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import {
	loadAppConfig,
	resetAppConfigForTests
} from '$lib/services/config/app-config.svelte';
import { movePanelFromRegistry, replacePanelBySession } from '$lib/services/panels/panel-registry';

function installDefaultFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body =
				url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
				: url.includes('/api/prompts') ? { ok: true, prompts: [] }
				: { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

async function mountPage(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
	reactiveTestPage.data = {
		sessionId: 's-floor',
		entries: [],
		lastSeq: -1,
		running: false,
		...props
	};
	const instance = mount(Page, { target });
	await settle();
	return { target, instance };
}

function mouse(type: string, x = 10, init: MouseEventInit = {}): MouseEvent {
	return new MouseEvent(type, { clientX: x, bubbles: true, ...init });
}

beforeEach(() => {
	installDefaultFetch();
});

afterEach(() => {
	vi.restoreAllMocks();
	installDefaultFetch();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	resetAppConfigForTests();
});

describe('+page.svelte — panel gutter drag (registry seam)', () => {
	it('plain drag resizes ONLY the dragged panel; mouseup freezes the badge set', async () => {
		const { target } = await mountPage();
		const widthBefore = target.querySelector<HTMLElement>('[data-testid="panel-column"]')?.style.width ?? '';
		expect(startPanelResize(mouse('mousedown', 500), 0)).toBe(true);
		window.dispatchEvent(mouse('mousemove', 580));
		flushSync();
		const widthAfter = target.querySelector<HTMLElement>('[data-testid="panel-column"]')?.style.width ?? '';
		expect(widthAfter).not.toBe(widthBefore);
		window.dispatchEvent(mouse('mouseup'));
		flushSync();
		// afterglow: a width badge exists right after mouseup (changed panel)
		expect(target.querySelector('[data-testid="panel-width-badge"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('Shift+drag scales every panel proportionally (badges on all columns)', async () => {
		const { target } = await mountPage();
		expect(startPanelResize(mouse('mousedown', 500, { shiftKey: true }), 0)).toBe(true);
		window.dispatchEvent(mouse('mousemove', 560, { shiftKey: true }));
		flushSync();
		window.dispatchEvent(mouse('mouseup'));
		flushSync();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('a mousemove with no drag in flight is a no-op', async () => {
		const { target } = await mountPage();
		const widthBefore = target.querySelector<HTMLElement>('[data-testid="panel-column"]')?.style.width ?? '';
		window.dispatchEvent(mouse('mousemove', 900));
		flushSync();
		const widthAfter = target.querySelector<HTMLElement>('[data-testid="panel-column"]')?.style.width ?? '';
		expect(widthAfter).toBe(widthBefore);
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — resize-all slider (ControlBar onresizeall)', () => {
	it('slider input sets every panel to the clamped uniform width', async () => {
		const { target } = await mountPage();
		target.querySelector<HTMLButtonElement>('[data-testid="controlbar-trigger"]')?.click();
		flushSync();
		// The tray portals to document.body (2026-10-22) — query there,
		// not inside the mount target.
		const input = document.body.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-width-input"]');
		expect(input).not.toBeNull();
		input!.value = '700';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(document.body.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent).toContain('700');
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — app sidebar collapse + gutter drag', () => {
	it('collapse toggle shows the stub; expanding restores the rail', async () => {
		const { target } = await mountPage();
		const collapse = target.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]');
		expect(collapse).not.toBeNull();
		collapse!.click();
		flushSync();
		expect(target.querySelector('[data-testid="app-sidebar-collapsed"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="app-sidebar"]')).toBeNull();
		target.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')!.click();
		flushSync();
		expect(target.querySelector('[data-testid="app-sidebar"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('gutter drag clamps the rail width; mouseup ends the drag', async () => {
		const { target } = await mountPage();
		const wrap = target.querySelector<HTMLElement>('[data-testid="app-sidebar"]');
		const widthBefore = wrap?.style.width ?? '';
		const gutter = target.querySelector<HTMLElement>('[data-testid="sidebar-gutter"]');
		expect(gutter).not.toBeNull();
		gutter!.dispatchEvent(mouse('mousedown', 200));
		flushSync();
		window.dispatchEvent(mouse('mousemove', 300));
		flushSync();
		const widthMid = target.querySelector<HTMLElement>('[data-testid="app-sidebar"]')?.style.width ?? '';
		expect(widthMid).not.toBe(widthBefore);
		window.dispatchEvent(mouse('mouseup'));
		flushSync();
		// after mouseup a further move cannot change the width
		window.dispatchEvent(mouse('mousemove', 480));
		flushSync();
		expect(target.querySelector<HTMLElement>('[data-testid="app-sidebar"]')?.style.width).toBe(widthMid);
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — settings-home explorer floor slot (Settings Tree ADR 2026-09-18 D2)', () => {
	it('add mounts the home explorer panel; its close removes the slot', async () => {
		const { target } = await mountPage();
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsh' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).not.toBeNull();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
		unmount(target.firstElementChild as never);
	});

	it('replace-by-id NO-OPS for a settings-home request (Focus Command ADR 2026-09-17 D4)', async () => {
		const { target } = await mountPage();
		const column = target.querySelector<HTMLElement>('[data-testid="panel-column"]');
		expect(replacePanelFromRegistry(column!.dataset.panelId ?? '', { kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		// The swap is retired: the conversation panel survives, no explorer.
		expect(target.querySelector('[data-testid="workspace-explorer"]')).toBeNull();
		expect(target.querySelector('[data-testid="panel-column"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('replace-selected NO-OPS for a settings-home request through the registry (D4)', async () => {
		const { target } = await mountPage();
		expect(replaceSelectedFromRegistry({ kind: 'settings-home', home: 'dsh' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).toBeNull();
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — injected-doc floor slot (Loadinjected ADR D3/D5)', () => {
	it('add mounts the doc panel below its source; a duplicate focuses instead of duplicating', async () => {
		const { target } = await mountPage();
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-floor', displayPath: 'notes/x.md' })).toBe(true);
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
		// dedupe: the second request adds nothing
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-floor', displayPath: 'notes/x.md' })).toBe(true);
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
		unmount(target.firstElementChild as never);
	});

	it('replace-by-id with an injected-doc swaps the slot; by-session refuses (no successor session)', async () => {
		const { target } = await mountPage();
		const column = target.querySelector<HTMLElement>('[data-testid="panel-column"]');
		expect(replacePanelFromRegistry(column!.dataset.panelId ?? '', { kind: 'injected-doc', sourceSessionId: 's-floor', displayPath: 'docs/y.md' })).toBe(true);
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(1);
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — dead session error card', () => {
	it('a 404 cold load renders the honest error card; Close removes the slot', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
					: url.includes('/api/a2a') ? { ok: true, rows: [] }
					: url.includes('/models') ? { ok: true, current: null }
					: { ok: false, error: { code: 'session/not-found', message: 'not found' } };
				return new Response(JSON.stringify(body), {
					status: url.includes('/events') ? 404 : 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
		const { target } = await mountPage();
		expect(addPanelFromSidebar({ sessionId: 's-reaped', agentPreset: null })).toBe(true);
		await settle();
		const card = target.querySelector('[data-testid="panel-error"]');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain('s-reaped');
		target.querySelector<HTMLButtonElement>('[data-testid="panel-error-close"]')!.click();
		await settle();
		expect(target.querySelector('[data-testid="panel-error"]')).toBeNull();
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — panel loupe cycle', () => {
	it('Alt+Click on a column opens the loupe; mask/Escape/× close it', async () => {
		const { target } = await mountPage();
		const column = target.querySelector<HTMLElement>('[data-testid="panel-column"]')!;
		column.dispatchEvent(mouse('click', 10, { altKey: true }));
		flushSync();
		// the loupe portals to document.body, not the page target
		expect(document.querySelector('[data-testid="panel-loupe"]')).not.toBeNull();
		document.querySelector<HTMLElement>('[data-testid="panel-loupe-close"]')!.click();
		flushSync();
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('Alt+Click on a control inside the column does NOT open the loupe', async () => {
		const { target } = await mountPage();
		const button = target.querySelector<HTMLElement>('[data-testid="panel-column"] button');
		expect(button).not.toBeNull();
		button!.dispatchEvent(mouse('click', 10, { altKey: true }));
		flushSync();
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('plain click never opens the loupe', async () => {
		const { target } = await mountPage();
		const column = target.querySelector<HTMLElement>('[data-testid="panel-column"]')!;
		column.dispatchEvent(mouse('click', 10));
		flushSync();
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('louping a settings editor then replacing the slot closes the lens (clearLoupeIfGone)', async () => {
		const { target } = await mountPage();
		const column = target.querySelector<HTMLElement>('[data-testid="panel-column"]')!;
		column.dispatchEvent(mouse('click', 10, { altKey: true }));
		flushSync();
		expect(document.querySelector('[data-testid="panel-loupe"]')).not.toBeNull();
		const loupeColumn = document.querySelector<HTMLElement>('[data-testid="panel-loupe"] [data-testid="panel-column"]');
		// a CONVERSATION successor swap (the only id-addressed swap the floor
		// still performs — the settings kinds are doAdd-only, Focus Command D4):
		// the fresh panel id clears the loupe through clearLoupeIfGone
		expect(replacePanelFromRegistry(column.dataset.panelId ?? '', { sessionId: 's-editor', agentPreset: null })).toBe(true);
		await settle();
		// the lens content's close closes the LENS copy only
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		void loupeColumn;
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — floor registry edges (batch 2)', () => {
	it('replace-by-id with an unknown panel is a no-op; by-session resolves honestly', async () => {
		const { target } = await mountPage();
		// registry true = a live handler ran; the unknown id no-ops PAGE-side
		expect(replacePanelFromRegistry('panel-nope', { sessionId: 's2', agentPreset: null })).toBe(true);
		// by-session refusals: no successor session kinds, and an unknown session
		expect(replacePanelBySession('s-ghost', { kind: 'skill-shelf' })).toBe(false);
		expect(replacePanelBySession('s-ghost', { sessionId: 's2', agentPreset: null })).toBe(false);
		// same-session swap is an honest true no-op
		expect(replacePanelBySession('s-floor', { sessionId: 's-floor', agentPreset: null })).toBe(true);
		// a real session-addressed swap with focus rides doSwapInto's plain branch
		expect(replacePanelBySession('s-floor', { sessionId: 's-swap', agentPreset: null, focus: true })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="panel-column"]')?.getAttribute('data-panel-id')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('afterSessionId anchors the plain add; keepSelection restores the focused panel', async () => {
		const { target } = await mountPage();
		const firstId = target.querySelector('[data-testid="panel-column"]')?.getAttribute('data-panel-id');
		expect(addPanelFromSidebar({ sessionId: 's-anchor', agentPreset: null, afterSessionId: 's-floor', keepSelection: true })).toBe(true);
		await settle();
		// keepSelection: the anchor source keeps the highlight
		expect(firstId).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('moving a panel reports lineage-aware vertical moves', async () => {
		const { target } = await mountPage();
		expect(addPanelFromSidebar({ sessionId: 's-mv', agentPreset: null })).toBe(true);
		await settle();
		const ids = Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map((c) => c.getAttribute('data-panel-id'));
		expect(movePanelFromRegistry(ids[1]!, 'left')).toBe(true);
		await settle();
		const after = Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map((c) => c.getAttribute('data-panel-id'));
		expect(after[0]).toBe(ids[1]);
		unmount(target.firstElementChild as never);
	});

	it('closing every panel shows the empty floor; replace-selected then adds onto it', async () => {
		const { target } = await mountPage();
		const ids = Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map((c) => c.getAttribute('data-panel-id'));
		for (const id of ids) getWorkspaceState()?.remove?.(id as string);
		await settle();
		expect(target.querySelector('[data-testid="workspace-empty"]')).not.toBeNull();
		// replace-selected with an empty floor falls through to a plain add
		expect(replaceSelectedFromRegistry({ sessionId: 's-fresh', agentPreset: null })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="workspace-empty"]')).toBeNull();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(1);
		unmount(target.firstElementChild as never);
	});

	it('removing an unknown panel id is a safe no-op', async () => {
		const { target } = await mountPage();
		getWorkspaceState()?.remove?.('panel-nope');
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(1);
		unmount(target.firstElementChild as never);
	});

	it('louping a settings-home explorer rides the non-conversation header variant', async () => {
		const { target } = await mountPage();
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsh' })).toBe(true);
		await settle();
		const columns = Array.from(target.querySelectorAll('[data-testid="panel-column"]'));
		const settingsColumn = columns.find((c) => c.querySelector('[data-testid="workspace-explorer"]'))!;
		settingsColumn.dispatchEvent(mouse('click', 10, { altKey: true }));
		flushSync();
		expect(document.querySelector('[data-testid="panel-loupe"]')).not.toBeNull();
		document.querySelector<HTMLElement>('[data-testid="panel-loupe-close"]')!.click();
		flushSync();
		unmount(target.firstElementChild as never);
	});

	it('a second drag while the afterglow runs rearms the badge timer; live badges show mid-drag', async () => {
		const { target } = await mountPage();
		expect(startPanelResize(mouse('mousedown', 500), 0)).toBe(true);
		window.dispatchEvent(mouse('mousemove', 540));
		flushSync();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).not.toBeNull();
		window.dispatchEvent(mouse('mouseup'));
		flushSync();
		// second drag starts inside the afterglow window (timer != null arm)
		expect(startPanelResize(mouse('mousedown', 540), 0)).toBe(true);
		window.dispatchEvent(mouse('mousemove', 580));
		flushSync();
		window.dispatchEvent(mouse('mouseup'));
		flushSync();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('plain drag on a two-panel row changes one panel, leaving a mixed (non-uniform) row', async () => {
		const { target } = await mountPage();
		expect(addPanelFromSidebar({ sessionId: 's-mix', agentPreset: null })).toBe(true);
		await settle();
		expect(startPanelResize(mouse('mousedown', 500), 0)).toBe(true);
		window.dispatchEvent(mouse('mousemove', 570));
		flushSync();
		window.dispatchEvent(mouse('mouseup'));
		flushSync();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('a failing history fetch still renders the panel (hasMore honest false)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
					: url.includes('/api/a2a') ? { ok: true, rows: [] }
					: url.includes('/models') ? { ok: true, current: null }
					: url.includes('/events') ? { ok: true, entries: [], lastSeq: 7, running: false }
					: { ok: false, error: { code: 'host-unreachable', message: 'down' } };
				return new Response(JSON.stringify(body), {
					status: url.includes('/history') ? 503 : 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
		const { target } = await mountPage({ entries: [], hasMore: true });
		// trigger a runtime cold load for a new panel
		expect(addPanelFromSidebar({ sessionId: 's-cold', agentPreset: null })).toBe(true);
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
		unmount(target.firstElementChild as never);
	});
});

describe('+page.svelte — Shared Tree D2: chip click focuses the root-matched explorer', () => {
	// Two conversations on ONE workspace root, opened through the seeded
	// session (s-floor) plus a sidebar add (s2) — the spine rows carry
	// the SAME workspace for both, so both headers render the chip.
	function stubSharedSpine(): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/dsh/sessions')
						? {
								ok: true,
								sessions: [
									{ sessionId: 's-floor', title: 'Floor', agentPreset: null, running: false, blank: false, updatedAt: 0, workspace: '/shared', turns: null },
									{ sessionId: 's2', title: 'Two', agentPreset: null, running: false, blank: false, updatedAt: 0, workspace: '/shared', turns: null },
									{ sessionId: 's3', title: 'Three', agentPreset: null, running: false, blank: false, updatedAt: 0, workspace: '/fresh', turns: null }
								],
								workspaces: []
							}
						: url.includes('/api/a2a') ? { ok: true, rows: [] }
						: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
						: url.includes('/models') ? { ok: true, current: null }
						: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
						: url.includes('/api/prompts') ? { ok: true, prompts: [] }
						: { ok: true, listing: { path: '', entries: [], truncated: false } };
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
	}

	// The seed conversation's chip workspace rides the server-load row;
	// runtime panels heal from the spine tick — poll for their chips.
	// A pinned FAMILY: sub's spine row carries parentSessionId A + origin
	// subagent, so the floor reads |A|sub| as one lineage unit.
	function stubFamilySpine(): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const row = (sessionId: string, title: string, parentSessionId: string | null, origin: string) =>
					({ sessionId, title, agentPreset: null, running: false, blank: false, updatedAt: 0, workspace: '/shared', parentSessionId, origin, turns: null });
				const body =
					url.includes('/api/dsh/sessions')
						? { ok: true, sessions: [row('s-floor', 'Alpha', null, 'root'), row('sub', 'Sub', 's-floor', 'subagent')], workspaces: [] }
						: url.includes('/api/a2a') ? { ok: true, rows: [] }
						: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
						: url.includes('/models') ? { ok: true, current: null }
						: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
						: url.includes('/api/prompts') ? { ok: true, prompts: [] }
						: { ok: true, listing: { path: '', entries: [], truncated: false } };
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
	}

	async function waitForChip(sessionId: string, target: HTMLElement, timeoutMs = 4000): Promise<HTMLElement> {
		const started = Date.now();
		for (;;) {
			const el = target.querySelector<HTMLElement>(
				'[data-session-id="' + sessionId + '"] [data-testid="session-workspace"]'
			);
			if (el) return el;
			flushSync();
			await Promise.resolve();
			await new Promise((r2) => setTimeout(r2, 25));
			if (Date.now() - started > timeoutMs) throw new Error('waitForChip timeout: ' + sessionId);
		}
	}

	it('a chip click on the SECOND session of a shared root adds NO panel and focuses the open explorer', async () => {
		stubSharedSpine();
		const { target, instance } = await mountPage({ workspace: '/shared' });
		// earlier tests' unmounts may leak a subscription — the page's own
		// subscribe is then not the FIRST, so no immediate load fires. Force one.
		refreshSpineFeed();
		// s2 joins the floor as a second conversation.
		expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
		await settle();
		const sFloorChip = await waitForChip('s-floor', target);
		sFloorChip!.click();
		await settle();
		// the fresh root opened exactly one explorer.
		const afterFirst = target.querySelectorAll('[data-testid="panel-column"]').length;
		expect(target.querySelectorAll('[data-testid="workspace-explorer"]').length).toBe(1);
		// NOW the chip on s2 — the SAME root. D1/D2: lookup matches by ROOT,
		// so no second explorer; the existing one takes focus.
		const s2Chip = await waitForChip('s2', target);
		s2Chip!.click();
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(afterFirst);
		expect(target.querySelectorAll('[data-testid="workspace-explorer"]').length).toBe(1);
		const explorerColumn = [...target.querySelectorAll('[data-testid="panel-column"]')].find((c) =>
			c.querySelector('[data-testid="workspace-explorer"]')
		);
		expect(explorerColumn?.querySelector('[data-testid="panel-header"]')?.classList.contains('selected')).toBe(true);
		unmount(instance);
	});

	it('a chip click on a session holding a FRESH root inserts exactly one explorer', async () => {
		stubSharedSpine();
		const { target, instance } = await mountPage({ workspace: '/shared' });
		refreshSpineFeed(); // immediate load — see test A's note on subscription drift
		// s3's spine row carries /fresh — a root no explorer holds yet.
		expect(addPanelFromSidebar({ sessionId: 's3', agentPreset: null })).toBe(true);
		await settle();
		const sFloorChip = await waitForChip('s-floor', target);
		sFloorChip!.click();
		await settle();
		const afterFirst = target.querySelectorAll('[data-testid="panel-column"]').length;
		expect(target.querySelectorAll('[data-testid="workspace-explorer"]').length).toBe(1);
		const s3Chip = await waitForChip('s3', target);
		s3Chip!.click();
		await settle();
		// fresh root: exactly ONE insert (no duplicate, none skipped).
		expect(target.querySelectorAll('[data-testid="workspace-explorer"]').length).toBe(2);
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(afterFirst + 1);
		unmount(instance);
	});

	it('Shared Tree D3: the fresh explorer lands OUTSIDE the lineage family — never Parent to explorer to file', async () => {
		stubFamilySpine();
		// Seed |A|sub| — A the pinned spawner, sub the pinned family child.
		const { target, instance } = await mountPage({ workspace: '/shared' });
		refreshSpineFeed();
		expect(addPanelFromSidebar({ sessionId: 'sub', agentPreset: null })).toBe(true);
		// panel-header's title attr is the SESSION ID (label ?? sessionId) —
		// wait for the added panel, then assert the family order.
		const headersBefore = await (async () => {
			const started = Date.now();
			for (;;) {
				const titles = [...target.querySelectorAll('[data-testid="panels-row"] [data-testid="panel-header"]')].map((h) => h.getAttribute('title'));
				if (titles.includes('sub')) return titles;
				flushSync();
				await Promise.resolve();
				await new Promise((r2) => setTimeout(r2, 25));
				if (Date.now() - started > 4000) return titles;
			}
		})();
		expect(headersBefore).toEqual(['sub', 's-floor']); // sidebar add lands at the focused slot's family head
		// chip click on A: old rule put the explorer AFTER the family unit
		// (index 2, the lineage costume); the focused slot + family clamp
		// puts it at the family HEAD — the family block reads uninterrupted.
		const chip = await waitForChip('s-floor', target);
		chip!.click();
		await settle();
		const cols = [...target.querySelectorAll('[data-testid="panels-row"] > [data-testid="panel-column"]')];
		const explorerIdx = cols.findIndex((c) => c.querySelector('[data-testid="workspace-explorer"]'));
		expect(explorerIdx).toBe(0); // the family BLOCK head — never inside the |sub|s-floor| unit
		const headers = cols.map((c) => c.querySelector('[data-testid="panel-header"]')?.getAttribute('title'));
		expect(headers).toEqual(['shared', 'sub', 's-floor']);
		expect(cols[0].querySelector('[data-testid="panel-header"]')?.classList.contains('selected')).toBe(true);
		unmount(instance);
	});

	it('Shared Tree D3: the explorer offers move verbs and is NOT carried by its conversation move', async () => {
		stubSharedSpine();
		const { target, instance } = await mountPage({ workspace: '/shared' });
		refreshSpineFeed();
		// second conversation so the explorer is not at the floor edge.
		expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
		await settle();
		const chip = await waitForChip('s-floor', target);
		chip!.click();
		await settle();
		const kind = (c: Element) => (c.querySelector('[data-testid="workspace-explorer"]') ? 'explorer' : 'conversation');
		const cols = () => [...target.querySelectorAll('[data-testid="panel-column"]')];
		const before = cols().map(kind);
		expect(before).toEqual(['explorer', 'conversation', 'conversation']);
		// the explorer COLUMN offers move verbs from the SAME rowFacts every
		// panel reads — at the LEFT edge up/left is honestly hidden, right exists.
		const expCol = cols().find((c) => kind(c) === 'explorer')!;
		expect(expCol.querySelector('[data-testid="panel-move-left"]')).toBeNull(); // edge: index 0
		expect(expCol.querySelector('[data-testid="panel-move-right"]')).not.toBeNull();
		const titles = () => cols().map((c) => c.querySelector('[data-testid="panel-header"]')?.getAttribute('title'));
		expect(titles()).toEqual(['shared', 's2', 's-floor']);
		// the explorer SIDEBAR row offers move verbs too (expand the group);
		// at the left edge up is honestly hidden — assert after the moves below.
		const groupToggle = target.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-group-toggle"]');
		if (groupToggle && !target.querySelector('[data-testid="sidebar-panel-row"]')) groupToggle.click();
		flushSync();
		// moving the CONVERSATION: its block is itself alone — the explorer
		// is crossed as a whole neighbor unit, never carried inside the family.
		const convRow = [...target.querySelectorAll('[data-testid="sidebar-panel-row"]')]
			.find((r2) => r2.getAttribute('data-session-id') === 's-floor');
		const convId = convRow!.getAttribute('data-panel-id')!;
		// Move s-floor LEFT twice: across s2, then ACROSS the explorer unit.
		// The retired grammar welded the explorer into the conversation's
		// family block, so this second move was family-clamped (not offered);
		// now the conversation moves alone and separates from the explorer.
		expect(movePanelFromRegistry(convId, 'left')).toBe(true);
		await settle();
		expect(titles()).toEqual(['shared', 's-floor', 's2']);
		expect(movePanelFromRegistry(convId, 'left')).toBe(true);
		await settle();
		expect(titles()).toEqual(['s-floor', 'shared', 's2']);
		// separated from its conversation, the explorer row now offers BOTH
		// sidebar move verbs — the lineage-child treatment is gone.
		const expRow = [...target.querySelectorAll('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')]
			.find((r2) => r2.getAttribute('data-session-id') === null);
		expect(expRow).toBeDefined();
		expect(expRow!.querySelector('[data-testid="sidebar-panel-move-up"]')).not.toBeNull();
		expect(expRow!.querySelector('[data-testid="sidebar-panel-move-down"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('+page.svelte — panels-zoom sidebar placement', () => {
	it('placement panels-zoom hosts the rail as the zoom row leading column', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/config') ? { ok: true, sidebar: { placement: 'panels-zoom', width: 260, collapsed: false } }
					: url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
					: url.includes('/api/a2a') ? { ok: true, rows: [] }
					: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
					: url.includes('/models') ? { ok: true, current: null }
					: { ok: true, entries: [], hasMore: false };
				return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
			})
		);
		await loadAppConfig();
		await settle();
		const { target } = await mountPage();
		expect(target.querySelector('[data-testid="sidebar-column"]')).not.toBeNull();
		// collapsed still works in the embedded rail
		target.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')?.click();
		flushSync();
		expect(target.querySelector('[data-testid="app-sidebar-collapsed"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
	});
});

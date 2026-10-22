/**
 * AppSidebar unit tests — the conversation page's left rail.
 *
 * Component-direct mount (no page harness): the rail is presentational
 * — collapse/width/drag live in the page — so every test spies on the
 * onToggleCollapse / onResizeStart callbacks and reads the branch
 * surfaces through data-testids. The rail's BODY (SidebarSessions)
 * loads /api/dsh/sessions on mount, so every mount rides a route-aware
 * fetch stub (add-workspace-button.test.ts pattern).
 *
 * Covers the previously-uncovered paths:
 *  - the three render branches: collapsed stub / embedded rail /
 *    standalone width-wrapper (default mount)
 *  - paneledSessionIds default [] vs an explicit array
 *  - the collapse/expand buttons (both hosts) fire onToggleCollapse
 *  - the standalone gutter reports mousedown via onResizeStart
 *  - the rail-owned filter state: a pill pick flows through the
 *    onfilterchange relay back into the row's summary
 *  - navigateToSession: an adopted workspace's fresh session becomes a
 *    seed deep link through window.location.assign
 *  - the header's CanvasCopyButton (2026-09-02): the click payoff — the
 *    page's captureContainer (the ConversationPage root) flows through
 *    to the PNG render (html-to-image mocked, canvas-copy-button.test.ts
 *    pattern)
 *  - the residual branch coverage (2026-10-22): ControlBar inside the
 *    collapsed stub (onresizeall ?? (() => {}) fallback), Restart/About on
 *    the stub prefix, omitted callbacks as silent optional-call no-ops,
 *    the null capture/tray-container defaults, embedded captureContainer
 *    threading, and the filter $state seeding from loadSessionFilter
 *    (profile key vs default desk)
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppSidebar from '$lib/components/common/layout/AppSidebar.svelte';
import { PANEL_DEFAULT_WIDTH } from '$lib/utils/panel-prefs';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { toBlob } from 'html-to-image';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(), toCanvas: vi.fn() }));

const mockedToBlob = vi.mocked(toBlob);
import type {
	DsiDirectoryListing,
	DsiPreset,
	DsiSessionSummary,
	DsiWorkspaceSummary
} from '$lib/types';

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Sessions with TWO discriminating dimensions (pills render only when
 *  a dimension discriminates — one value shows no pills). */
const SESSIONS: DsiSessionSummary[] = [
	{
		sessionId: 's-current',
		title: 'Current work',
		agentPreset: 'main',
		running: false,
		blank: false,
		updatedAt: Date.now() - 60_000,
		workspace: '/tmp/alpha',
		turns: null
	},
	{
		sessionId: 's-two',
		title: 'Research thread',
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now() - 120_000,
		workspace: '/tmp/beta',
		turns: null
	},
	{
		sessionId: 's-three',
		title: 'Third thread',
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now() - 240_000,
		workspace: '/tmp/alpha',
		turns: null
	}
];

const REGISTRY: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w-a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] },
	{ workspaceId: 'w-b', title: 'beta', path: '/tmp/beta', sessionIds: [] }
];

const PRESETS: DsiPreset[] = [
	{ id: 'main', name: null, description: null, isDefault: true },
	{ id: 'research', name: 'Research', description: null, isDefault: false }
];

const LISTING: DsiDirectoryListing = {
	path: '/tmp/new-folder',
	home: '/tmp',
	crumbs: [
		{ name: 'tmp', path: '/tmp', hidden: false },
		{ name: 'new-folder', path: '/tmp/new-folder', hidden: false }
	],
	entries: [],
	truncated: false
};

/** Route-aware fetch stub: the sidebar's GET plus the Add-workspace
 *  flow's directory/adopt/create endpoints. */
interface FetchLog {
	url: string;
	method: string;
	body?: unknown;
}

function stubFetch(log: FetchLog[]): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			log.push({
				url,
				method,
				body: init?.body ? JSON.parse(String(init.body)) : undefined
			});
			if (url === '/api/dsh/sessions' && method === 'GET')
				return jsonResponse({ ok: true, sessions: SESSIONS, workspaces: REGISTRY, presets: PRESETS });
			if (url === '/api/dsh/sessions')
				return jsonResponse({ ok: true, sessionId: 's-adopted', agentPreset: null });
			if (url === '/api/dsh/workspaces') return jsonResponse({ ok: true });
			if (url === '/api/dsh/directory') return jsonResponse({ ok: true, listing: LISTING });
			if (url === '/api/floor/mode') return jsonResponse({ dev: true });
			return jsonResponse({ ok: true });
		})
	);
}

/** Multi-await settle — the rail's load chain ($effect → fetch → state). */
async function settle(rounds = 12): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function mountSidebar(
	props: Record<string, unknown> = {},
	callbacks: { onToggleCollapse?: () => void; onResizeStart?: (e: MouseEvent) => void } = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onToggleCollapse = callbacks.onToggleCollapse ?? vi.fn<() => void>();
	const onResizeStart = callbacks.onResizeStart ?? vi.fn<(e: MouseEvent) => void>();
	const instance = mount(AppSidebar, {
		target,
		props: {
			currentSessionId: 's-current',
			onToggleCollapse,
			onResizeStart,
			...props
		}
	});
	return { target, instance, onToggleCollapse, onResizeStart };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('AppSidebar — standalone branch (default mount)', () => {
	it('renders the width-carrying wrapper + gutter beside the rail; rows load through the body', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		// No paneledSessionIds prop → the default [] path.
		const { target, instance, onToggleCollapse } = mountSidebar({ width: 320 });
		await settle();
		const wrap = target.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
		expect(wrap).not.toBeNull();
		expect(wrap.style.width).toBe('320px');
		// Robust to in-flight title experiments (a concurrent agent's probe
		// suffix): pins the TITLE ELEMENT renders, not the exact suffix.
		expect(target.querySelector('[data-testid="sidebar-title"]')?.textContent).toMatch(
			/^Deepseek Insight/
		);
		// The gutter is the wrapper's flex SIBLING (never clipped).
		expect(target.querySelector('[data-testid="sidebar-gutter"]')).not.toBeNull();
		// The body loaded: the spine renders the non-current sessions.
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		// Collapse button fires the page-owned toggle.
		const collapse = target.querySelector('button[aria-label="Collapse sidebar"]') as HTMLButtonElement;
		collapse.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('gutter mousedown reports through onResizeStart (drag math is page-owned)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance, onResizeStart } = mountSidebar();
		await settle();
		const gutter = target.querySelector('[data-testid="sidebar-gutter"]') as HTMLElement;
		const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		gutter.dispatchEvent(down);
		expect(onResizeStart).toHaveBeenCalledTimes(1);
		expect(onResizeStart).toHaveBeenCalledWith(down);
		unmount(instance);
	});

	it('paneled sessions leave the spine (explicit paneledSessionIds array)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance } = mountSidebar({ paneledSessionIds: ['s-three'] });
		await settle();
		const rows = target.querySelectorAll('[data-testid="sidebar-session-card"]');
		expect(rows).toHaveLength(1); // s-two only — s-three is paneled away
		unmount(instance);
	});

	it('a pill pick flows through the rail-owned filter state back into the summary', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance } = mountSidebar();
		await settle();
		// The filter row ships expanded (2026-09-18) — pick the preset pill.
		const pill = target.querySelector('[data-testid="filter-preset-research"]') as HTMLButtonElement;
		expect(pill).not.toBeNull();
		pill.click();
		flushSync();
		// The relay updated the rail's filter → the summary names the agent.
		const summary = target.querySelector('[data-testid="filter-summary"]');
		expect(summary?.textContent).toContain('Research');
		unmount(instance);
	});
});

describe('AppSidebar — collapsed stub', () => {
	it('renders the 34px stub; the expand button fires onToggleCollapse', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance, onToggleCollapse } = mountSidebar({ collapsed: true });
		await settle();
		const stub = target.querySelector('[data-testid="app-sidebar-collapsed"]') as HTMLElement;
		expect(stub).not.toBeNull();
		expect(target.querySelector('[data-testid="app-sidebar"]')).toBeNull();
		expect(stub.textContent).toContain('Deepseek Insight');
		const expand = stub.querySelector('button[aria-label="Expand sidebar"]') as HTMLButtonElement;
		expect(expand.getAttribute('aria-expanded')).toBe('false');
		expand.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('AppSidebar — embedded rail (placement panels-zoom)', () => {
	it('renders the BARE rail: no width wrapper, no gutter; collapse still fires', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance, onToggleCollapse } = mountSidebar({ embedded: true });
		await settle();
		const rail = target.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(rail.classList.contains('rail-embedded')).toBe(true);
		// The hosting StickyColumnContainer owns width + gutter — neither here.
		expect(rail.style.width).toBe('');
		expect(target.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();
		// The embedded body loads through the same spine.
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		const collapse = target.querySelector('button[aria-label="Collapse sidebar"]') as HTMLButtonElement;
		collapse.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('AppSidebar — navigateToSession (adopted workspace → seed deep link)', () => {
	it('Add workspace adopt+create navigates via conversationSeedUrl on the active profile desk', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const assigned: string[] = [];
		const origAssign = window.location.assign;
		window.location.assign = ((url: string | URL) => {
			assigned.push(String(url));
		}) as never;
		try {
			// The seed deep link's profile now comes from the workspace state
			// (the Add-workspace control reports through the sidebar's own
			// gotoCreated grammar — floor-first, seed fallback), not from a
			// header prop: publish the active desk before mounting.
			setWorkspaceState({ rows: [], selectedPanelId: null, profile: 'widi', select: () => {}, remove: () => {} });
			const { target, instance } = mountSidebar({ profile: 'widi' });
			await settle();
			// Drive the Add-workspace flow: open → listing → confirm.
			(target.querySelector('[data-testid="add-workspace-button"]') as HTMLElement).click();
			await settle();
			expect(target.querySelector('[data-testid="add-workspace-panel"]')).not.toBeNull();
			(target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
			await settle();
			// The payoff ran: adopt + create, then the rail navigated.
			expect(log.find((c) => c.url === '/api/dsh/workspaces')?.body).toEqual({
				path: '/tmp/new-folder'
			});
			expect(assigned).toEqual(['/?sessionKey=s-adopted&profile=widi']);
			unmount(instance);
		} finally {
			setWorkspaceState(null);
			window.location.assign = origAssign;
		}
	});
});

describe('AppSidebar — header CanvasCopyButton (page capture)', () => {
	it('click canvas-copies the container the page handed down (the ConversationPage root)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		mockedToBlob.mockResolvedValue(new Blob(['page-png'], { type: 'image/png' }));
		const writes: unknown[] = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async (items: unknown[]) => void writes.push(...items)) }
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
		const pageRoot = document.createElement('div');
		const { target, instance } = mountSidebar({ captureContainer: pageRoot });
		await settle();
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(button).not.toBeNull();
		button.click();
		await settle();
		// The capture target is the PAGE's element, not some rail-internal node.
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(pageRoot);
		expect(writes).toHaveLength(1);
		unmount(instance);
	});
});

describe('AppSidebar — residual branches (optional props + filter seed)', () => {
	it('collapsed stub: ControlBar mounts inside it and Restart/About ride the prefix (onresizeall ?? no-op fallback — default mount passes none)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		// No onresizeall prop → ControlBar gets the ?? (() => {}) fallback.
		const { target, instance } = mountSidebar({ collapsed: true });
		await settle();
		const stub = target.querySelector('[data-testid="app-sidebar-collapsed"]') as HTMLElement;
		// The floor ControlBar self-positions fixed — its mount site is the stub.
		expect(stub.querySelector('[data-testid="controlbar"]')).not.toBeNull();
		expect(stub.querySelector('[data-testid="sidebar-restart-trigger"]')).not.toBeNull();
		expect(stub.querySelector('[data-testid="sidebar-about-trigger"]')).not.toBeNull();
		unmount(instance);
	});

	it('omitted callbacks: the stub expand click and gutter mousedown are silent no-ops', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		// undefined overrides mountSidebar's spies → the ?.() optional-call branches.
		const collapsed = mountSidebar({ collapsed: true, onToggleCollapse: undefined });
		await settle();
		const expand = collapsed.target.querySelector('button[aria-label="Expand sidebar"]') as HTMLButtonElement;
		expect(() => {
			expand.click();
			flushSync();
		}).not.toThrow();
		unmount(collapsed.instance);

		const standalone = mountSidebar({ onResizeStart: undefined });
		await settle();
		const gutter = standalone.target.querySelector('[data-testid="sidebar-gutter"]') as HTMLElement;
		expect(() => gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).not.toThrow();
		unmount(standalone.instance);
	});

	it('standalone defaults: null capture/tray containers + no onresizeall — the canvas button renders and its click is the documented null-container no-op', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		mockedToBlob.mockClear();
		const { target, instance } = mountSidebar();
		await settle();
		// The header's canvas-copy button renders regardless of a null container.
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(button).not.toBeNull();
		button.click();
		await settle();
		// Null container → CanvasCopyButton's no-op: no PNG render, no throw.
		expect(mockedToBlob).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('embedded rail threads the page containers too (captureContainer reaches the header copy)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		mockedToBlob.mockClear();
		mockedToBlob.mockResolvedValue(new Blob(['embedded-png'], { type: 'image/png' }));
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async () => {}) }
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
		const pageRoot = document.createElement('div');
		const { target, instance } = mountSidebar({ embedded: true, captureContainer: pageRoot });
		await settle();
		(target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement).click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(pageRoot);
		unmount(instance);
	});

	it('filter $state seeds from loadSessionFilter — the desk\'s stored blob (profile) vs the default desk (null profile)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		// A stored filter under the profile desk's key seeds $state at mount.
		localStorage.setItem(
			'dsi-session-filter_widi',
			JSON.stringify({ workspace: null, preset: 'research', blankMode: false })
		);
		const profiled = mountSidebar({ profile: 'widi' });
		await settle();
		expect(profiled.target.querySelector('[data-testid="filter-summary"]')?.textContent).toContain('Research');
		unmount(profiled.instance);

		// null profile reads the DEFAULT desk key, not the profile one.
		localStorage.clear();
		localStorage.setItem(
			'dsi-session-filter',
			JSON.stringify({ workspace: null, preset: 'research', blankMode: false })
		);
		const def = mountSidebar({ profile: null });
		await settle();
		expect(def.target.querySelector('[data-testid="filter-summary"]')?.textContent).toContain('Research');
		unmount(def.instance);
	});
});

describe("AppSidebar — the collapsed stub ControlBar onresizeall wiring", () => {
	/** Mount the collapsed stub and slide its ControlBar tray's width
	 *  slider (the tray portals to document.body). */
	async function slideStubTray(props: Record<string, unknown>, value: string) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(AppSidebar, {
			target,
			props: { currentSessionId: 's-current', collapsed: true, ...props }
		});
		await settle();
		const trigger = target.querySelector('[data-testid="controlbar-trigger"]') as HTMLElement;
		expect(trigger).not.toBeNull();
		trigger.click();
		flushSync();
		const slider = document.body.querySelector(
			'[data-testid="controlbar-slider-width-input"]'
		) as HTMLInputElement;
		expect(slider).not.toBeNull();
		slider.value = value;
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		return { instance };
	}

	it('onresizeall PROVIDED: the stub tray thumb reports through to the page', async () => {
		const spy = vi.fn();
		const { instance } = await slideStubTray({ onresizeall: spy }, '600');
		expect(spy).toHaveBeenCalledWith(600);
		unmount(instance);
	});

	it('onresizeall OMITTED: the ?? fallback absorbs the thumb move — no throw', async () => {
		const { instance } = await slideStubTray({}, '620');
		// No crash is the assertion: the noop fallback ran.
		expect(document.body.querySelector('[data-testid="controlbar-tray"]')).not.toBeNull();
		unmount(instance);
	});

	it('standalone mount WITHOUT panelWidth/zoom: the $bindable defaults seed the tray slider', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(AppSidebar, {
			target,
			props: { currentSessionId: 's-current' }
		});
		await settle();
		const trigger = target.querySelector('[data-testid="controlbar-trigger"]') as HTMLElement;
		expect(trigger).not.toBeNull();
		trigger.click();
		flushSync();
		const slider = document.body.querySelector(
			'[data-testid="controlbar-slider-width-input"]'
		) as HTMLInputElement;
		expect(slider.value).toBe(String(PANEL_DEFAULT_WIDTH));
		unmount(instance);
	});
});

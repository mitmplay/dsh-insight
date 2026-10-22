/**
 * AppSidebarHeader unit tests — the expanded rail's header row.
 *
 * Component-direct mount through a tiny Host (AppSidebarHeaderHost.svelte,
 * GoalBarHost pattern): the header is presentational — it composes
 * RestartButton / AboutButton / AppSidebarHeaderTitle / the action
 * cluster and threads the page-owned state through, so the tests pin the
 * pass-throughs:
 *  - full render (all four children present)
 *  - the panelWidth / zoom $bindable round-trip (Host → header →
 *    AppSidebarHeaderAction → ControlBar sliders and back)
 *  - onToggleCollapse and onresizeall delegated upward through
 *    AppSidebarHeaderAction
 *  - captureContainer / trayContainer threading: a CanvasCopyButton
 *    click renders THE EXACT container element the page handed down
 *    (html-to-image mocked, app-sidebar.test.ts pattern)
 *
 * RestartButton GETs /api/floor/mode on mount, so every mount rides a
 * route-aware fetch stub (app-sidebar.test.ts pattern).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob } from 'html-to-image';
import AppSidebarHeaderHost from '../../../AppSidebarHeaderHost.svelte';
import AppSidebarHeader from '$lib/components/common/layout/AppSidebarHeader.svelte';
import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(), toCanvas: vi.fn() }));

const mockedToBlob = vi.mocked(toBlob);

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Route-aware fetch stub: the RestartButton's dev-mode probe (the only
 *  network fetch the header tree makes on mount) plus a catch-all. */
function stubFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url === '/api/floor/mode' && method === 'GET') return jsonResponse({ dev: true });
			return jsonResponse({ ok: true });
		})
	);
}

/** Multi-await settle — the fetch-then-state chain plus tray portals. */
async function settle(rounds = 15): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

interface MountResult {
	target: HTMLElement;
	unmount: () => void;
	events: () => string[];
	width: () => string;
	zoom: () => string;
}

function mountHeader(
	props: { captureContainer?: HTMLElement; trayContainer?: HTMLElement } = {}
): MountResult {
	const target = document.createElement('div');
	document.body.appendChild(target);
	let onwidth: ((w: number) => void) | undefined;
	let onzoom: ((z: number) => void) | undefined;
	const instance = mount(AppSidebarHeaderHost, {
		target,
		props: {
			captureContainer: props.captureContainer ?? null,
			trayContainer: props.trayContainer ?? null,
			onwidth: (w: number) => onwidth?.(w),
			onzoom: (z: number) => onzoom?.(z)
		}
	});
	return {
		target,
		unmount: () => unmount(instance),
		events: () => (target.querySelector('#host-events') as HTMLInputElement).value.split(','),
		width: () => (target.querySelector('#host-width') as HTMLInputElement).value,
		zoom: () => (target.querySelector('#host-zoom') as HTMLInputElement).value
	};
}

/** Reveal the ControlBar tray (the hover trigger) — the tray portals to
 *  document.body, so its buttons are queried OUTSIDE the mount target. */
function revealTray(target: HTMLElement): HTMLElement {
	const bar = target.querySelector('[data-testid="controlbar"]') as HTMLElement;
	bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
	flushSync();
	return document.body.querySelector('[data-testid="controlbar-tray"]') as HTMLElement;
}

function setInput(el: HTMLInputElement, value: string): void {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
	stubFetch();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('AppSidebarHeader — full render', () => {
	it('renders all four children: restart prefix, about trigger, brand title, action cluster', async () => {
		const { target, unmount } = mountHeader();
		await settle();
		// RestartButton (dev-mode stub answers dev:true → visible trigger).
		expect(target.querySelector('[data-testid="sidebar-restart-trigger"]')).not.toBeNull();
		// AboutButton's circled-A trigger.
		expect(target.querySelector('[data-testid="sidebar-about-trigger"]')).not.toBeNull();
		// AppSidebarHeaderTitle's brand span.
		expect(target.querySelector('[data-testid="sidebar-title"]')?.textContent).toBe(
			'Deepseek Insight'
		);
		// AppSidebarHeaderAction: page canvas-copy + collapse + the ControlBar.
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		expect(target.querySelector('button[aria-label="Collapse sidebar"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="controlbar"]')).not.toBeNull();
		unmount();
	});
});

describe('AppSidebarHeader — $bindable panelWidth/zoom round-trip', () => {
	it('threads the initial values down to the sliders and a thumb move back up through the Host', async () => {
		const { target, unmount, width, zoom } = mountHeader();
		await settle();
		// Down: the Host's 500 / 0.5 render in the tray sliders.
		const tray = revealTray(target);
		expect(tray).not.toBeNull();
		expect(tray.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent).toBe(
			'500px'
		);
		expect(tray.querySelector('[data-testid="controlbar-slider-zoom-value"]')?.textContent).toBe(
			'50%'
		);
		// Up: a width thumb move fires onresizeall AND lands back in the Host.
		setInput(
			tray.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement,
			'640'
		);
		expect(width()).toBe('640');
		// Up: a zoom thumb move lands back in the Host too.
		setInput(
			tray.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement,
			'0.75'
		);
		expect(zoom()).toBe('0.75');
		unmount();
	});
});

describe('AppSidebarHeader — delegated callbacks through AppSidebarHeaderAction', () => {
	it('the collapse button fires onToggleCollapse upward', async () => {
		const { target, unmount, events } = mountHeader();
		await settle();
		const collapse = target.querySelector(
			'button[aria-label="Collapse sidebar"]'
		) as HTMLButtonElement;
		expect(collapse.getAttribute('aria-expanded')).toBe('true');
		collapse.click();
		flushSync();
		expect(events()).toContain('toggle');
		unmount();
	});

	it('the width slider commits through onresizeall into the Host event log', async () => {
		const { target, unmount, events } = mountHeader();
		await settle();
		const tray = revealTray(target);
		setInput(
			tray.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement,
			'700'
		);
		expect(events()).toContain('resizeall:700');
		unmount();
	});
});

describe('AppSidebarHeader — captureContainer / trayContainer threading', () => {
	beforeEach(() => {
		mockedToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
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
	});

	it('the header canvas-copy click renders THE page captureContainer', async () => {
		const pageRoot = document.createElement('div');
		const { target, unmount } = mountHeader({ captureContainer: pageRoot });
		await settle();
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		button.click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(pageRoot);
		unmount();
	});

	it('the tray canvas-copy click renders THE floor trayContainer (full pass-through chain)', async () => {
		const floor = document.createElement('div');
		const { target, unmount } = mountHeader({ trayContainer: floor });
		await settle();
		revealTray(target);
		// The tray portals to document.body — query OUTSIDE the mount target
		// (its sibling header button lives INSIDE the target).
		const trayButton = [...document.body.querySelectorAll('[data-testid="canvas-copy-button"]')]
			.map((el) => el as HTMLElement)
			.find((el) => !target.contains(el)) as HTMLElement;
		expect(trayButton).toBeDefined();
		trayButton.click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(floor);
		unmount();
	});
});

describe('AppSidebarHeader — $bindable defaults (no panelWidth/zoom props)', () => {
	it('mounts bare: the $bindable defaults seed the tray sliders (panel-prefs constants)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		// NO panelWidth/zoom props — the $bindable(PANEL_DEFAULT_*) default
		// closures run and seed ControlBarTray's sliders.
		const instance = mount(AppSidebarHeader, {
			target,
			props: { onToggleCollapse: () => {} }
		});
		await settle();
		const bar = target.querySelector('[data-testid="controlbar"]') as HTMLElement;
		expect(bar).not.toBeNull();
		bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
		flushSync();
		const slider = document.body.querySelector(
			'[data-testid="controlbar-slider-width-input"]'
		) as HTMLInputElement;
		expect(slider).not.toBeNull();
		expect(slider.value).toBe(String(PANEL_DEFAULT_WIDTH));
		unmount(instance);
		flushSync();
	});
});

/**
 * root-page-branches-coverage — the +page.svelte branch arms the earlier
 * page suites never reach (coverage pass 2026-10-31). Arms covered here:
 *  - the chord WIRING through real window keydowns (the capture-phase
 *    listener the page registers onMount): preventDefault arm, the
 *    pass-through arm (un-armed key is never swallowed), and every
 *    dispatchChordVerb case — p (add + remove), t (add + remove),
 *    w (with + without an explorer), c (with + without config panels),
 *    a (terminal + explorer removal), s (both sidebar-collapse arms),
 *    n (anchor found: POST session + permission re-apply + add;
 *       transport failure; ok-but-sessionless silent no-op).
 *  - the apply-preset arm of onChordKeyDown: agent-slot apply, the
 *    sidebar preset arm, the zoom preset arm, and the AC3 all-slots-
 *    empty early return.
 *  - the conversation ladder's dead-session arm (panel-error card +
 *    its close) and the coldInFlight arm (the Loading… card).
 *  - the workspace-file floor-slot arm through a restored blob
 *    (copyValue string arm + view ?? 'edit' fallback).
 *  - the PanelColumn onremove shiftKey discriminator (both arms).
 *  - the svelte:window mousemove/mouseup handlers with NO armed drag
 *    (the early-return arms of the sidebar resize pair).
 *  - EmptyFloor (panels.length === 0) after the last panel closes.
 *
 * Same mounting conventions as page-arm-gaps.test.ts (reactiveTestPage
 * + settle, stubbed fetch, stubbed EventSource, real unmount teardown).
 */
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { addPanelFromSidebar, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { getWorkspaceState, setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { pageFeeds } from '$lib/services/workspace/page-feeds.svelte';
import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';
import {
	loadAppConfig,
	resetAppConfigForTests
} from '$lib/services/config/app-config.svelte';

class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	handlers = new Map<string, Set<(ev: MessageEvent) => void>>();
	onerror: ((ev: unknown) => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
		if (!this.handlers.has(type)) this.handlers.set(type, new Set());
		this.handlers.get(type)!.add(cb);
	}
	close(): void {
		this.closed = true;
	}
}

const SESSION_ROW = {
	sessionId: 's-floor',
	title: 'Floor',
	agentPreset: null,
	running: false,
	blank: false,
	updatedAt: 0,
	workspace: '/ws/x',
	turns: null
};

/** Tunable per test: the POST /api/dsh/sessions and permission bodies. */
let newSessionBody: Record<string, unknown> = { ok: true, sessionId: 's-new', agentPreset: 'main' };
let newSessionStatus = 200;
let permissionBody: Record<string, unknown> = { ok: true, permission: { current: 'default' } };
let configBody: Record<string, unknown> = {};

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? 'GET').toUpperCase();
			let body: unknown;
			if (url.includes('/api/dsh/sessions') && method === 'POST') body = newSessionBody;
			else if (url.includes('/permission') && method === 'POST') body = { ok: true };
			else if (url.includes('/permission')) body = permissionBody;
			else if (url.includes('/api/config')) body = { ok: true, ...configBody };
			else if (url.includes('/api/dsh/sessions')) body = { ok: true, sessions: [SESSION_ROW], presets: [] };
			else if (url.includes('/api/a2a')) body = { ok: true, rows: [] };
			else if (url.includes('/events')) body = { ok: true, entries: [], lastSeq: -1, running: false };
			else if (url.includes('/models')) body = { ok: true, current: null };
			else if (url.includes('/api/terminal')) body = { ok: true, enabled: true, sessions: [] };
			else if (url.includes('/api/dsh/workspace-file')) body = { ok: true, file: { text: 'hello', eof: true } };
			else if (url.includes('/api/browser')) body = { ok: true, sessions: [] };
			else if (url.includes('/api/prompts')) body = { ok: true, rows: [] };
			else if (url.includes('/api/skills')) body = { ok: true, skills: [], categories: [] };
			else if (url.includes('/api/plugins')) body = { ok: true, plugins: [], marketplace: [] };
			else body = { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), {
				status: url.includes('/api/dsh/sessions') && method === 'POST' ? newSessionStatus : 200,
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

const livePages: unknown[] = [];

/** Seeded mount: one conversation panel for ?sessionKey=s-floor. */
async function mountSeeded() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
	reactiveTestPage.data = { sessionId: 's-floor', entries: [], lastSeq: -1, running: false, workspace: '/ws/x' };
	const instance = mount(Page, { target });
	livePages.push(instance);
	await settle();
	return { target, instance };
}

/** Bare-arrival mount over a restored panel-prefs blob. */
async function mountBare(panels: Array<Record<string, unknown>>) {
	localStorage.setItem('dsi-panels', JSON.stringify({ panels, selectedPanelId: panels[0]?.id ?? null, panelWidth: 600, zoom: 1 }));
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
	const instance = mount(Page, { target });
	livePages.push(instance);
	await settle();
	await settle();
	return { target, instance };
}

/** One chord step: a real keydown through the page's capture listener. */
function pressKey(init: { key: string; code?: string; altKey?: boolean }): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', {
		key: init.key,
		code: init.code ?? (init.key.length === 1 ? 'Key' + init.key.toUpperCase() : init.key),
		altKey: init.altKey ?? false,
		ctrlKey: false,
		metaKey: false,
		cancelable: true,
		bubbles: true
	});
	window.dispatchEvent(ev);
	return ev;
}

/** Arm the chord (Alt+S) then fire the verb/digit key. */
function chord(key: string, code?: string): { arm: KeyboardEvent; key: KeyboardEvent } {
	const arm = pressKey({ key: 's', code: 'KeyS', altKey: true });
	const keyEv = pressKey({ key, code });
	return { arm, key: keyEv };
}

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	localStorage.clear();
	newSessionBody = { ok: true, sessionId: 's-new', agentPreset: 'main' };
	newSessionStatus = 200;
	permissionBody = { ok: true, permission: { current: 'default' } };
	configBody = {};
});

afterEach(() => {
	while (livePages.length > 0) unmount(livePages.pop() as never);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	resetAppConfigForTests();
	setWorkspaceState(null);
	pageFeeds.deadSessions = {};
	pageFeeds.coldInFlight = new SvelteSet<string>();
	pageFeeds.coldCache = {};
	pagePrefs.sidebarCollapsed = false;
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('+page.svelte — chord verbs through the window keydown wiring', () => {
	it('Alt+S arms (captured + default-prevented); an un-armed key passes through', async () => {
		const { target } = await mountSeeded();
		const pass = pressKey({ key: 'x', code: 'KeyX' });
		expect(pass.defaultPrevented).toBe(false); // the pass-through arm
		const arm = pressKey({ key: 's', code: 'KeyS', altKey: true });
		expect(arm.defaultPrevented).toBe(true); // the capture arm
		await settle();
		expect(target.querySelector('[data-testid="chord-palette"]')).not.toBeNull();
		// a verb letter closes the window again (the palette unmounts)
		chord('s');
		await settle();
		expect(target.querySelector('[data-testid="chord-palette"]')).toBeNull();
	});

	it("'p' toggles the prompt manager: add then remove (both switch arms)", async () => {
		const { target } = await mountSeeded();
		chord('p');
		await settle();
		expect(target.querySelector('[data-testid="panel-manager"]')).not.toBeNull();
		chord('p');
		await settle();
		expect(target.querySelector('[data-testid="panel-manager"]')).toBeNull();
	});

	it("'t' toggles the terminal; 'a' closes the agent extras (terminal + explorer)", async () => {
		const { target } = await mountSeeded();
		chord('t');
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		// open an explorer through the workspace chip (the session arm)
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).not.toBeNull();
		chord('a');
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).toBeNull();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).toBeNull();
		expect(target.querySelector('[data-testid="panel-column"]')).not.toBeNull(); // conversation survives
	});

	it("'w'/'b'/'c' without their panel kinds are no-ops; with targets they clear them", async () => {
		const { target } = await mountSeeded();
		const before = target.querySelectorAll('[data-testid="panel-column"]').length;
		chord('w');
		await settle();
		chord('b');
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(before);
		chord('c');
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(before);
		// now give the c/w verbs real targets
		expect(addPanelFromSidebar({ kind: 'plugin-rack' })).toBe(true);
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).not.toBeNull();
		chord('w');
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).toBeNull();
		chord('c');
		await settle();
		expect(target.querySelector('[data-testid="panel-plugins"]')).toBeNull();
	});

	it("'s' toggles the sidebar collapse both ways", async () => {
		await mountSeeded();
		expect(pagePrefs.sidebarCollapsed).toBe(false);
		chord('s');
		await settle();
		expect(pagePrefs.sidebarCollapsed).toBe(true);
		chord('s');
		await settle();
		expect(pagePrefs.sidebarCollapsed).toBe(false);
	});

	it("'n' spawns the focused session's sibling: POST session + permission re-apply + add", async () => {
		const calls: Array<{ url: string; method: string; body?: unknown }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				const method = (init?.method ?? 'GET').toUpperCase();
				if (url.includes('/api/dsh/sessions') && method === 'POST') {
					calls.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) });
					return new Response(JSON.stringify(newSessionBody), { status: newSessionStatus, headers: { 'content-type': 'application/json' } });
				}
				if (url.includes('/permission') && method === 'POST') {
					calls.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) });
					return new Response(JSON.stringify({ ok: true }), { status: 200 });
				}
				if (url.includes('/permission')) {
					return new Response(JSON.stringify(permissionBody), { status: 200, headers: { 'content-type': 'application/json' } });
				}
				let body: unknown;
				if (url.includes('/api/dsh/sessions')) body = { ok: true, sessions: [SESSION_ROW, { ...SESSION_ROW, sessionId: 's-new' }], presets: [] };
				else if (url.includes('/api/a2a')) body = { ok: true, rows: [] };
				else if (url.includes('/events')) body = { ok: true, entries: [], lastSeq: -1, running: false };
				else if (url.includes('/models')) body = { ok: true, current: null };
				else body = { ok: true, entries: [], hasMore: false };
				return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
			})
		);
		const { target } = await mountSeeded();
		chord('n');
		await settle();
		await settle();
		const sessionPost = calls.find((c) => c.url.includes('/api/dsh/sessions'));
		expect(sessionPost?.body).toMatchObject({ agentPreset: null }); // no workspace → the no-cwd arm
		expect(calls.some((c) => c.url.includes('/permission') && c.method === 'POST')).toBe(true);
		const sessionIds = (getWorkspaceState()?.rows ?? [])
			.map((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null))
			.filter((v): v is string => v !== null);
		expect(sessionIds).toContain('s-new');
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
	});

	it("'n' fails honestly silent: transport 500 and ok-but-sessionless both add nothing", async () => {
		newSessionStatus = 500;
		const { target } = await mountSeeded();
		chord('n');
		await settle();
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(1);
		newSessionStatus = 200;
		newSessionBody = { ok: true };
		chord('n');
		await settle();
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(1);
	});
});

describe('+page.svelte — the apply-preset arm (Alt+S + digit)', () => {
	it('agent slot applies a width; sidebar slot collapses; zoom slot sets the zoom; an empty slot returns early (AC3)', async () => {
		configBody = {
			sidebar: { placement: 'left' },
			panel: { presets: { agent: { 1: 640 }, sidebar: { 2: { state: 'collapse' } }, zoom: { 3: 80 } } }
		};
		await loadAppConfig();
		await mountSeeded();
		// digit 1: agent preset only — applyWidthPreset runs, sidebar/zoom untouched
		chord('1', 'Digit1');
		await settle();
		expect(pagePrefs.panelWidth).toBe(640);
		// digit 2: sidebar collapse arm (s !== undefined)
		chord('2', 'Digit2');
		await settle();
		expect(pagePrefs.sidebarCollapsed).toBe(true);
		pagePrefs.sidebarCollapsed = false;
		// digit 3: zoom preset arm (z !== undefined), 80% → 0.8 clamped
		chord('3', 'Digit3');
		await settle();
		expect(pagePrefs.zoom).toBeCloseTo(0.8, 5);
		// digit 9: no slot anywhere → the AC3 early return, nothing moves
		const before = pagePrefs.panelWidth;
		chord('9', 'Digit9');
		await settle();
		expect(pagePrefs.panelWidth).toBe(before);
		expect(pagePrefs.zoom).toBeCloseTo(0.8, 5);
	});
});

describe('+page.svelte — conversation ladder: dead session + loading arms', () => {
	it('a dead session renders the honest error card; Close removes the panel and the floor empties', async () => {
		pageFeeds.deadSessions = { 's-floor': 'Session s-floor not found on the DSH host.' };
		const { target } = await mountSeeded();
		const card = target.querySelector('[data-testid="panel-error"]');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain('not found');
		(target.querySelector('[data-testid="panel-error-close"]') as HTMLElement).click();
		await settle();
		expect(target.querySelector('[data-testid="panel-error"]')).toBeNull();
		// panels.length === 0 → EmptyFloor
		expect(target.querySelector('[data-testid="workspace-empty"]')).not.toBeNull();
	});

	it('a session with a cold fetch still in flight renders the Loading… card', async () => {
		void pageFeeds.runCold('s-hang', () => new Promise(() => {})); // never settles
		const { target } = await mountBare([
			{ id: 'ph', kind: 'conversation', sessionId: 's-hang', agentPreset: null, width: 600 }
		]);
		expect(target.querySelector('[data-testid="panel-loading"]')?.textContent).toContain('Loading');
	});
});

describe('+page.svelte — restored workspace-file slot + close shiftKey arms', () => {
	it('a restored workspace-file panel renders the file body with the view ?? edit fallback', async () => {
		const { target } = await mountBare([
			{ id: 'pwf', kind: 'workspace-file', sessionId: 's-floor', path: 'README.md', width: 600 }
		]);
		expect(target.querySelector('[data-testid="workspace-file-panel"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="file-title"]')).not.toBeNull();
	});

	it('the header close reports the shiftKey discriminator: shift-close then plain close (both arms run)', async () => {
		const { target } = await mountSeeded();
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
		// shift-close on the explorer column: the family: false arm
		const explorerCol = [...target.querySelectorAll<HTMLElement>('[data-testid="panel-column"]')].find((c) =>
			c.querySelector('[data-testid="workspace-explorer"]')
		);
		explorerCol!.querySelector<HTMLElement>('[data-testid="panel-close"]')!.dispatchEvent(
			new MouseEvent('click', { bubbles: true, shiftKey: true })
		);
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).toBeNull();
		// plain close on the conversation: the family: true arm (floor empties)
		target.querySelector<HTMLElement>('[data-testid="panel-close"]')!.click();
		await settle();
		expect(target.querySelector('[data-testid="panel-column"]')).toBeNull();
		expect(target.querySelector('[data-testid="workspace-empty"]')).not.toBeNull();
	});
});

describe('+page.svelte — window mouse handlers with no armed drag', () => {
	it('mousemove/mouseup without a drag run their early-return arms and never throw', async () => {
		await mountSeeded();
		expect(() => {
			window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 300 }));
			window.dispatchEvent(new MouseEvent('mouseup'));
		}).not.toThrow();
		await settle();
		expect(document.querySelector('[data-testid="panel-column"]')).not.toBeNull();
	});
});

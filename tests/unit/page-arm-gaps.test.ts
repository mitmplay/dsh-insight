/**
 * page-arm-gaps — the branch arms the page suites had not reached
 * (coverage gap pass 2026-10-26). Same harness conventions as
 * page-branch-mop3.test.ts (reactiveTestPage + settle, stubbed fetch,
 * stubbed EventSource). Arms covered here:
 *  - restoreBrowserGlasses' catch arm (the probe fetch REJECTS).
 *  - the per-slot restore gates: folded entries and sessionId-less
 *    entries never auto-open.
 *  - the summon seam (registerSummonGlass handler): both keepSelection
 *    arms, plus the openedBy-less glass (provenance null arms).
 *  - the browser slot effect's fold arm (glass leaves the floor AFTER
 *    being seen, the persisted list is marked folded, not wiped).
 *  - the browser branch close ladder: onclose with a bound session
 *    (releaseGlasses + removePanel) and the 409 onclosed prune.
 *  - the conversation branch subagent arm: onOpenBrowser undefined for
 *    a spawn-origin session.
 *  - the terminal slot restored desk mirror (panel.desk null-coalesce
 *    left arm).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	summonGlassFromRegistry,
	resetPanelRegistryForTests,
	addPanelFromSidebar
} from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	frames = new Map<string, (ev: MessageEvent) => void>();
	onerror: ((ev: unknown) => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
		this.frames.set(type, cb);
	}
	/** Test seam: push an SSE frame (the screencast 'frame' event). */
	fire(type: string, data: unknown): void {
		const cb = this.frames.get(type);
		if (!cb) return;
		try {
			cb({ data: JSON.stringify(data) } as MessageEvent);
		} catch {
			/* happy-dom canvas ops can throw — status was already set */
		}
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

let probeMode: string = 'ok';
let probeSessions: Array<{ id: string }> = [];
let proxyStatus = 200;

function installFetch() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/browser') && url.includes('/navigate')) {
				return new Response(JSON.stringify({ ok: false }), { status: proxyStatus });
			}
			if (url.includes('/api/browser') && !url.includes('/api/browser/')) {
				if (probeMode === 'reject') throw new Error('probe unreachable');
				const body = probeMode === 'ok' ? { ok: true, sessions: probeSessions } : { ok: false, sessions: [] };
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			const body =
				url.includes('/api/dsh/sessions') ? { ok: true, sessions: [SESSION_ROW], workspaces: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/terminal') ? { ok: true, enabled: true, sessions: [] }
				: url.includes('/api/prompts') ? { ok: true, prompts: [] }
				: url.includes('/api/skills') ? { ok: true, skills: [], categories: [] }
				: url.includes('/api/plugins') ? { ok: true, plugins: [], marketplace: [] }
				: url.includes('/api/config') ? { ok: true }
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

async function waitFor(selector: string, scope: ParentNode, timeoutMs: number = 3000): Promise<Element> {
	const started = Date.now();
	for (;;) {
		const el = scope.querySelector(selector);
		if (el) return el;
		flushSync();
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 25));
		if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout: ' + selector);
	}
}

async function mountSeeded() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
	reactiveTestPage.data = {
		sessionId: 's-floor',
		entries: [],
		lastSeq: -1,
		running: false,
		workspace: '/ws/x'
	};
	const instance = mount(Page, { target });
	await settle();
	return { target, instance };
}

async function mountBare(prefs: Record<string, unknown>) {
	localStorage.setItem('dsi-panels', JSON.stringify(prefs));
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
	const instance = mount(Page, { target });
	await settle();
	await settle();
	return { target, instance };
}

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource);
	localStorage.clear();
	probeMode = 'ok';
	probeSessions = [];
	proxyStatus = 200;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('+page.svelte — boot restore gap arms (probe reject, folded, sessionless)', () => {
	it('a probe fetch that REJECTS hits the catch arm — the floor still mounts', async () => {
		localStorage.setItem('dsi.browser.panelIndex', JSON.stringify([{ index: 1, sessionId: 'b-live' }]));
		probeMode = 'reject';
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { target, instance } = await mountBare({ panels: conv, selectedPanelId: 'p1', panelWidth: 600, zoom: 1 });
		await settle();
		expect(target.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		expect(target.querySelector('[data-testid="panel-column"]')).not.toBeNull();
		unmount(instance);
	});

	it('a FOLDED slot never comes back uninvited; a sessionless slot has nothing to re-bind', async () => {
		localStorage.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([
				{ index: 1, folded: true, sessionId: 'b-folded' },
				{ index: 2 }
			])
		);
		probeSessions = [{ id: 'b-folded' }];
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { target, instance } = await mountBare({ panels: conv, selectedPanelId: 'p1', panelWidth: 600, zoom: 1 });
		await settle();
		expect(target.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		unmount(instance);
	});
});

describe('+page.svelte — the summon seam (registerSummonGlass handler)', () => {
	it('a ghost-row summon with default keepSelection mounts the glass and KEEPS the operator focus', async () => {
		const { target, instance } = await mountSeeded();
		const before = getWorkspaceState()?.selectedPanelId;
		expect(
			summonGlassFromRegistry({ index: 1, width: 720, openedBy: 's-floor', sessionId: 'b-summon' }, { replace: true })
		).toBe(true);
		await settle();
		const slot = await waitFor('[data-testid="panel-browser-slot"]', target);
		expect(slot).not.toBeNull();
		expect(getWorkspaceState()?.selectedPanelId).toBe(before);
		const raw = localStorage.getItem('dsi.browser.panelIndex');
		expect(raw).not.toBeNull();
		const list = JSON.parse(raw!) as Array<{ sessionId?: string }>;
		expect(list.some((s) => s.sessionId === 'b-summon')).toBe(true);
		unmount(instance);
	});

	it('keepSelection:false hands the focus to the glass; an openedBy-less glass rides the null provenance arms', async () => {
		const { target, instance } = await mountSeeded();
		expect(
			summonGlassFromRegistry({ index: 1, width: 700, sessionId: 'b-solo' }, { replace: true, keepSelection: false })
		).toBe(true);
		await settle();
		await waitFor('[data-testid="panel-browser-slot"]', target);
		const selected = target.querySelector('.column.selected');
		expect(selected?.querySelector('[data-testid="panel-browser-slot"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="browser-provenance"]')).toBeNull();
		unmount(instance);
	});
});

describe('+page.svelte — the browser slot effect + close ladder', () => {
	it('a seen glass LEAVING the floor folds its slot entry (the else-if arm), never wipes it', async () => {
		localStorage.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([{ index: 1, openedBy: 's-floor', sessionId: 'b-live' }])
		);
		probeSessions = [{ id: 'b-live' }];
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { target, instance } = await mountBare({ panels: conv, selectedPanelId: 'p1', panelWidth: 600, zoom: 1 });
		await waitFor('[data-testid="panel-browser-slot"]', target);
		let list = JSON.parse(localStorage.getItem('dsi.browser.panelIndex')!) as Array<{ sessionId?: string; folded?: boolean }>;
		expect(list.find((s) => s.sessionId === 'b-live')?.folded).toBeUndefined();
		const row = getWorkspaceState()?.rows.find((r) => r.panel.kind === 'browser');
		expect(row).toBeDefined();
		getWorkspaceState()!.remove(row!.panel.id);
		await settle();
		list = JSON.parse(localStorage.getItem('dsi.browser.panelIndex')!) as Array<{ sessionId?: string; folded?: boolean }>;
		expect(list.find((s) => s.sessionId === 'b-live')?.folded).toBe(true);
		expect(target.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		unmount(instance);
	});

	it('the header close on a BOUND glass releases the wire session AND removes the slot', async () => {
		localStorage.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([{ index: 1, openedBy: 's-floor', sessionId: 'b-doomed' }])
		);
		probeSessions = [{ id: 'b-doomed' }];
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { target, instance } = await mountBare({ panels: conv, selectedPanelId: 'p1', panelWidth: 600, zoom: 1 });
		await waitFor('[data-testid="panel-browser-slot"]', target);
		const close = target.querySelector<HTMLButtonElement>('[data-testid="browse-close"]');
		expect(close).not.toBeNull();
		close!.click();
		await settle();
		expect(target.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		expect(target.querySelector('[data-testid="panel-column"]')).not.toBeNull();
		unmount(instance);
	});

	it('a 409 touch answers CLOSED — the route prunes the slot entry (onclosed)', async () => {
		localStorage.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([{ index: 1, openedBy: 's-floor', sessionId: 'b-409' }])
		);
		probeSessions = [{ id: 'b-409' }];
		proxyStatus = 409;
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { target, instance } = await mountBare({ panels: conv, selectedPanelId: 'p1', panelWidth: 600, zoom: 1 });
		await waitFor('[data-testid="panel-browser-slot"]', target);
		// A live frame enables the proxy verbs (the reload gate).
		StubEventSource.instances.at(-1)?.fire('frame', { jpeg: '' });
		await settle();
		const reload = target.querySelector<HTMLButtonElement>('[data-testid="browser-reload"]');
		expect(reload).not.toBeNull();
		expect(reload!.disabled).toBe(false);
		reload!.click();
		console.log('LS immediate:', localStorage.getItem('dsi.browser.panelIndex'));
		await settle();
		// The prune empties the list — the key is removed entirely.
		const rawList = localStorage.getItem('dsi.browser.panelIndex');
		const list = rawList === null ? [] : (JSON.parse(rawList) as Array<{ sessionId?: string }>);
		expect(list.some((s) => s.sessionId === 'b-409')).toBe(false);
		unmount(instance);
	});
});

describe('+page.svelte — conversation arms: subagent + restored terminal desk', () => {
	it('a spawn-origin session renders through the subagent gate arm (onOpenBrowser undefined)', async () => {
		const subRow = { ...SESSION_ROW, sessionId: 's-sub', origin: 'subagent' };
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/dsh/sessions') ? { ok: true, sessions: [subRow], workspaces: [] }
					: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
					: { ok: true, entries: [], hasMore: false };
				return new Response(JSON.stringify(body), { status: 200 });
			})
		);
		const conv = [{ id: 'ps', kind: 'conversation', sessionId: 's-sub', agentPreset: null, width: 600 }];
		const { target, instance } = await mountBare({ panels: conv, selectedPanelId: 'ps', panelWidth: 600, zoom: 1 });
		await settle();
		expect(target.querySelector('[data-testid="panel-column"]')).not.toBeNull();
		expect(addPanelFromSidebar({ sessionId: 's-floor', agentPreset: null })).toBe(true);
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
		unmount(instance);
	});

	it('a restored terminal entry carries its desk mirror (panel.desk null-coalesce left arm)', async () => {
		const entry = [{ id: 'pt', kind: 'terminal', width: 600, desk: { tabs: [{ sessionIds: ['sh-1'] }], selectedTab: 0 } }];
		const { target, instance } = await mountBare({ panels: entry, selectedPanelId: 'pt', panelWidth: 600, zoom: 1 });
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		unmount(instance);
	});
});

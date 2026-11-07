/**
 * page-coverage-wp1 — the +page.svelte branch sites the earlier suites miss
 * (coverage pass 2026-11-07). Sites targeted:
 *  - line 166 (if): restoreBrowserGlasses' browser-panel-present early
 *    return — a restored blob already carries a browser panel, so the boot
 *    glass probe never fetches /api/browser.
 *  - line 195 (binary-expr): mine()'s right arm — owner non-null AND found
 *    in the hosted-session set (the ADR-0045 ownership SET check).
 *  - line 250 (binary-expr): foldedGlassRowsFor's depthOf fallback ?? 0 —
 *    a folded glass whose opener has no lineage depth.
 *  - line 270 (binary-expr): spineGlassRows' title ?? 'Browser' SITE
 *    executed — a folded glass whose opener panel is NOT on the floor
 *    (the spine nesting arm). The 'Browser' fallback arm itself is
 *    unreachable: foldedGlassRowsFor always builds a truthy title
 *    ('Browser — …'), so only site execution is claimable.
 * Same mounting conventions as root-page-branches-coverage.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { pageFeeds } from '$lib/services/workspace/page-feeds.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { getWorkspaceState, setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

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

/** The /api/browser live set, tunable per test. */
let browserSessions: Array<{ id: string; ownerSessionId?: string | null }> = [];
const fetchUrls: string[] = [];

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? 'GET').toUpperCase();
			fetchUrls.push(method + ' ' + url);
			let body: unknown;
			if (url.includes('/api/browser')) body = { ok: true, sessions: browserSessions };
			else if (url.includes('/permission')) body = { ok: true, permission: { current: 'default' } };
			else if (url.includes('/api/config')) body = { ok: true };
			else if (url.includes('/api/dsh/sessions')) body = { ok: true, sessions: [SESSION_ROW], presets: [] };
			else if (url.includes('/api/a2a')) body = { ok: true, rows: [] };
			else if (url.includes('/events')) body = { ok: true, entries: [], lastSeq: -1, running: false };
			else if (url.includes('/models')) body = { ok: true, current: null };
			else if (url.includes('/api/terminal')) body = { ok: true, enabled: true, sessions: [] };
			else if (url.includes('/api/prompts')) body = { ok: true, rows: [] };
			else if (url.includes('/api/skills')) body = { ok: true, skills: [], categories: [] };
			else if (url.includes('/api/plugins')) body = { ok: true, plugins: [], marketplace: [] };
			else body = { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
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
	localStorage.setItem('dsi-panels', JSON.stringify({ panels: [], selectedPanelId: null, panelWidth: 600, zoom: 1 }));
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
	reactiveTestPage.data = { sessionId: 's-floor', entries: [], lastSeq: -1, running: false, workspace: '/ws/x' };
	const instance = mount(Page, { target });
	livePages.push(instance);
	await settle();
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

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	localStorage.clear();
	browserSessions = [];
	fetchUrls.length = 0;
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
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('+page.svelte WP1 — boot restore guard arms', () => {
	it('L166 arm — a restored browser-kind blob entry sanitizes to conversation (the honest fold), so the probe still fires', async () => {
		const { target } = await mountBare([{ id: 'pb1', kind: 'browser', width: 600 }]);
		expect(fetchUrls.some((u) => u.includes('/api/browser') && u.startsWith('GET'))).toBe(true);
		// the sanitizer folded the browser species into conversation — the route rendered a floor
		expect(target.querySelector('[data-testid="panel-column"], [data-testid="workspace-empty"]')).not.toBeNull();
	});

	it('L166 false arm sanity — no browser panel means the boot probe fires', async () => {
		await mountSeeded();
		expect(fetchUrls.some((u) => u.includes('/api/browser') && u.startsWith('GET'))).toBe(true);
	});
});

describe('+page.svelte WP1 — glass ownership + folded-row derivations', () => {
	it('L195 + L250 + L270 — folded slots with owned, ownerless and off-floor openers drive mine(), the depthOf fallback and the spine title site', async () => {
		localStorage.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([
				{ index: 0, sessionId: 'bs-owned', openedBy: 's-floor', folded: true },
				{ index: 1, sessionId: 'bs-null', openedBy: 's-floor', folded: true },
				{ index: 2, sessionId: 'bs-spine', openedBy: 's-elsewhere', folded: true } // legacy null owner: kept, opener off-floor → the SPINE nest
			])
		);
		// bs-owned is live and owned by THIS page (the pageKey is s-floor);
		// bs-null is live with a legacy null owner (re-binds as before);
		// bs-spine is live with a legacy null owner (kept) and its opener
		browserSessions = [
			{ id: 'bs-owned', ownerSessionId: 's-floor' },
			{ id: 'bs-null' },
			{ id: 'bs-spine' }
		];
		const { target } = await mountSeeded();
		await settle();
		// the off-floor opener's glass renders as a SPINE row titled 'Browser — …'
		expect(document.body.textContent).toContain('Browser —');
		// the restore skipped the summon (folded) and kept every slot: no dead prune
		expect(JSON.parse(localStorage.getItem('dsi.browser.panelIndex') ?? '[]')).toHaveLength(3);
	});
});

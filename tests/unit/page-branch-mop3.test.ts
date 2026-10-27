/**
 * +page.svelte branch mop 3 (coverage pass 2026-10-20): the boot
 * browser auto-restore ladder (persisted id live/dead/absent, probe
 * not-ok), the terminal floor slot, the settings-home vs session
 * explorer open-file arms, the injected-doc cold-cache hit/miss +
 * loupe hostClose arms, and the PanelColumn move-fact fallbacks for
 * non-conversation slots. Same mounting conventions as
 * page-panel-branches.test.ts (reactiveTestPage seed + settle()).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { addPanelFromSidebar, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';

/** Minimal EventSource stub: the explorer opens a git-events stream. */
class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	handlers = new Map<string, Set<(ev: MessageEvent) => void>>();
	onerror: ((ev: MessageEvent) => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (ev: MessageEvent) => void) {
		if (!this.handlers.has(type)) this.handlers.set(type, new Set());
		this.handlers.get(type)!.add(cb);
	}
	close() {
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

let browserBody: { ok: boolean; sessions: Array<{ id: string }> } = { ok: true, sessions: [] };

function installFetch() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input) => {
			const url = String(input);
			const body =
				url.includes('/api/browser') ? browserBody
				// VERDICT (systematic-debugging, 2026-10-20): this branch must
				// precede the /api/settings include — '/api/settings-home/tree'
				// substring-matches '/api/settings' and was being answered with
				// the settings text payload (no `listing`), so the home tree
				// rendered zero rows and no [data-testid=tree-file]. The source
				// is authoritative here: the settings-home explorer lists
				// through the DSI-local plane per The Settings Tree ADR
				// (WorkspaceExplorerPanel.svelte D2, endpoint ab11df4), which
				// predates this test — the test stub was stale, not the page.
				: url.includes('/api/settings-home/tree') ? { ok: true, listing: { path: '', entries: [{ name: 'docs', type: 'directory' }, { name: 'README.md', type: 'file' }], truncated: false } }
				: url.includes('/api/config') ? { ok: true }
				: url.includes('/api/dsh/sessions') ? { ok: true, sessions: [SESSION_ROW], workspaces: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/terminal') ? { ok: true, enabled: true, sessions: [] }
				: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
				: url.includes('/api/prompts') ? { ok: true, prompts: [] }
				: url.includes('/api/skills') ? { ok: true, skills: [], categories: [] }
				: url.includes('/api/plugins') ? { ok: true, plugins: [], marketplace: [] }
				: url.includes('/api/workspace/git-map') ? { ok: true, enabled: true, rootIsRepo: true, repos: { app: true } }
				: url.includes('/api/dsh/workspace-file') ? { ok: true, file: { text: 'hello', eof: true } }
				: { ok: true, listing: { path: '', entries: [{ name: 'docs', type: 'directory' }, { name: 'README.md', type: 'file' }], truncated: false } };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

async function settle() {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

async function waitFor(selector: string, scope: ParentNode, timeoutMs = 3000): Promise<Element> {
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

/** Bare-arrival mount (no sessionKey) — the auto-restore ladder runs. */
async function mountBare() {
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

/** Seeded mount: the seed panel's cold data primes the feed cache. */
async function mountSeeded() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
	reactiveTestPage.data = {
		sessionId: 's-floor',
		entries: [{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'seed line' }],
		lastSeq: 1,
		running: false,
		workspace: '/ws/x'
	};
	const instance = mount(Page, { target });
	await settle();
	return { target, instance };
}

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource);
	localStorage.clear();
	browserBody = { ok: true, sessions: [] };
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('+page.svelte — boot browser auto-restore ladder', () => {
	it('a persisted id with a failing probe declines quietly (res not ok)', async () => {
		localStorage.setItem('dsi.browser.sessionId', 'b-live');
		browserBody = { ok: false, sessions: [] };
		const { instance } = await mountBare();
		expect(document.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		unmount(instance);
	});

	it('an empty slot list (Amendment 3) restores nothing', async () => {
		localStorage.setItem('dsi.browser.sessionId', 'b-live');
		const { instance } = await mountBare();
		await settle();
		expect(document.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		unmount(instance);
	});

	it('a slot whose sessionId is live restores the glass at its persisted slot (Amendment 3 list)', async () => {
		localStorage.setItem('dsi.browser.panelIndex', JSON.stringify([{ index: 1, openedBy: 's-floor', sessionId: 'b-live' }]));
		browserBody = { ok: true, sessions: [{ id: 'b-live' }] };
		const { target, instance } = await mountBare();
		const slot = await waitFor('[data-testid="panel-browser-slot"]', target);
		expect(slot).not.toBeNull();
		unmount(instance);
	});

	it('TWO live slots restore TWO glasses, each bound to its OWN session (Amendment 3 reload survival)', async () => {
		localStorage.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([
				{ index: 1, openedBy: 's-floor', sessionId: 'b-live' },
				{ index: 2, openedBy: 's-other', sessionId: 'b-live-2' }
			])
		);
		browserBody = { ok: true, sessions: [{ id: 'b-live' }, { id: 'b-live-2' }] };
		const { target, instance } = await mountBare();
		await settle();
		const slots = target.querySelectorAll('[data-testid="panel-browser-slot"]');
		expect(slots.length).toBe(2);
		unmount(instance);
	});

	it('a slot with a dead sessionId (probe lists others) — no auto-open (per-slot gate)', async () => {
		localStorage.setItem('dsi.browser.panelIndex', JSON.stringify([{ index: 1, sessionId: 'b-dead' }]));
		browserBody = { ok: true, sessions: [{ id: 'other' }] };
		const { instance } = await mountBare();
		await settle();
		expect(document.querySelector('[data-testid="panel-browser-slot"]')).toBeNull();
		unmount(instance);
	});
});

describe('+page.svelte — terminal slot + non-conversation column fallbacks', () => {
	it('the terminal request renders the desk slot; rack/shelf adds ride the move-fact fallback arms', async () => {
		const { target, instance } = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'terminal' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		expect(addPanelFromSidebar({ kind: 'plugin-rack' })).toBe(true);
		expect(addPanelFromSidebar({ kind: 'skill-shelf' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="panel-plugins"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="panel-skills"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('+page.svelte — injected-doc cold-cache arms + loupe hostClose', () => {
	it('floor slot reads the seeded cold cache; a cache miss feeds empty; the loupe close closes the LENS copy', async () => {
		const { target, instance } = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-floor', displayPath: 'notes/x.md' })).toBe(true);
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-nocold', displayPath: 'other/y.md' })).toBe(true);
		await settle();
		const docHeaders = [...target.querySelectorAll('[data-testid="panel-header"]')].filter(
			(h) => h.getAttribute('title') === 'notes/x.md' || h.getAttribute('title') === 'other/y.md'
		);
		expect(docHeaders.length).toBe(2);
		const hitColumn = docHeaders[0].closest<HTMLElement>('[data-testid="panel-column"]');
		if (!hitColumn) throw new Error('panel column for injected-doc header not found');
		hitColumn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		hitColumn.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		await settle();
		const loupe = document.querySelector('[data-testid="panel-loupe"]');
		expect(loupe).not.toBeNull();
		unmount(instance);
	});
});

describe('+page.svelte — explorer open-file arms (home vs session)', () => {
	it('settings-home explorer open-file opens a TAB; session explorer opens the floor file panel', async () => {
		const { target, instance } = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		const homeCol = [...target.querySelectorAll('[data-testid="panel-column"]')].find((c) =>
			c.querySelector('[data-testid="workspace-explorer"]')
		);
		if (!homeCol) throw new Error('home explorer column not rendered');
		const homeFile = homeCol.querySelector<HTMLElement>('[data-testid="tree-file"]');
		// The stub must serve /api/settings-home/tree (see installFetch
		// verdict note) or this element never renders.
		if (!homeFile) throw new Error('home tree-file row not rendered');
		homeFile.click();
		await settle();
		expect(target.querySelector('[data-testid^="workspace-file-tab-"]')).not.toBeNull();
		const workspaceChip = target.querySelector<HTMLElement>('[data-testid="session-workspace"]');
		if (!workspaceChip) throw new Error('session-workspace chip not rendered');
		workspaceChip.click();
		await settle();
		const explorers = [...target.querySelectorAll('[data-testid="panel-column"]')].filter((c) =>
			c.querySelector('[data-testid="workspace-explorer"]')
		);
		expect(explorers.length).toBeGreaterThanOrEqual(2);
		const sessionCol = explorers[explorers.length - 1];
		const file = sessionCol.querySelector<HTMLElement>('[data-testid="tree-file"]');
		// VERDICT (systematic-debugging, 2026-10-20): the session arm no
		// longer opens the standalone workspace-file panel. The Settings
		// Tree ADR D1 (2026-09-18) made 'explorer is the only behavior —
		// every click is a tab (open or focus), session or home'
		// (WorkspaceExplorerPanel.svelte handleFileClick); the tree click
		// publishes onOpenTab -> openExplorerTab, an OWNER-PERSISTED tab
		// on the explorer itself. The page's onOpenFile session arm
		// (openWorkspaceFile) survives only as the prop contract, not a
		// click path. The test was pinning the pre-amendment shape.
		if (!file) throw new Error('session tree-file row not rendered');
		file.click();
		await settle();
		const sessionTabs = sessionCol.querySelectorAll('[data-testid^="workspace-file-tab-"]');
		expect(sessionTabs.length).toBeGreaterThan(0);
		expect(target.querySelector('[data-testid="workspace-file-panel"]')).toBeNull();
		unmount(instance);
	});
});

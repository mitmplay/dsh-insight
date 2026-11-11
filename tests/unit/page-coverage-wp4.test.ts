/**
 * page-coverage-wp4 — the +page.svelte panelBody branch sites the earlier
 * suites leave uncovered (coverage pass 2026-11-07):
 *  - L720  TerminalDesk zoom cond: floor site (floorPanelId -> pagePrefs.zoom)
 *          AND loupe site (floorPanelId null -> 1).
 *  - L739  browserSessionId cond: slot without and with an id.
 *  - L741  onclose guard: 'browserSessionId' in panel && id — both arms
 *          (the real BrowserManager never dies in tests, so a stub fires
 *          the wire-death callbacks).
 *  - L747  headedOpen cond: absent vs headedOpen: true.
 *  - L755  onclosed guard: both arms of the same pair.
 *  - L771  injected-doc onclose hostClose ?? fallback: the FLOOR copy's
 *          close button runs the fallback (removePanel); the LOUPE copy's
 *          close runs hostClose (the lens closes, the floor copy stays).
 *  - L826  settings-editor onclose hostClose ?? fallback: same pair.
 *  - L841  explorer onOpenFile home guard: home present (openExplorerTab)
 *          vs home undefined. L845 session guard true arm (openWorkspaceFile
 *          publishes a file intent). The 845-false arm (no home AND null
 *          session) is unreachable through a restored blob — isPanelEntry
 *          junk-filters a session-less explorer without a home (panel-kind).
 *
 * Mounting conventions copied from page-branch-mop3.test.ts /
 * root-page-branches-coverage.test.ts (reactiveTestPage seed + settle()).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { addPanelFromSidebar, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { st, openBrowserPanel } from '$lib/services/panels/floor-registry.svelte';
import { calls as browserCalls } from './stubs/wp4-browser-stub.svelte';
import { calls as explorerCalls } from './stubs/wp4-explorer-stub.svelte';

// The real monaco settings glue loads a chunk happy-dom cannot tear down —
// record its calls instead (same double as settings-editor-panel.test.ts).
const glueState = {
	value: '',
	initial: '',
	onChange: (): void => {},
	disposed: false
};

vi.mock('$lib/components/common/settings-monaco', () => ({
	createYamlEditor: (
		_container: HTMLElement,
		initial: string,
		onChange: () => void
	) => {
		glueState.value = initial;
		glueState.initial = initial;
		glueState.onChange = onChange;
		return {
			getValue: () => glueState.value,
			setValue: (text: string) => {
				glueState.value = text;
			},
			dispose: () => {
				glueState.disposed = true;
			}
		};
	}
}));

// The real BrowserManager only dies over the wire (fold/close POSTs) and
// the real explorer never forwards a click to the page's onOpenFile prop
// (The Settings Tree ADR D1 routed every click through onOpenTab), so the
// two child components are stubbed to fire the page-side callbacks.
vi.mock('$lib/components/browser/BrowserManager.svelte', async () => {
	return { default: (await import('./stubs/wp4-browser-stub.svelte')).default };
});
vi.mock('$lib/components/workspace-explorer/WorkspaceExplorerPanel.svelte', async () => {
	return { default: (await import('./stubs/wp4-explorer-stub.svelte')).default };
});

class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	handlers = new Map<string, Set<(ev: unknown) => void>>();
	onerror: ((ev: unknown) => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (ev: unknown) => void) {
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

const fetchCalls: string[] = [];

function installFetch() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input) => {
			const url = String(input);
			fetchCalls.push(url);
			const body =
				url.includes('/api/browser') ? { ok: true, sessions: [] }
				: url.includes('/api/config') ? { ok: true }
				: url.includes('/api/dsh/sessions') ? { ok: true, sessions: [SESSION_ROW], workspaces: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/terminal') ? { ok: true, enabled: true, sessions: [] }
				: url.includes('/api/settings-home/tree') ? { ok: true, listing: { path: '', entries: [], truncated: false } }
				: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
				: url.includes('/api/prompts') ? { ok: true, prompts: [] }
				: url.includes('/api/skills') ? { ok: true, skills: [], categories: [] }
				: url.includes('/api/plugins') ? { ok: true, plugins: [], marketplace: [] }
				: url.includes('/api/dsh/workspace-file') ? { ok: true, file: { text: 'hello', eof: true } }
				: url.includes('/api/workspace/git-map') ? { ok: true, enabled: true, rootIsRepo: true, repos: {} }
				: { ok: true };
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

const livePages: unknown[] = [];

/** Seeded mount: one conversation panel for ?sessionKey=s-floor, cold data primed. */
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
	livePages.push(instance);
	await settle();
	return { target, instance };
}

/** Bare-arrival mount over a restored panel-prefs blob (the seed panels). */
async function mountBare(panels: Array<Record<string, unknown>>) {
	localStorage.setItem(
		'dsi-panels',
		JSON.stringify({ panels, selectedPanelId: panels[0]?.id ?? null, panelWidth: 600, zoom: 1 })
	);
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

/** The Loupe open gesture, copied from page-branch-mop3.test.ts: focus
 *  pointerdown, then an alt-click on the column. */
async function openLoupe(column: HTMLElement) {
	column.dispatchEvent(new Event('pointerdown', { bubbles: true }));
	column.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
	await settle();
	return document.querySelector('[data-testid="panel-loupe"]');
}

beforeEach(() => {
	glueState.disposed = false;
	glueState.value = '';
	glueState.initial = '';
	glueState.onChange = () => {};
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource);
	localStorage.clear();
	fetchCalls.length = 0;
	browserCalls.length = 0;
	explorerCalls.length = 0;
});

afterEach(() => {
	while (livePages.length > 0) unmount(livePages.pop() as never);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	document.body.innerHTML = '';
});

describe('+page.svelte WP4 — terminal zoom arms (L720)', () => {
	it('the floor copy renders the prefs zoom; the loupe copy renders zoom 1', async () => {
		const { target } = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'terminal' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		const col = [...target.querySelectorAll<HTMLElement>('[data-testid="panel-column"]')].find((c) =>
			c.querySelector('[data-testid="panel-terminal"]')
		);
		if (!col) throw new Error('terminal column not found');
		const loupe = await openLoupe(col);
		// L720 both arms rendered: floorPanelId truthy (floor) and null (loupe).
		expect(loupe).not.toBeNull();
		expect(document.querySelectorAll('[data-testid="panel-terminal"]').length).toBe(2);
	});
});

describe('+page.svelte WP4 — browser slot guards (L739/741/747/755)', () => {
	it('a slot WITHOUT a sessionId runs the false arms (L739, L747, L741, L755) and close removes it', async () => {
		const { target } = await mountSeeded();
		// A restored 'browser' blob re-enters the SLOT RAIL, not the floor
		// ladder — the panelBody browser branch renders only for a SUMMONED
		// floor glass, so open one through the real chrome verb.
		openBrowserPanel();
		await settle();
		// the stub fires onclose/onclosed on a microtask during the settles —
		// the guards have run (both false arms) and the slot has dropped. The
		// recorded facts pin the prop cond arms (L739 sessionless, L747
		// headedOpen absent).
		expect(browserCalls).toEqual([{ session: undefined, headed: false }]);
		expect(target.querySelector('[data-testid="wp4-browser-stub"]')).toBeNull();
		expect(st.panels.some((p) => p.kind === 'browser')).toBe(false);
	});

	it('a slot WITH a sessionId + headedOpen runs the true arms and close POSTs the wire kill', async () => {
		const { target } = await mountSeeded();
		openBrowserPanel(undefined, false, 600, 's-floor', 'b-live', true);
		await settle();
		// same microtask shape: the true arms (L739 id, L747 headedOpen) rode
		// the mount props; L741/L755 true arms ran on the callbacks.
		expect(browserCalls).toEqual([{ session: 'b-live', headed: true }]);
		// releaseGlasses fired (the wire kill POST) and the slot dropped.
		expect(fetchCalls.some((u) => u.includes('/api/browser/b-live/close'))).toBe(true);
		expect(target.querySelector('[data-testid="wp4-browser-stub"]')).toBeNull();
		expect(st.panels.some((p) => p.kind === 'browser')).toBe(false);
	});
});

describe('+page.svelte WP4 — injected-doc onclose pair (L771)', () => {
	it('the FLOOR copy close button runs the fallback arm (removePanel)', async () => {
		const { target } = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-floor', displayPath: 'notes/x.md' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="injected-doc-close"]')).not.toBeNull();
		target.querySelector<HTMLElement>('[data-testid="injected-doc-close"]')!.click();
		await settle();
		expect(st.panels.some((p) => p.kind === 'injected-doc')).toBe(false);
	});

	it('the LOUPE copy close button runs the hostClose arm (lens closes, floor copy stays)', async () => {
		const { target } = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-floor', displayPath: 'notes/x.md' })).toBe(true);
		await settle();
		const col = [...target.querySelectorAll<HTMLElement>('[data-testid="panel-column"]')].find((c) =>
			c.querySelector('[data-testid="panel-header"]')?.getAttribute('title') === 'notes/x.md'
		);
		if (!col) throw new Error('injected-doc column not found');
		const loupe = (await openLoupe(col)) as HTMLElement;
		expect(loupe).not.toBeNull();
		loupe.querySelector<HTMLElement>('[data-testid="injected-doc-close"]')!.click();
		await settle();
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		expect(st.panels.some((p) => p.kind === 'injected-doc')).toBe(true);
	});
});

describe('+page.svelte WP4 — settings-editor onclose pair (L826)', () => {
	it('the FLOOR settings copy close runs the fallback arm (removePanel)', async () => {
		const { target } = await mountBare([{ id: 'pset', kind: 'settings-editor', target: 'dsi', width: 600 }]);
		expect(target.querySelector('[data-testid="panel-settings"]')).not.toBeNull();
		target.querySelector<HTMLElement>('[data-testid="settings-close"]')!.click();
		await settle();
		expect(target.querySelector('[data-testid="panel-settings"]')).toBeNull();
	});

	it('the LOUPE settings copy close runs the hostClose arm (lens closes)', async () => {
		const { target } = await mountBare([{ id: 'pset2', kind: 'settings-editor', target: 'dsi', width: 600 }]);
		const col = target.querySelector<HTMLElement>('[data-testid="panel-column"]')!;
		const loupe = (await openLoupe(col)) as HTMLElement;
		expect(loupe).not.toBeNull();
		loupe.querySelector<HTMLElement>('[data-testid="settings-close"]')!.click();
		await settle();
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		expect(st.panels.some((p) => p.id === 'pset2')).toBe(true);
	});
});

describe('+page.svelte WP4 — explorer onOpenFile arms (L841/L845)', () => {
	it('home explorer open-file opens a TAB; session explorer publishes the file intent', async () => {
		await mountBare([
			{ id: 'pex-home', kind: 'workspace-explorer', home: 'dsi', sessionId: null, root: '/h/.dsi', width: 600 },
			{ id: 'pex-s', kind: 'workspace-explorer', sessionId: 's-floor', root: '/ws/x', width: 600 }
		]);
		await settle(); // the stub fires onOpenFile on a microtask
		expect(explorerCalls).toEqual([
			{ home: true, session: null },
			{ home: false, session: 's-floor' }
		]);
		// L841 true arm: openExplorerTab appended a persisted tab.
		const home = st.panels.find((p) => p.id === 'pex-home') as { openTabs?: string[]; activeFile?: string | null };
		expect(home.openTabs).toContain('wp4/README.md');
		expect(home.activeFile).toBe('wp4/README.md');
		// L841 false arm -> L845 true arm: openWorkspaceFile published an intent.
		expect(st.pendingFileIntents['pex-s']?.path).toBe('wp4/README.md');
	});
});

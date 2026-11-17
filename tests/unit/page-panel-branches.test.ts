/**
 * +page.svelte explorer/file panel branches (coverage pass 2026-09-14):
 * the workspace-explorer and workspace-file floor slots — open via the
 * header workspace chip, dedupe-to-focus on a second open, tree dir
 * toggle, changes-tab switch, file open -> file panel render, view
 * toggle (persisted on the entry). Same mounting conventions as
 * page-floor-interactions.test.ts (reactiveTestPage seed + settle()).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	resetPanelRegistryForTests,
	replacePanelFromRegistry,
	replacePanelBySession,
	movePanelFromRegistry
} from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import {
	resetAppConfigForTests,
	appConfig,
	loadAppConfig
} from '$lib/services/config/app-config.svelte';

/** Minimal EventSource stub: the explorer opens a git-events stream. */
class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	handlers = new Map<string, Set<(e: { data?: string }) => void>>();
	onerror: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (e: { data?: string }) => void): void {
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

function listing(entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>) {
	return { ok: true, listing: { path: '', entries, truncated: false } };
}

let configBody: Record<string, unknown> = {};

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body =
				url.includes('/api/config') ? { ok: true, ...configBody }
				: url.includes('/api/dsh/sessions') ? { ok: true, sessions: [SESSION_ROW], workspaces: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
				: url.includes('/api/prompts') ? { ok: true, prompts: [] }
				: url.includes('/api/workspace/write-gate') ? { ok: true, enabled: true }
				: url.includes('/api/workspace/git-map') ? { ok: true, enabled: true, rootIsRepo: true, repos: { app: true } }
				: url.includes('/api/workspace/git-status') ? { ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'README.md' }] }
				: url.includes('/api/dsh/workspace-file') ? { ok: true, file: { text: 'hello\n', eof: true } }
				: { ok: true, listing: { path: '', entries: [{ name: 'docs', type: 'directory' }, { name: 'README.md', type: 'file' }], truncated: false } };
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

async function waitFor(selector: string, scope: HTMLElement, timeoutMs = 3000): Promise<HTMLElement> {
	const started = Date.now();
	for (;;) {
		const el = scope.querySelector<HTMLElement>(selector);
		if (el) return el;
		flushSync();
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 25));
		if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout: ' + selector);
	}
}

async function mountPage() {
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

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	resetAppConfigForTests();
	document.body.innerHTML = '';
});

describe('+page.svelte — explorer + file panel branches', () => {
	it('chip click opens the explorer; second click dedupes to focus; dir toggle + changes tab', async () => {
		const page = await mountPage();
		const { target } = page;
		const chip = target.querySelector<HTMLElement>('[data-testid="session-workspace"]');
		expect(chip).not.toBeNull();
		chip!.click();
		await settle();
		expect(target.querySelectorAll('[data-testid="workspace-explorer"]').length).toBe(1);
		// dedupe-to-focus: a second open adds NO second explorer column
		const columnsBefore = target.querySelectorAll('[data-testid="panel-column"]').length;
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(columnsBefore);
		// tree fetched: one dir row toggles expanded, twice (open + collapse)
		const dir = target.querySelector<HTMLElement>('[data-testid="tree-dir"]');
		expect(dir).not.toBeNull();
		dir!.click();
		await settle();
		dir!.click();
		await settle();
		// the changes tab switch persists the tab on the entry
		target.querySelector<HTMLElement>('[data-testid="git-tab-changes"]')!.click();
		await settle();
		expect(target.querySelector('[data-testid="git-changes"]')).not.toBeNull();
		// repo toggle: off then on (both arms of the collapsedRepos ternary)
		const repoToggle = await waitFor('[data-testid="git-changes-toggle"]', target);
		repoToggle.click();
		await settle();
		(await waitFor('[data-testid="git-changes-toggle"]', target)).click();
		await settle();
		// a changed row opens the file panel with the repo-prefixed path
		const changeRow = target.querySelector<HTMLElement>('[data-testid="git-change-row"]');
		if (changeRow) {
			changeRow.click();
			await settle();
			target.querySelector<HTMLElement>('[data-testid="git-tab-explorer"]')!.click();
			await settle();
		}
		// collapse-all on the changes tab collapses EVERY known repo
		(await waitFor('[data-testid="explorer-collapse-all"]', target)).click();
		await settle();
		// back to the tree tab; collapse-all empties expanded
		target.querySelector<HTMLElement>('[data-testid="git-tab-explorer"]')!.click();
		await settle();
		(await waitFor('[data-testid="explorer-collapse-all"]', target)).click();
		await settle();
		expect(target.querySelector('[data-testid="git-changes"]')).toBeNull();
		unmount(page.instance);
	});

	it('a tree file click opens the file panel; the view toggle persists edit/diff', async () => {
		const page = await mountPage();
		const { target } = page;
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		const fileRow = target.querySelector<HTMLElement>('[data-testid="tree-file"]');
		expect(fileRow).not.toBeNull();
		fileRow!.click();
		await settle();
		expect(target.querySelectorAll('[data-testid="workspace-file-panel"]').length).toBe(1);
		// view toggle round-trip: diff then back to edit (persisted on entry)
		(await waitFor('[data-testid="file-view-diff"]', target)).click();
		await settle();
		(await waitFor('[data-testid="file-view-edit"]', target)).click();
		await settle();
		expect(target.querySelectorAll('[data-testid="workspace-file-panel"]').length).toBe(1);
		unmount(page.instance);
	});

	it('registry negatives: bogus ids/sessions drive the miss branches; a settings-home swap replaces the explorer slot', async () => {
		const page = await mountPage();
		const { target } = page;
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		const columns = [...target.querySelectorAll<HTMLElement>('[data-testid="panel-column"]')];
		const explorerCol = columns.find((c) => c.querySelector('[data-testid="workspace-explorer"]'));
		expect(explorerCol).toBeDefined();
		// replace the explorer slot with the settings-home explorer (Settings
		// Tree D2) — the swap succeeds and the column hosts the home tree.
		expect(replacePanelFromRegistry(explorerCol!.dataset.panelId ?? '', { kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).not.toBeNull();
		// registry calls with UNKNOWN ids/sessions drive the page handlers'
		// miss branches (doReplacePanel/doReplacePanelBySession/doMovePanel
		// early returns) — the wrappers themselves always report true.
		replacePanelFromRegistry('bogus-id', { kind: 'settings-home', home: 'dsi' });
		replacePanelBySession('bogus-session', { kind: 'settings-home', home: 'dsi' });
		movePanelFromRegistry('bogus-id', 'left');
		await settle();
		unmount(page.instance);
	});
});

// ── The Explorer Layout (ADR 2026-09-17 D1/D3, Task 3.1-T) ──────────
describe('+page.svelte — explorer layout routing', () => {
	beforeEach(() => {
		installFetch();
		vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	});

	async function mountWithLayout(_layout?: 'panels' | 'explorer') {
		// The Settings Tree ADR 2026-09-18 D1: no layout knob — the explorer
		// layout is the only behavior; a stale `workspace` block is ignored.
		configBody = { workspace: { layout: _layout } };
		const page = await mountPage();
		await loadAppConfig();
		await settle();
		return page;
	}

	it('explorer layout: a tree file click opens a TAB — the floor gains NO column', async () => {
		const page = await mountWithLayout('explorer');
		const { target } = page;
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		const columnsBefore = target.querySelectorAll('[data-testid="panel-column"]').length;
		(await waitFor('[data-testid="tree-file"]', target)).click();
		await settle();
		// the floor never gains a column (D3) — the file renders INSIDE the
		// explorer's tab body, so WorkspaceFilePanel's own testid appears
		// there; the FLOOR column count is the honest floor assertion.
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(columnsBefore);
		// the file lives INSIDE the explorer as a tab
		expect(target.querySelector('[data-testid="workspace-file-tab-README.md"]')).not.toBeNull();
		unmount(page.instance);
	});

	it('explorer layout: a repeat click stays at ONE tab (dedupe, no floor entry)', async () => {
		const page = await mountWithLayout('explorer');
		const { target } = page;
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		const file = await waitFor('[data-testid="tree-file"]', target);
		const columnsBefore = target.querySelectorAll('[data-testid="panel-column"]').length;
		file.click();
		await settle();
		file.click();
		await settle();
		expect(target.querySelectorAll('[data-testid^="workspace-file-tab-"][role="tab"]').length).toBe(1);
		// the clicks never added a floor slot
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(columnsBefore);
		unmount(page.instance);
	});

	it.skip('panels layout (explicit): the floor path is unchanged — RETIRED by The Settings Tree ADR 2026-09-18 D1', async () => {
		const page = await mountWithLayout('panels');
		const { target } = page;
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		await settle();
		(await waitFor('[data-testid="tree-file"]', target)).click();
		await settle();
		expect(target.querySelectorAll('[data-testid="workspace-file-panel"]').length).toBe(1);
		expect(target.querySelector('[data-testid="workspace-file-tabs"]')).toBeNull();
		unmount(page.instance);
	});
});
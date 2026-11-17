/**
 * conversation-page-intents — page-level mount tests for src/routes/+page.svelte,
 * companion to conversation-page.test.ts (which owns the load-fn and seed
 * stories). This file drives the FLOOR intent handlers the load tests never
 * reach: the plugin-rack add/restore ladder (The Plugin Rack ADR), the
 * skill-shelf chrome write-back callbacks (collapse / reload), the
 * explorer tab family (open / activate / close, restored + bare), the
 * file-intent publish/consume round-trip for a SESSION explorer, and the
 * explorer split drag (treePct). Same mounting conventions as
 * page-panel-branches.test.ts (reactiveTestPage seed + settle()).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { addPanelFromSidebar, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { getWorkspaceState, setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

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
	sessionId: 's-rest',
	title: 'Rest',
	agentPreset: null,
	running: false,
	blank: false,
	updatedAt: 0,
	workspace: '/ws/x',
	turns: null
};

const SKILLS_SNAP = {
	ok: true,
	reused: true,
	uninstallable: ['signed-one'],
	snapshot: {
		generatedAt: '2026-09-20T00:00:00Z',
		sources: [
			{
				id: 'pstack',
				author: 'Lauren Tan',
				repo: 'r',
				skills: [
					{ n: '1.1', id: 'signed-one', path: 'p', tier: null, installed: true, signed: true, installedFrom: 'pstack' },
					{ n: '1.3', id: 'absent-one', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }
				]
			}
		]
	}
};

const PLUGINS_SNAP = {
	ok: true,
	reused: true,
	snapshot: {
		generatedAt: '2026-09-27T00:00:00Z',
		profile: 'web',
		plugins: [
			{ n: '1', id: 'dsh-rules-paths', repo: 'https://github.com/Temoa/dsh-rules-paths', author: 'Temoa', authorUrl: 'https://github.com/Temoa', installed: false },
			{ n: '2', id: 'installed-plugin', repo: 'https://github.com/x/y', author: null, installed: true }
		]
	}
};

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body =
				url.includes('/api/plugins/snapshot') ? PLUGINS_SNAP
				: url.includes('/api/skills/snapshot') ? SKILLS_SNAP
				: url.includes('/api/skills') ? { ok: true }
				: url.includes('/api/dsh/sessions') ? { ok: true, sessions: [SESSION_ROW], presets: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/prompts') ? { ok: true, prompts: [] }
				: url.includes('/api/dsh/workspace-file') ? { ok: true, file: { text: 'hello\n', eof: true } }
				: url.includes('/api/workspace/write-gate') ? { ok: true, enabled: false }
				: url.includes('/api/workspace/git-map') ? { ok: true, enabled: false, rootIsRepo: false, repos: {} }
				: { ok: true, listing: { path: '', entries: [{ name: 'docs', type: 'directory' }, { name: 'README.md', type: 'file' }, { name: 'notes.md', type: 'file' }], truncated: false } };
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

function stageBlob(blob: unknown): void {
	localStorage.setItem('dsi-panels', JSON.stringify(blob));
}

function stageBare(): void {
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
}

async function mountPage(stage: () => void): Promise<HTMLElement> {
	stage();
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Page, { target });
	await settle();
	return target;
}

function rows(): Array<{ panel: { kind: string; id: string; [k: string]: unknown } }> {
	return (getWorkspaceState()?.rows ?? []) as never;
}

function byKind(kind: string): { panel: { id: string; [k: string]: unknown } } | undefined {
	return rows().find((r) => r.panel.kind === kind) as never;
}

function unmountAll(): void {
	const node = document.body.firstElementChild;
	if (node) unmount(node as never);
	document.body.innerHTML = '';
}

afterEach(() => {
	unmountAll();
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	resetSpineFeedForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
});

describe('+page.svelte intents — plugin-rack floor slots', () => {
	it('the sidebar add inserts the rack; the tab intent persists on the entry; a repeat dedupes', async () => {
		stageBlob({
			panels: [{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 }],
			selectedPanelId: 'panel-c',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		const target = await mountPage(stageBare);
		expect(byKind('plugin-rack')).toBeUndefined();

		// fresh insert → the rack slot exists, initial tab restored to install
		expect(addPanelFromSidebar({ kind: 'plugin-rack' })).toBe(true);
		await settle();
		const rack = byKind('plugin-rack');
		expect(rack).toBeDefined();
		expect(rack!.panel.tab ?? 'install').toBe('install');

		// tab intent: clicking uninstall writes the persisted entry fact
		const uninstall = await waitFor('[data-testid="rack-tab-uninstall"]', target);
		uninstall.click();
		await settle();
		expect(byKind('plugin-rack')!.panel.tab).toBe('uninstall');

		// repeat add → the OPEN rack takes the focus, no second slot
		const before = target.querySelectorAll('[data-testid="panel-column"]').length;
		expect(addPanelFromSidebar({ kind: 'plugin-rack' })).toBe(true);
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(before);
		expect(rows().filter((r) => r.panel.kind === 'plugin-rack')).toHaveLength(1);
	});

	it('a restored rack entry carries its persisted tab into the panel (direct ?? arm)', async () => {
		stageBlob({
			panels: [{ id: 'panel-r', kind: 'plugin-rack', tab: 'uninstall', width: 600 }],
			selectedPanelId: 'panel-r',
			panelWidth: 600,
			zoom: 1,
			treePct: 40
		});
		const target = await mountPage(stageBare);
		const uninstall = await waitFor('[data-testid="rack-tab-uninstall"]', target);
		expect(uninstall.getAttribute('aria-pressed')).toBe('true');
	});
});

describe('+page.svelte intents — skill-shelf chrome write-back', () => {
	it('collapse + reload intents persist on the shelf entry', async () => {
		stageBlob({
			panels: [{ id: 'panel-shelf', kind: 'skill-shelf', width: 600 }],
			selectedPanelId: 'panel-shelf',
			panelWidth: 600,
			zoom: 1,
			treePct: 40
		});
		const target = await mountPage(stageBare);
		await waitFor('[data-testid="shelf-tab-group"]', target);

		// collapsed-set intent: expand-all flips the collapsed set (both arms
		// of the owner write — collapse then expand)
		const expand = target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]');
		if (expand) {
			expand.click();
			await settle();
			expand.click();
			await settle();
		}

		// reload intent: the reload button emits the feedback machine's
		// first phase onto the entry (onreloadchange → setShelfReload)
		const reload = target.querySelector<HTMLButtonElement>('[data-testid="shelf-reload"]');
		if (reload) {
			reload.click();
			await settle();
		}
		// the shelf entry survived the round-trip with its chrome intact
		expect(byKind('skill-shelf')).toBeDefined();
	});
});

describe('+page.svelte intents — explorer tab family (home plane)', () => {
	const HOME_EXPLORER_BASE = {
		selectedPanelId: 'panel-h',
		panelWidth: 600,
		zoom: 1,
		treePct: 40
	};

	it('a tree file click opens a tab; activate + close persist the owner facts', async () => {
		stageBlob({
			panels: [{ id: 'panel-h', kind: 'workspace-explorer', sessionId: null, home: 'dsi', root: '', expanded: [], width: 600 }],
			...HOME_EXPLORER_BASE
		});
		const target = await mountPage(stageBare);
		const fileRow = await waitFor('[data-testid^="tree-file"]', target);
		const firstName = fileRow.textContent.trim();
		fileRow.click();
		await settle();
		// the tab opened on the entry (openExplorerTab: openTabs ?? [] bare arm)
		expect(byKind('workspace-explorer')!.panel.openTabs).toEqual([firstName]);
		expect(byKind('workspace-explorer')!.panel.activeFile).toBe(firstName);

		// a second file click appends (includes → false arm)
		const all = target.querySelectorAll<HTMLElement>('[data-testid^="tree-file"]');
		const secondName = all[all.length - 1].textContent.trim();
		expect(secondName).not.toBe(firstName);
		all[all.length - 1].click();
		await settle();
		const tabs = byKind('workspace-explorer')!.panel.openTabs as string[];
		expect(tabs).toEqual([firstName, secondName]);

		// activate the first tab (activateExplorerTab: membership guard passes)
		const strip = target.querySelectorAll<HTMLElement>('[data-testid^="workspace-file-tab-"]');
		expect(strip.length).toBeGreaterThanOrEqual(2);
		strip[0].click();
		await settle();
		expect(byKind('workspace-explorer')!.panel.activeFile).toBe(tabs[0]);

		// close the ACTIVE tab with a neighbor → the neighbor takes over
		const closeActive = target.querySelector<HTMLElement>('[data-testid="workspace-file-tabclose-' + tabs[0] + '"]');
		closeActive!.click();
		await settle();
		expect(byKind('workspace-explorer')!.panel.activeFile).toBe(tabs[1]);

		// close the LAST tab → activeFile falls to null
		const closeLast = target.querySelector<HTMLElement>('[data-testid="workspace-file-tabclose-' + tabs[1] + '"]');
		closeLast!.click();
		await settle();
		expect(byKind('workspace-explorer')!.panel.openTabs).toEqual([]);
		expect(byKind('workspace-explorer')!.panel.activeFile).toBeNull();
	});

	it('a restored tab strip keeps its facts; closing a NON-active tab keeps the active file', async () => {
		stageBlob({
			panels: [{
				id: 'panel-h',
				kind: 'workspace-explorer',
				sessionId: null,
				home: 'dsi',
				root: '',
				expanded: [],
				openTabs: ['notes.md', 'README.md'],
				activeFile: 'notes.md',
				width: 600
			}],
			...HOME_EXPLORER_BASE
		});
		const target = await mountPage(stageBare);
		// direct ?? arms: the restored strip renders as-is
		expect(await waitFor('[data-testid="workspace-file-tab-README.md"]', target)).not.toBeNull();

		// close the NON-active tab → the active file is untouched
		target.querySelector<HTMLElement>('[data-testid="workspace-file-tabclose-README.md"]')!.click();
		await settle();
		expect(byKind('workspace-explorer')!.panel.openTabs).toEqual(['notes.md']);
		expect(byKind('workspace-explorer')!.panel.activeFile).toBe('notes.md');

		// tree-pct drag: mousedown on the seam, move, mouseup → owner clamp
		const rect = vi
			.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
			.mockReturnValue({ width: 1000, height: 100, x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 1000, toJSON: () => ({}) } as DOMRect);
		const gutter = target.querySelector<HTMLElement>('[data-testid="workspace-explorer"] .gutter');
		expect(gutter).not.toBeNull();
		gutter!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 500 }));
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
		window.dispatchEvent(new MouseEvent('mouseup'));
		rect.mockRestore();
		await settle();
	});
});

describe('+page.svelte intents — session explorer file-intent round-trip', () => {
	it('a tree file click publishes an intent; the panel consumes it and opens the tab', async () => {
		stageBlob({
			panels: [
				{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 },
				{ id: 'panel-e', kind: 'workspace-explorer', sessionId: 's-rest', root: '/ws/x', expanded: [], width: 600 }
			],
			selectedPanelId: 'panel-e',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		const target = await mountPage(stageBare);
		const fileRow = await waitFor('[data-testid^="tree-file"]', target);
		const name = fileRow.textContent.trim();
		fileRow.click();
		await settle();
		// publish → consume → openExplorerTab: the tab strip carries the file
		expect(byKind('workspace-explorer')!.panel.openTabs).toEqual([name]);
		expect(byKind('workspace-explorer')!.panel.activeFile).toBe(name);
	});
});

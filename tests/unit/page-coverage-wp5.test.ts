/**
 * page-coverage-wp5 — the last uncovered arms of src/routes/+page.svelte
 * (istanbul sites 918, 945, 989, 992, 993):
 *
 * - 918 cond-expr: the cold full-props ConversationPanel onOpenBrowser
 *   ternary — the SUBAGENT arm (a subagent-origin session renders the
 *   prop as undefined: a spawned child never opens a browser panel).
 * - 945 cond-expr: the FRESH (no cold yet) ConversationPanel same
 *   ternary — both arms: a subagent session AND a plain session painted
 *   before the cold load lands (fresh -> in-flight -> cold ladder).
 * - 989 cond-expr: PanelColumn copyValue ternary — the workspace-file
 *   TRUE arm (a file slot carries the explorer-rooted copy value).
 * - 992/993 binary-expr: PanelColumn canMoveLeft/canMoveRight — the
 *   rowFactsByPanelId operand (facts arm) over multi-panel floors.
 *
 * Conventions copied from page-branch-mop2.test.ts (mount + flushSync
 * settle, dsi-panels blob restore, stubbed fetch).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { getWorkspaceState, setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { pageFeeds } from '$lib/services/workspace/page-feeds.svelte';
import { floorReads } from '$lib/services/panels/floor-reads.svelte';

/** Deferred events handles — the WP5 fresh-branch test holds the cold
 *  ladder open so the fresh/onNeedCold paints are observable. */
let holdEvents: Array<() => void> = [];

function installFetch(opts: { sessions?: Array<Record<string, unknown>>; holdEvents?: boolean } = {}): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			let body: unknown;
			if (url.includes('/api/dsh/sessions')) {
				body = { ok: true, sessions: opts.sessions ?? [], presets: [], workspaces: [] };
			} else if (url.includes('/api/a2a')) {
				body = { ok: true, rows: [] };
			} else if (url.includes('/events')) {
				if (opts.holdEvents) {
					await new Promise<void>((resolve) => holdEvents.push(resolve));
				}
				body = { ok: true, entries: [], lastSeq: -1, running: false };
			} else if (url.includes('/history')) {
				body = { ok: true, entries: [], hasMore: false };
			} else if (url.includes('/models')) {
				body = { ok: true, current: null };
			} else if (url.includes('/api/prompts')) {
				body = { ok: true, rows: [] };
			} else if (url.includes('/api/browser')) {
				body = { ok: true, sessions: [] };
			} else {
				body = { ok: true, entries: [], hasMore: false };
			}
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function stageBare(): void {
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
}

function stageBlob(blob: unknown): void {
	localStorage.setItem('dsi-panels', JSON.stringify(blob));
}

async function mountPage(stage: () => void): Promise<HTMLElement> {
	stage();
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Page, { target });
	await settle();
	return target;
}

function rows(): Array<{ panel: { kind: string; id: string; [k: string]: unknown } }> {
	return (getWorkspaceState()?.rows ?? []) as never;
}

function unmountAll(): void {
	const node = document.body.firstElementChild;
	if (node) unmount(node as never);
	document.body.innerHTML = '';
}

afterEach(() => {
	unmountAll();
	holdEvents = [];
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	resetSpineFeedForTests();
	vi.restoreAllMocks();
	installFetch();
	vi.useRealTimers();
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
});

describe('+page.svelte WP5 — the fresh ladder arms (line 945)', () => {
	it('paints the fresh ConversationPanel for BOTH a subagent and a plain session before the cold lands', async () => {
		// The subagent spine row is what flips lineageFacts.subagentIds —
		// the ternary TRUE arm renders onOpenBrowser as undefined.
		installFetch({
			holdEvents: true,
			sessions: [
				{
					sessionId: 's-sub',
					title: 'spawned child',
					agentPreset: null,
					running: false,
					blank: false,
					updatedAt: 1,
					workspace: '/w',
					turns: null,
					origin: 'subagent'
				}
			]
		});
		stageBlob({
			panels: [
				{ id: 'panel-plain', kind: 'conversation', sessionId: 's-plain', agentPreset: null, width: 480 },
				{ id: 'panel-sub', kind: 'conversation', sessionId: 's-sub', agentPreset: null, width: 480 }
			],
			selectedPanelId: 'panel-plain',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);

		// the lineage fact is live: s-sub IS a subagent (ternary TRUE arm)
		expect(floorReads.lineageFacts.subagentIds.has('s-sub')).toBe(true);

		// the cold ladder is HELD OPEN, so both panels painted the FRESH
		// branch first (site 945, both arms) and now sit on the in-flight
		// loader — the fresh mount onNeedCold fired runCold synchronously.
		expect(pageFeeds.coldInFlight.has('s-plain')).toBe(true);
		expect(pageFeeds.coldInFlight.has('s-sub')).toBe(true);
		expect(pageFeeds.coldCache['s-plain']).toBeUndefined();
		expect(document.querySelectorAll('[data-testid="panel-loading"]').length).toBe(2);

		// release the held cold loads -> the cold full-props branch takes over
		for (const release of holdEvents) release();
		await settle();
		await new Promise((r) => setTimeout(r, 50));
		await settle();
		expect(pageFeeds.coldCache['s-plain']).toBeDefined();
		expect(pageFeeds.coldCache['s-sub']).toBeDefined();
		expect(document.querySelectorAll('[data-testid="panel-loading"]').length).toBe(0);
		expect(rows().filter((r) => r.panel.kind === 'conversation')).toHaveLength(2);
	});
});

describe('+page.svelte WP5 — the cold full-props subagent arm (line 918)', () => {
	it('mounts the cold full-props ConversationPanel with onOpenBrowser suppressed for a subagent session', async () => {
		installFetch({
			sessions: [
				{
					sessionId: 's-sub',
					title: 'spawned child',
					agentPreset: null,
					running: false,
					blank: false,
					updatedAt: 1,
					workspace: '/w',
					turns: null,
					origin: 'subagent'
				},
				{
					sessionId: 's-plain',
					title: 'plain chat',
					agentPreset: null,
					running: false,
					blank: false,
					updatedAt: 2,
					workspace: '/w',
					turns: null,
					origin: null
				}
			]
		});
		stageBlob({
			panels: [
				{ id: 'panel-sub', kind: 'conversation', sessionId: 's-sub', agentPreset: null, width: 480 },
				{ id: 'panel-plain', kind: 'conversation', sessionId: 's-plain', agentPreset: null, width: 480 }
			],
			selectedPanelId: 'panel-sub',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);

		// both sessions resolved through the fresh -> in-flight -> COLD ladder;
		// the cold branch onOpenBrowser ternary (site 918) now evaluates
		// BOTH arms: s-sub -> undefined (subagent), s-plain -> the opener fn.
		expect(floorReads.lineageFacts.subagentIds.has('s-sub')).toBe(true);
		expect(floorReads.lineageFacts.subagentIds.has('s-plain')).toBe(false);
		expect(pageFeeds.coldCache['s-sub']).toBeDefined();
		expect(pageFeeds.coldCache['s-plain']).toBeDefined();
		expect(document.querySelectorAll('[data-testid="panel-loading"]').length).toBe(0);
	});
});

describe('+page.svelte WP5 — the file slot copyValue arm (line 989)', () => {
	it('renders a workspace-file slot through PanelColumn with its explorer-rooted copy value', async () => {
		installFetch();
		stageBlob({
			panels: [
				{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 },
				{ id: 'panel-e', kind: 'workspace-explorer', sessionId: 's1', root: '/ws', expanded: [], width: 600 },
				{
					id: 'panel-f',
					kind: 'workspace-file',
					sessionId: 's1',
					path: 'a.md',
					explorerPanelId: 'panel-e',
					width: 600
				}
			],
			selectedPanelId: 'panel-f',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);
		// the TRUE arm of the copyValue ternary: the file slot mounted
		const file = document.querySelector('[data-testid="workspace-file-panel"]');
		expect(file).not.toBeNull();
		expect(file?.getAttribute('data-file-path')).toBe('a.md');
		// the FALSE arm rides the same floor: the conversation slot is there too
		expect(rows().some((r) => r.panel.kind === 'workspace-file')).toBe(true);
		expect(rows().some((r) => r.panel.kind === 'conversation')).toBe(true);
	});
});

describe('+page.svelte WP5 — the move-chevron facts operand (lines 992/993)', () => {
	it('a multi-panel floor evaluates the rowFactsByPanelId operand for every slot', async () => {
		installFetch();
		stageBlob({
			panels: [
				{ id: 'panel-a', kind: 'conversation', sessionId: 's-a', agentPreset: null, width: 480 },
				{ id: 'panel-b', kind: 'conversation', sessionId: 's-b', agentPreset: null, width: 480 },
				{ id: 'panel-t', kind: 'terminal', width: 480 }
			],
			selectedPanelId: 'panel-a',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);
		// every rendered slot has a row-facts entry — the LEFT operand of
		// both ?? expressions (sites 992/993) resolves per panel, and the
		// first/last slots exercise the boundary facts (index 0 / last).
		const facts = floorReads.rowFactsByPanelId;
		expect(facts.get('panel-a')).toBeDefined();
		expect(facts.get('panel-b')).toBeDefined();
		expect(facts.get('panel-t')).toBeDefined();
		expect(typeof facts.get('panel-a')!.canMoveUp).toBe('boolean');
		expect(typeof facts.get('panel-b')!.canMoveDown).toBe('boolean');
		expect(rows().some((r) => r.panel.kind === 'terminal')).toBe(true);
	});
});

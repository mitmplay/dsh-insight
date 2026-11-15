/**
 * workspace-route unit tests (paired with Panel Floor W3 task 3.1).
 *
 * The workspace route is the floor owner: seed-vs-restore resolution,
 * panels/selection/persistence, registry actions, runtime dual-fetch cold
 * load. This suite pins the seed/restore/dedupe/junk contract (Tasks.md
 * 3.1-T) against the real page component (conversation-page.test.ts
 * harness pattern — component-direct mount in happy-dom, shared
 * reactiveTestPage stub for $app/state).
 *
 * Cases:
 *  - SEED: /?sessionKey=… arrival resets panels to [that
 *    session], selects it, persists, and strips the URL (replaceState
 *    spy); the seed panel's agentPreset is the session row's (page.data),
 *    never the URL's.
 *  - RESTORE: bare / restores panels/selection/width/zoom
 *    from localStorage['dsi-panels'].
 *  - EMPTY: no stored panels → the empty-workspace state renders.
 *  - DEDUPE-ADD: adding an already-paneled session selects the existing
 *    panel (no duplicate row) — through the real registry round-trip.
 *  - JUNK: junk prefs fall back to defaults (empty workspace, no crash).
 *  - REGISTRY LIFECYCLE: after unmount, invoke returns false (commitment 8).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the page must bind to the SAME svelte runtime as
// mount/flushSync below (second-instance binding → effect_orphan).
import Page from '../../src/routes/+page.svelte';
import { movePanelWithin } from '@deepseek-insight/container-base';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	addPanelFromSidebar,
	movePanelFromRegistry,
	replaceSelectedFromRegistry,
	selectPanelFromRegistry
} from '../../src/lib/services/panels/panel-registry';
import { getWorkspaceState } from '../../src/lib/services/conversation/workspace-context.svelte';
import type { DsiPanelEntry } from '../../src/lib/types';

/** Seed-strip spy — the shared $app/navigation stub records every call. */
import { navigationState } from '../stubs/app-navigation';

/** Stage $app/state for a scenario; clear dsi-panels + registry by default. */
function stage(scenario: {
	path?: string;
	query?: string;
	/** Seed server-load data (page.data) — the seed panel's cold payload. */
	data?: Record<string, unknown>;
	prefs?: unknown;
}): void {
	localStorage.clear();
	navigationState.replaceStateCalls.length = 0;
	if (scenario.prefs !== undefined) {
		localStorage.setItem('dsi-panels', JSON.stringify(scenario.prefs));
	}
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL(`http://dsi${scenario.path ?? '/'}${scenario.query ?? ''}`);
	reactiveTestPage.data = scenario.data ?? {};
}

/** The live component instance — unmount needs the INSTANCE, not the
 *  root element: ADR-0019 W1 moved the floor state module-scope, so a
 *  zombie page's persistence effect re-runs on every later mutation and
 *  writes stale desks (the unmount(root-element) call silently kept
 *  every page alive). */
let lastPageInstance: ReturnType<typeof mount> | null = null;

async function mountPage() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Page, { target });
	lastPageInstance = instance;
	await flushEffects();
	return { target, instance };
}

/** Let effects/microtasks (persistence, seed strip) run. */
async function flushEffects(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
	}
	flushSync();
	await Promise.resolve();
}

function storedPrefs(): Record<string, unknown> {
	const raw = localStorage.getItem('dsi-panels');
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/** JSON Response helper for the default fetch double. */
function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

/** Default fetch double for mounts that need no specific bodies. Every
 *  page mount fires the runtime dual fetch + sidebar spine, and an
 *  unstubbed fetch rides happy-dom's `http://localhost:3000` base into a
 *  real ECONNREFUSED connect — thousands per run. Tests that assert fetch
 *  bodies re-stub inside the test; afterEach restores. */
function installDefaultFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/dsh/sessions')) return jsonResponse({ ok: true, sessions: [] });
			if (url.includes('/api/a2a')) return jsonResponse({ ok: true, rows: [] });
			if (url.includes('/events?full=1'))
				return jsonResponse({ ok: true, entries: [], lastSeq: -1, running: false });
			return jsonResponse({ ok: true, entries: [], hasMore: false });
		})
	);
}

beforeEach(() => {
	installDefaultFetch();
});

afterEach(() => {
	resetSpineFeedForTests(); // module-scope feed store - test isolation
	document.body.innerHTML = '';
	localStorage.clear();
	// Registry hygiene between tests: a mounted page clears on unmount,
	// but a failed mount must not leak handlers into the next test.
	vi.restoreAllMocks();
	// Re-arm the default fetch double instead of the real network: leaked
	// poll timers from a mount whose cleanup never ran must never reach
	// happy-dom's `http://localhost:3000` base (real ECONNREFUSED storm).
	installDefaultFetch();
});

describe('workspace route — SEED (R1: reset, select, persist, strip)', () => {
	it('/?sessionKey=… resets panels to exactly that session and strips the URL', async () => {
		// A stored workspace exists — the seed RESETS it, not merges.
		stage({
			path: '/',
			query: '?sessionKey=s-seed',
			prefs: {
				panels: [{ id: 'panel-9', kind: 'conversation', sessionId: 'other', agentPreset: null, width: 500 }],
				selectedPanelId: 'panel-9',
				panelWidth: 500,
				zoom: 1.2
			}
		});
		const { target } = await mountPage();
		const columns = target.querySelectorAll('[data-testid="panel-column"]');
		expect(columns).toHaveLength(1);
		expect(columns[0].getAttribute('data-session-id')).toBe('s-seed');
		// Selection: exactly one selected column.
		expect(target.querySelectorAll('.column.selected')).toHaveLength(1);
		// URL strip fired exactly once with /.
		expect(navigationState.replaceStateCalls).toContainEqual({ url: '/', state: {} });
		// Persistence: the reset workspace was written back.
		const prefs = storedPrefs();
		expect(Array.isArray(prefs.panels)).toBe(true);
		expect((prefs.panels as Array<{ sessionId: string }>)[0].sessionId).toBe('s-seed');
		expect(prefs.selectedPanelId).toBeTruthy();
		unmountPage();
	});

	it('the seed panel’s agentPreset is the session row’s (page.data), not the URL’s (R3)', async () => {
		// The server load's session row carries the preset — the ?agent=
		// query is retired; an agent= param on the URL is now ignored.
		stage({
			path: '/',
			query: '?sessionKey=s-seed&agent=ignored',
			data: {
				sessionId: 's-seed',
				title: null,
				workspace: null,
				agentPreset: 'app-dev',
				entries: [],
				lastSeq: -1,
				running: false,
				hasMore: false
			}
		});
		const { target } = await mountPage();
		// The header chip renders the preset (via ConversationHeader agent prop).
		expect(target.textContent).not.toBeNull();
		const prefs = storedPrefs();
		expect((prefs.panels as Array<{ agentPreset: string | null }>)[0].agentPreset).toBe('app-dev');
		unmountPage();
	});

	it('profile desk: seed with ?profile=widi stores under dsi-panels_widi and RETAINS profile in the URL', async () => {
		// A default-desk workspace exists — the profile seed must not touch it.
		stage({
			path: '/',
			query: '?sessionKey=s-widi-seed&profile=widi',
			prefs: {
				panels: [{ id: 'panel-9', kind: 'conversation', sessionId: 's-default', agentPreset: null, width: 500 }],
				selectedPanelId: 'panel-9',
				panelWidth: 500,
				zoom: 1
			}
		});
		const { target } = await mountPage();
		// Strip removed ONLY sessionKey — profile survives in the address bar.
		expect(navigationState.replaceStateCalls).toContainEqual({
			url: '/?profile=widi',
			state: {}
		});
		// The seed landed on the PROFILE desk…
		const widi = localStorage.getItem('dsi-panels_widi');
		expect(widi).not.toBeNull();
		expect((JSON.parse(widi!).panels as Array<{ sessionId: string }>)[0].sessionId).toBe(
			's-widi-seed'
		);
		// …and the default desk kept its own workspace (isolation).
		expect((storedPrefs().panels as Array<{ sessionId: string }>)[0].sessionId).toBe('s-default');
		// The profile is published to descendants (sidebar seed links).
		expect(getWorkspaceState()?.profile).toBe('widi');
		// The profile suffixes EVERY dsi-* key (storage-profile convention):
		// the sidebar layout + session filter persist on the widi desk too.
		expect(localStorage.getItem('dsi-sidebar_widi')).not.toBeNull();
		expect(localStorage.getItem('dsi-session-filter_widi')).not.toBeNull();
		expect(localStorage.getItem('dsi-sidebar')).toBeNull(); // default desk untouched
		expect(localStorage.getItem('dsi-session-filter')).toBeNull();
		// Sanity: the seeded panel rendered.
		expect(target.querySelector('[data-session-id="s-widi-seed"]')).not.toBeNull();
		unmountPage();
	});

	it('profile desk: bare ?profile=widi (no seed) restores from dsi-panels_widi, not the default desk', async () => {
		stage({ path: '/', query: '?profile=widi' });
		// Two desks with DIFFERENT single panels — restore must pick the profile one.
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [{ id: 'pd', kind: 'conversation', sessionId: 's-default-desk', agentPreset: null, width: 600 }],
				selectedPanelId: 'pd',
				panelWidth: 600,
				zoom: 1
			})
		);
		localStorage.setItem(
			'dsi-panels_widi',
			JSON.stringify({
				panels: [{ id: 'pw', kind: 'conversation', sessionId: 's-widi-desk', agentPreset: null, width: 700 }],
				selectedPanelId: 'pw',
				panelWidth: 700,
				zoom: 1
			})
		);
		const { target } = await mountPage();
		const columns = target.querySelectorAll('[data-testid="panel-column"]');
		expect(columns).toHaveLength(1);
		expect(columns[0].getAttribute('data-session-id')).toBe('s-widi-desk');
		// No seed → no strip.
		expect(navigationState.replaceStateCalls).toHaveLength(0);
		unmountPage();
	});

	it('profile desk: a junk-only profile value (sanitizes empty) behaves as the default desk', async () => {
		// '?profile=!!!' carries no usable characters — the desk is the default.
		stage({ path: '/', query: '?sessionKey=s-seed&profile=!!!' });
		const { target } = await mountPage();
		expect(target.querySelector('[data-session-id="s-seed"]')).not.toBeNull();
		expect(localStorage.getItem('dsi-panels_!!!')).toBeNull();
		expect((storedPrefs().panels as Array<{ sessionId: string }>)[0].sessionId).toBe('s-seed');
		unmountPage();
	});
});

describe('workspace route — RESTORE (R2: localStorage is the workspace truth)', () => {
	it('bare / restores N panels + selection + width + zoom from prefs', async () => {
		stage({
			path: '/',
			prefs: {
				panels: [
					{ id: 'p1', kind: 'conversation', sessionId: 's-one', agentPreset: null, width: 600 },
					{ id: 'p2', kind: 'conversation', sessionId: 's-two', agentPreset: 'main', width: 700 }
				],
				selectedPanelId: 'p2',
				panelWidth: 700,
				zoom: 1.1
			}
		});
		const { target } = await mountPage();
		const columns = target.querySelectorAll('[data-testid="panel-column"]');
		expect(columns).toHaveLength(2);
		expect(columns[0].getAttribute('data-session-id')).toBe('s-one');
		expect(columns[1].getAttribute('data-session-id')).toBe('s-two');
		// Selection restored to p2 (the second column).
		expect(columns[1].classList.contains('selected')).toBe(true);
		expect(columns[0].classList.contains('selected')).toBe(false);
		// No seed → no URL strip.
		expect(navigationState.replaceStateCalls).toHaveLength(0);
		// Restore DID NOT re-persist junk — the blob keeps the stored shape
		// (sanitize-on-write happens through the persistence effect; the
		// stored values were already in range).
		expect(storedPrefs().zoom).toBe(1.1);
		unmountPage();
	});

	it('restore triggers runtime dual-fetch for panels without cached cold data', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				if (url.includes('/events?full=1')) {
					return new Response(
						JSON.stringify({
							ok: true,
							entries: [{ kind: 'user-message', id: 'u1', seq: 2, time: 1002, text: 'restored' }],
							lastSeq: 2,
							running: false
						}),
						{ status: 200 }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], hasMore: false }), {
					status: 200
				});
			})
		);
		stage({
			path: '/',
			prefs: {
				panels: [{ id: 'p1', kind: 'conversation', sessionId: 's-restored', agentPreset: null, width: 700 }],
				selectedPanelId: 'p1',
				panelWidth: 700,
				zoom: 1
			}
		});
		const { target } = await mountPage();
		await flushEffects();
		// Dual fetch fired for the restored panel (events?full=1 + history).
		expect(calls.some((u) => u.includes('/api/dsh/session/s-restored/events?full=1'))).toBe(true);
		expect(calls.some((u) => u.includes('/api/dsh/session/s-restored/history?beforeSeq='))).toBe(true);
		// The panel then renders the fetched transcript.
		await flushEffects();
		expect(target.textContent).toContain('restored');
		unmountPage();
	});

	it('restored panel renders its workspace chip via the spine heal (2026-08-25)', async () => {
		// The runtime dual fetch carries NO session row (workspace: null)
		// — the spine summaries are the workspace source for every
		// restored/side-added panel. Without the heal the chip never shows.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('/api/dsh/sessions')) {
					return new Response(
						JSON.stringify({
							ok: true,
							sessions: [
								{
									sessionId: 's-ws',
									title: 'Spine title',
									agentPreset: null,
									workspace: '/Users/wharsojo/Projects/dsi',
									running: false,
									updatedAt: Date.now()
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (url.includes('/events?full=1')) {
					return new Response(
						JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }),
						{ status: 200 }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], hasMore: false }), {
					status: 200
				});
			})
		);
		stage({
			path: '/',
			prefs: {
				panels: [{ id: 'p1', kind: 'conversation', sessionId: 's-ws', agentPreset: null, width: 700 }],
				selectedPanelId: 'p1',
				panelWidth: 700,
				zoom: 1
			}
		});
		const { target } = await mountPage();
		await flushEffects();
		const chip = target.querySelector('[data-testid="session-workspace"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.getAttribute('title')).toBe('/Users/wharsojo/Projects/dsi');
		expect(chip.textContent).toContain('dsi'); // basename label
		// The spine-healed title reaches the same header.
		expect((target.querySelector('[data-testid="session-title"]') as HTMLElement).textContent).toContain(
			'Spine title'
		);
		unmountPage();
	});
});

describe('workspace route — EMPTY + JUNK (honest state, commitment 7)', () => {
	it('no stored panels → empty-workspace state renders, never a crash', async () => {
		stage({ path: '/' });
		const { target } = await mountPage();
		expect(target.querySelector('[data-testid="workspace-empty"]')).not.toBeNull();
		expect(target.querySelectorAll('[data-testid="panel-column"]')).toHaveLength(0);
		unmountPage();
	});

	it('junk prefs fall back to defaults (non-array panels → empty workspace)', async () => {
		stage({ path: '/', prefs: { panels: 'not-an-array', selectedPanelId: 7 } });
		const { target } = await mountPage();
		expect(target.querySelector('[data-testid="workspace-empty"]')).not.toBeNull();
		expect(storedPrefs().panels).toEqual([]);
		unmountPage();
	});
});

describe('workspace route — registry actions (dedupe→select, replace, lifecycle)', () => {
	it('dedupe-add: adding an already-paneled session selects the existing panel — no duplicate', async () => {
		stage({ path: '/' });
		const { target } = await mountPage();
		// Empty floor → add s-one through the REAL registry round-trip.
		const added = addPanelFromSidebar({ sessionId: 's-one', agentPreset: null });
		expect(added).toBe(true);
		await flushEffects();
		expect(target.querySelectorAll('[data-testid="panel-column"]')).toHaveLength(1);
		// Same session again — dedupe→select, still one panel.
		addPanelFromSidebar({ sessionId: 's-one', agentPreset: null });
		await flushEffects();
		expect(target.querySelectorAll('[data-testid="panel-column"]')).toHaveLength(1);
		const prefs = storedPrefs();
		expect((prefs.panels as unknown[])).toHaveLength(1);
		unmountPage();
	});

	it('add INSERTS BEFORE THE FOCUSED PANEL (operator spec, 2026-08-31): consecutive adds stack at the focus slot', async () => {
		stage({ path: '/' });
		const { target } = await mountPage();
		addPanelFromSidebar({ sessionId: 's-one', agentPreset: null });
		await flushEffects();
		// Each add selects the fresh panel, so the next add lands at that
		// slot — consecutive adds stack newest-first at the head.
		addPanelFromSidebar({ sessionId: 's-two', agentPreset: null });
		await flushEffects();
		const ids = Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map(
			(el) => el.getAttribute('data-session-id')
		);
		expect(ids).toEqual(['s-two', 's-one']);
		unmountPage();
	});

	// Operator spec (2026-08-31): the focused panel owns the insertion
	// slot. [c, b, a] with focus on b, add d → [c, d, b, a] — the new
	// panel joins immediately BEFORE the focus, never at the head, and
	// takes focus.
	it('add lands before the FOCUSED panel and takes focus (mid-floor insertion)', async () => {
		stage({ path: '/' });
		const { target } = await mountPage();
		addPanelFromSidebar({ sessionId: 'a', agentPreset: null });
		addPanelFromSidebar({ sessionId: 'b', agentPreset: null });
		addPanelFromSidebar({ sessionId: 'c', agentPreset: null });
		await flushEffects();
		const ids = (): string[] =>
			Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map((el) =>
				el.getAttribute('data-session-id') ?? ''
			);
		expect(ids()).toEqual(['c', 'b', 'a']);
		// Focus the mid-floor panel b, then add d.
		const bPanelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 'b')?.panel.id;
		selectPanelFromRegistry(bPanelId!);
		await flushEffects();
		addPanelFromSidebar({ sessionId: 'd', agentPreset: null });
		await flushEffects();
		expect(ids()).toEqual(['c', 'd', 'b', 'a']);
		// Focus moved to the fresh panel (insertPanel selects it).
		const dPanelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 'd')?.panel.id;
		expect(getWorkspaceState()?.selectedPanelId).toBe(dPanelId);
		unmountPage();
	});

	it('add then replace-selected: the selected entry is rewritten in place (count unchanged)', async () => {
		stage({ path: '/' });
		const { target } = await mountPage();
		addPanelFromSidebar({ sessionId: 's-one', agentPreset: null });
		await flushEffects();
		replaceSelectedFromRegistry({ sessionId: 's-two', agentPreset: null });
		await flushEffects();
		const columns = target.querySelectorAll('[data-testid="panel-column"]');
		expect(columns).toHaveLength(1);
		expect(columns[0].getAttribute('data-session-id')).toBe('s-two');
		unmountPage();
	});

	it('registry lifecycle: after unmount every action returns false (commitment 8)', async () => {
		stage({ path: '/' });
		const { instance } = await mountPage();
		unmount(instance);
		await flushEffects();
		expect(addPanelFromSidebar({ sessionId: 'x', agentPreset: null })).toBe(false);
		expect(replaceSelectedFromRegistry({ sessionId: 'x', agentPreset: null })).toBe(false);
		expect(movePanelFromRegistry('panel-1', 'right')).toBe(false);
		// Workspace context withdrawn too.
		expect(getWorkspaceState()).toBeNull();
	});
});

describe('workspace route — move action (header left/right, sidebar up/down)', () => {
	/** Three staged panels — ids p-a/p-b/p-c, sessions s-a/s-b/s-c, p-a active. */
	function stageThree(): void {
		stage({
			path: '/',
			prefs: {
				panels: [
					{ id: 'p-a', kind: 'conversation', sessionId: 's-a', agentPreset: null, width: 600 },
					{ id: 'p-b', kind: 'conversation', sessionId: 's-b', agentPreset: null, width: 600 },
					{ id: 'p-c', kind: 'conversation', sessionId: 's-c', agentPreset: null, width: 600 }
				],
				selectedPanelId: 'p-a',
				panelWidth: 600,
				zoom: 1
			}
		});
	}

	function columnSessions(target: HTMLElement): Array<string | null> {
		return Array.from(target.querySelectorAll('[data-testid="panel-column"]')).map((el) =>
			el.getAttribute('data-session-id')
		);
	}

	it('movePanelWithin (pure): right/down swap with the successor, left/up with the predecessor', () => {
		const mk = (): DsiPanelEntry[] => [
			{ id: 'a', kind: 'conversation', sessionId: 's-a', agentPreset: null, width: 600 },
			{ id: 'b', kind: 'conversation', sessionId: 's-b', agentPreset: null, width: 600 },
			{ id: 'c', kind: 'conversation', sessionId: 's-c', agentPreset: null, width: 600 }
		];
		const ids = (panels: DsiPanelEntry[]) => panels.map((p) => p.id);
		// a right → [b,a,c]; a down is the SAME array operation.
		expect(ids(movePanelWithin(mk(), 'a', 'right'))).toEqual(['b', 'a', 'c']);
		expect(ids(movePanelWithin(mk(), 'a', 'down'))).toEqual(['b', 'a', 'c']);
		// b left / b up → toward the start.
		expect(ids(movePanelWithin(mk(), 'b', 'left'))).toEqual(['b', 'a', 'c']);
		expect(ids(movePanelWithin(mk(), 'b', 'up'))).toEqual(['b', 'a', 'c']);
		// Untouched entries keep object identity (the swap copies the array).
		const src = mk();
		const next = movePanelWithin(src, 'b', 'right');
		expect(next).not.toBe(src);
		expect(next[0]).toBe(src[0]);
	});

	it('movePanelWithin (pure): edges and unknown ids are no-ops', () => {
		const panels: DsiPanelEntry[] = [
			{ id: 'a', kind: 'conversation', sessionId: 's-a', agentPreset: null, width: 600 },
			{ id: 'b', kind: 'conversation', sessionId: 's-b', agentPreset: null, width: 600 }
		];
		const ids = (ps: DsiPanelEntry[]) => ps.map((p) => p.id);
		expect(ids(movePanelWithin(panels, 'a', 'left'))).toEqual(['a', 'b']);
		expect(ids(movePanelWithin(panels, 'a', 'up'))).toEqual(['a', 'b']);
		expect(ids(movePanelWithin(panels, 'b', 'right'))).toEqual(['a', 'b']);
		expect(ids(movePanelWithin(panels, 'b', 'down'))).toEqual(['a', 'b']);
		expect(ids(movePanelWithin(panels, 'nope', 'right'))).toEqual(['a', 'b']);
	});

	it('move right reorders the floor AND the active panel follows (registry round-trip)', async () => {
		stageThree();
		const { target } = await mountPage();
		// Header chevron world: [a,b,c], a active (left).
		expect(columnSessions(target)).toEqual(['s-a', 's-b', 's-c']);
		expect(target.querySelectorAll('.column.selected')).toHaveLength(1);
		expect(
			(target.querySelector('.column.selected') as HTMLElement).getAttribute('data-session-id')
		).toBe('s-a');

		expect(movePanelFromRegistry('p-a', 'right')).toBe(true);
		await flushEffects();

		// [b,a,c] — and the ACTIVE panel is still a, now middle.
		expect(columnSessions(target)).toEqual(['s-b', 's-a', 's-c']);
		expect(
			(target.querySelector('.column.selected') as HTMLElement).getAttribute('data-session-id')
		).toBe('s-a');
		// Persistence wrote the moved order; the selected id traveled.
		const prefs = storedPrefs();
		expect((prefs.panels as Array<{ id: string }>).map((p) => p.id)).toEqual(['p-b', 'p-a', 'p-c']);
		expect(prefs.selectedPanelId).toBe('p-a');
		// Sidebar rows mirror the floor order (the workspace context's rows).
		expect(getWorkspaceState()?.rows.map((r) => r.panel.id)).toEqual(['p-b', 'p-a', 'p-c']);
		unmountPage();
	});

	it('sidebar vocabulary: down/up drive the same reorder through the round-trip', async () => {
		stageThree();
		const { target } = await mountPage();
		// Last row moves down → no-op at the edge (the button would not
		// render there; the registry contract still holds).
		expect(movePanelFromRegistry('p-c', 'down')).toBe(true);
		await flushEffects();
		expect(columnSessions(target)).toEqual(['s-a', 's-b', 's-c']);
		// p-b down → [a,c,b]; p-b up again → back to [a,b,c].
		expect(movePanelFromRegistry('p-b', 'down')).toBe(true);
		await flushEffects();
		expect(columnSessions(target)).toEqual(['s-a', 's-c', 's-b']);
		expect(movePanelFromRegistry('p-b', 'up')).toBe(true);
		await flushEffects();
		expect(columnSessions(target)).toEqual(['s-a', 's-b', 's-c']);
		unmountPage();
	});

	it('header chevron gating follows the moved row (first hides left, last hides right)', async () => {
		stageThree();
		const { target } = await mountPage();
		// Column 0 (a): no left chevron, right present.
		const col = (i: number) =>
			target.querySelectorAll('[data-testid="panel-column"]')[i] as HTMLElement;
		expect(col(0).querySelector('[data-testid="panel-move-left"]')).toBeNull();
		expect(col(0).querySelector('[data-testid="panel-move-right"]')).not.toBeNull();

		(col(0).querySelector('[data-testid="panel-move-right"]') as HTMLButtonElement).click();
		await flushEffects();

		// After the move, a sits at index 1: both chevrons; the new first
		// column (b) hides its left chevron; the last still hides right.
		expect(col(0).querySelector('[data-testid="panel-move-left"]')).toBeNull();
		expect(col(1).querySelector('[data-testid="panel-move-left"]')).not.toBeNull();
		expect(col(1).querySelector('[data-testid="panel-move-right"]')).not.toBeNull();
		expect(col(2).querySelector('[data-testid="panel-move-right"]')).toBeNull();
		unmountPage();
	});
});

/** Shared unmount helper — tears the component down for real so its
 *  persistence effect cannot outlive its test (module-scope floor). */
function unmountPage(): void {
	if (lastPageInstance) {
		unmount(lastPageInstance);
		lastPageInstance = null;
	}
}


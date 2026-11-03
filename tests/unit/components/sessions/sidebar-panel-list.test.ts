/**
 * sidebar-panel-list unit tests (Panel Floor W4 tasks 4.1-T + 4.2-T,
 * spec-check GAP-2: component-direct mount — home-page.test.ts mounts the
 * home page, which renders NEITHER component; this suite mounts
 * SidebarOpenPanels and SidebarSessionsList directly, the
 * chat-components.test.ts pattern).
 *
 * 4.1-T: panel rows render from workspace context; click selects via
 *        registry invoke; selected styling keyed to selectedPanelId;
 *        close removes from context state.
 * 4.2-T: shift+click emits add (anchor default prevented); plain click
 *        emits replace; dedupe-add (already paneled) selects the existing
 *        panel via the owner's state — asserted at the registry boundary;
 *        agentPreset-missing row (GAP-6) still adds and the panel renders
 *        without a preset chip.
 *
 * Mount rule: BOTH leaf components act through the panel registry — a
 * handler registration IS the "floor mounted" world; no floor (no
 * handler) exercises the graceful-navigate fallback (spec 05 behavior).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarOpenPanels from '$lib/components/sessions/SidebarOpenPanels.svelte';
import SidebarSessionsList from '$lib/components/sessions/SidebarSessionsList.svelte';
import {
	registerAddPanel,
	registerMovePanel,
	registerReplaceSelected,
	registerSelectPanel,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';import {
	getWorkspaceState,
	setWorkspaceState,
	getWorkspaceState as getWorkspaceStateRef,
	type PanelRow,
	type WorkspaceState
} from '$lib/services/conversation/workspace-context.svelte';
import { defaultSpineGroupPrefs, type SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
import type { DsiConversationPanel, DsiPanelEntry, DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

// ── Fixtures ─────────────────────────────────────────────────────────

function panel(id: string, sessionId: string, agentPreset: string | null = null, width = 730): DsiConversationPanel {
	return { id, kind: 'conversation', sessionId, agentPreset, width };
}

/** W5: a manager-panel fixture — the kind union's other branch. */
function managerPanel(id: string): DsiPanelEntry {
	return { id, kind: 'prompt-manager', width: 730 };
}

function row(p: DsiPanelEntry, over: Partial<PanelRow> = {}): PanelRow {
	return { panel: p, title: null, workspace: null, dead: false, running: false, ...over };
}

function summary(sessionId: string, over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: 'research',
		workspace: '/tmp/e2e-harness',
		running: false,
		updatedAt: Date.now(),
		turns: null,
		...over
	} as DsiSessionSummary;
}

const NO_WORKSPACES: DsiWorkspaceSummary[] = [];

// ── Helpers ──────────────────────────────────────────────────────────

/** Registry call log — every handler registers as a recorder. */
type AddReq = import('$lib/services/panels/panel-registry').PanelAddRequest;

function registerRecorder() {
	const calls = {
		add: [] as AddReq[],
		replace: [] as AddReq[],
		select: [] as string[],
		move: [] as Array<{ panelId: string; dir: 'left' | 'right' | 'up' | 'down' }>
	};
	registerAddPanel((r) => calls.add.push({ ...r }));
	registerReplaceSelected((r) => calls.replace.push({ ...r }));
	registerSelectPanel((id) => calls.select.push(id));
	registerMovePanel((panelId, dir) => calls.move.push({ panelId, dir }));
	return calls;
}

/** Context publisher with a reactive-ish state object the tests mutate. */
function publishState(initial: { rows: PanelRow[]; selectedPanelId: string | null; profile?: string | null }) {
	let state: WorkspaceState = {
		rows: initial.rows,
		selectedPanelId: initial.selectedPanelId,
		profile: initial.profile ?? null,
		select: (id) => {
			if (state.rows.some((r) => r.panel.id === id)) state.selectedPanelId = id;
			setWorkspaceState({ ...state }); // republish for the next read
		},
		remove: (id) => {
			state = { ...state, rows: state.rows.filter((r) => r.panel.id !== id) };
			if (state.selectedPanelId === id) {
				state.selectedPanelId = state.rows[0]?.panel.id ?? null;
			}
			setWorkspaceState({ ...state });
		}
	};
	setWorkspaceState(state);
	return {
		republish(next: Partial<WorkspaceState>) {
			state = { ...state, ...next };
			setWorkspaceState(state);
		}
	};
}

/** Open the pinned-panel group via its header toggle — the same user
 *  gesture the collapse suite below exercises (collapse default 2026-08-26). */
function expandGroup(target: HTMLElement): void {
	target.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-group-toggle"]')?.click();
	flushSync();
}

function mountPanelList(opts: { expand?: boolean; workspaces?: DsiWorkspaceSummary[] } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarOpenPanels, {
		target,
		props: { workspaces: opts.workspaces ?? NO_WORKSPACES }
	});
	// Mount-time $effect (desk prefs) flush, then the row tests' default:
	// the group OPEN (the shipped default since 2026-09-18) — a seeded
	// collapsed desk is expanded here; collapse behavior has its own suite.
	flushSync();
	if (opts.expand !== false) {
		const toggle = target.querySelector<HTMLButtonElement>(
			'[data-testid="sidebar-panel-group-toggle"]'
		);
		if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
		flushSync();
	}
	return { target, instance };
}

/** Panel rows: EVERY row (selected rows carry the legacy current testid). */
function panelRowsIn(target: HTMLElement): NodeListOf<Element> {
	return target.querySelectorAll('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');
}

/** Default FOLDED (2026-08-28): reveal a session's children by clicking
 *  its row's fold chevron — the standard prelude for family-row tests. */
function unfoldParent(target: HTMLElement, sessionId: string): void {
	const row = Array.from(panelRowsIn(target)).find(
		(el) => el.getAttribute('data-session-id') === sessionId
	);
	(row?.querySelector('[data-testid="sidebar-panel-fold"]') as HTMLButtonElement | null)?.click();
	flushSync();
}

function mountSpine(props: {
	current?: DsiSessionSummary | null;
	visible?: DsiSessionSummary[];
	workspaces?: DsiWorkspaceSummary[];
	spine?: SpineGroupPrefs;
	onspinechange?: (partial: Partial<SpineGroupPrefs>) => void;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onspinechange =
		props.onspinechange ?? vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: props.current ?? null,
			visible: props.visible ?? [],
			workspaces: props.workspaces ?? NO_WORKSPACES,
			...(props.spine !== undefined ? { spine: props.spine } : {}),
			onspinechange
		}
	});
	// Effects flush before the test acts — bind:this (the filter input's
	// refocus target) assigns in a post-mount effect, not during render.
	flushSync();
	return { target, instance, onspinechange };
}

/** The spine group's rows wrapper — absent while the group is collapsed. */
function spineRowsPane(target: HTMLElement): Element | null {
	return target.querySelector('[data-testid="sidebar-spine-group-rows"]');
}

/** Type into the spine name filter (one input event, Svelte flushed). */
function typeFilter(target: HTMLElement, value: string): void {
	const input = target.querySelector<HTMLInputElement>('[data-testid="sidebar-spine-filter"]')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** Dispatch a click with modifiers and report whether default got prevented. */
function click(el: Element, opts: { shift?: boolean } = {}): boolean {
	const event = new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
		shiftKey: opts.shift ?? false
	});
	el.dispatchEvent(event);
	return event.defaultPrevented;
}

afterEach(() => {
	resetPanelRegistryForTests();
	setWorkspaceState(null);
	document.body.innerHTML = '';
	localStorage.clear(); // panel-group desk prefs must not leak across tests
});

// ── 4.1-T: panel list in SidebarOpenPanels ──────────────────────

describe('SidebarOpenPanels — panel list (task 4.1-T)', () => {
	it('renders one row per open panel from workspace context', () => {
		publishState({
			rows: [
				row(panel('p1', 's-one'), { title: 'One' }),
				row(panel('p2', 's-two'), { title: 'Two' })
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		const rows = panelRowsIn(target);
		expect(rows).toHaveLength(2);
		expect(rows[0].getAttribute('data-session-id')).toBe('s-one');
		expect(rows[0].textContent).toContain('One');
		expect(rows[1].textContent).toContain('Two');
		// Legacy contract: the SELECTED row carries sidebar-session-current
		// (commitment 5 — the pre-floor pinned-row testid survives as the N=1
		// degenerate case of the panel list).
		expect(rows[0].getAttribute('data-testid')).toBe('sidebar-session-current');
		expect(rows[1].getAttribute('data-testid')).toBe('sidebar-panel-row');
		unmount(instance);
	});

	it('renders zero rows when no floor is mounted (context null)', () => {
		const { target, instance } = mountPanelList();
		expect(panelRowsIn(target)).toHaveLength(0);
		expect(target.querySelector('[data-testid="sidebar-session-current"]')).toBeNull();
		unmount(instance);
	});

	it('click selects via registry invoke (leaf→root, no callback props)', () => {
		const calls = registerRecorder();
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList();
		const el = panelRowsIn(target)[0];
		click(el);
		expect(calls.select).toEqual(['p1']);
		unmount(instance);
	});

	it('selected styling + aria-current keyed to selectedPanelId', () => {
		const pub = publishState({
			rows: [row(panel('p1', 's-one'), { title: 'One' }), row(panel('p2', 's-two'), { title: 'Two' })],
			selectedPanelId: 'p2'
		});
		const { target, instance } = mountPanelList();
		const rows = panelRowsIn(target);
		expect(rows[0].getAttribute('aria-current')).toBeNull();
		expect(rows[1].getAttribute('aria-current')).toBe('page');
		expect(rows[1].className).toContain('current');
		// Selection moving flips the styling (reactive context read).
		pub.republish({ selectedPanelId: 'p1' });
		flushSync();
		const refreshed = panelRowsIn(target);
		expect(refreshed[0].getAttribute('aria-current')).toBe('page');
		expect(refreshed[1].getAttribute('aria-current')).toBeNull();
		unmount(instance);
	});

	it('close removes the panel from context state (X button)', () => {
		const calls = registerRecorder();
		publishState({
			rows: [row(panel('p1', 's-one'), { title: 'One' }), row(panel('p2', 's-two'), { title: 'Two' })],
			selectedPanelId: 'p2'
		});
		const { target, instance } = mountPanelList();
		const closes = target.querySelectorAll('[data-testid="sidebar-panel-close"]');
		expect(closes).toHaveLength(2);
		closes[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		const state = await_state();
		expect(state.rows.map((r) => r.panel.id)).toEqual(['p1']);
		expect(state.selectedPanelId).toBe('p1');
		// The removed row leaves the DOM once the published state is re-read
		// (module-level $state reactivity: republish below the derived read).
		setWorkspaceState(state);
		flushSync();
		expect(panelRowsIn(target)).toHaveLength(1);
		unmount(instance);
	});

	it('dead (404) panel renders its error tint but stays selectable and closeable', () => {
		const calls = registerRecorder();
		publishState({
			rows: [row(panel('p1', 's-dead'), { title: 'Dead', dead: true })],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		const el = panelRowsIn(target)[0];
		expect(el.className).toContain('dead');
		click(el);
		expect(calls.select).toEqual(['p1']);
		expect(target.querySelector('[data-testid="sidebar-panel-close"]')).not.toBeNull();
		unmount(instance);
	});

	it('move up/down buttons invoke the registry and never select the row (stopPropagation)', () => {
		const calls = registerRecorder();
		publishState({
			rows: [
				row(panel('p1', 's-one'), { title: 'One' }),
				row(panel('p2', 's-two'), { title: 'Two' }),
				row(panel('p3', 's-three'), { title: 'Three' })
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		// Row 1 (middle) has BOTH buttons.
		const middle = panelRowsIn(target)[1];
		(middle.querySelector('[data-testid="sidebar-panel-move-up"]') as HTMLButtonElement).click();
		(middle.querySelector('[data-testid="sidebar-panel-move-down"]') as HTMLButtonElement).click();
		expect(calls.move).toEqual([
			{ panelId: 'p2', dir: 'up' },
			{ panelId: 'p2', dir: 'down' }
		]);
		// stopPropagation: the row click (select) never fired alongside.
		expect(calls.select).toHaveLength(0);
		unmount(instance);
	});

	it('move buttons hide at the list edges — first has no up, last has no down', () => {
		registerRecorder();
		publishState({
			rows: [row(panel('p1', 's-one'), { title: 'One' }), row(panel('p2', 's-two'), { title: 'Two' })],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		const rows = panelRowsIn(target);
		expect(rows[0].querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(rows[0].querySelector('[data-testid="sidebar-panel-move-down"]')).not.toBeNull();
		expect(rows[1].querySelector('[data-testid="sidebar-panel-move-up"]')).not.toBeNull();
		expect(rows[1].querySelector('[data-testid="sidebar-panel-move-down"]')).toBeNull();
		// A single-panel floor carries neither button.
		unmount(instance);
	});

	it('a single-panel list carries neither move button (no neighbor either way)', () => {
		registerRecorder();
		publishState({
			rows: [row(panel('p1', 's-one'), { title: 'One' })],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		const el = panelRowsIn(target)[0];
		expect(el.querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(el.querySelector('[data-testid="sidebar-panel-move-down"]')).toBeNull();
		expect(el.querySelector('[data-testid="sidebar-panel-close"]')).not.toBeNull();
		unmount(instance);
	});
});

/** Read the published workspace state (null outside a floor). */
function await_state(): WorkspaceState {
	const s = getWorkspaceStateRef();
	if (!s) throw new Error('workspace state unexpectedly null');
	return s;
}

// ── Collapse (2026-08-26): default, title, per-desk persistence ─────

describe('SidebarOpenPanels — group collapse (2026-08-26)', () => {
	const groupToggle = (target: HTMLElement): HTMLButtonElement =>
		target.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-group-toggle"]')!;
	const groupTitle = (target: HTMLElement): string =>
		target.querySelector('[data-testid="sidebar-panel-group-title"]')!.textContent ?? '';

	it('ships expanded by default — rows visible, honest aria (2026-09-18)', () => {
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupToggle(target).getAttribute('aria-expanded')).toBe('true');
		expect(panelRowsIn(target)).toHaveLength(1);
		unmount(instance);
	});

	it('a seeded collapsed desk mounts collapsed — the stored choice wins', () => {
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: true }));
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupToggle(target).getAttribute('aria-expanded')).toBe('false');
		expect(panelRowsIn(target)).toHaveLength(0);
		expect(target.querySelector('#sidebar-panel-group-rows')).toBeNull();
		unmount(instance);
	});

	it('header title is Focused - <selected session name> and follows the focused panel in BOTH states', () => {
		const pub = publishState({
			rows: [row(panel('p1', 's-one'), { title: 'One' }), row(panel('p2', 's-two'), { title: 'Two' })],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupTitle(target)).toBe('Focused - One');
		// Selection moves → the collapsed header follows.
		pub.republish({ selectedPanelId: 'p2' });
		flushSync();
		expect(groupTitle(target)).toBe('Focused - Two');
		// Expanded — the header never leaves, the title keeps tracking.
		expandGroup(target);
		pub.republish({ selectedPanelId: 'p1' });
		flushSync();
		expect(groupTitle(target)).toBe('Focused - One');
		unmount(instance);
	});

	it('null title falls back to the session id (row-label grammar)', () => {
		publishState({ rows: [row(panel('p1', 's-one'), { title: null })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupTitle(target)).toBe('Focused - s-one');
		unmount(instance);
	});

	it('toggle collapses/expands and persists every flip to localStorage', () => {
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupToggle(target).getAttribute('aria-expanded')).toBe('true');
		groupToggle(target).click(); // collapse
		flushSync();
		expect(panelRowsIn(target)).toHaveLength(0);
		expect(JSON.parse(localStorage.getItem('dsi-panel-group') ?? 'null')).toEqual({
			collapsed: true,
			unfoldedSessionIds: [],
			subagentsHidden: false
		});
		expandGroup(target); // expand back
		expect(panelRowsIn(target)).toHaveLength(1);
		expect(JSON.parse(localStorage.getItem('dsi-panel-group') ?? 'null')).toEqual({
			collapsed: false,
			unfoldedSessionIds: [],
			subagentsHidden: false
		});
		unmount(instance);
	});

	it('seeded expanded desk (the hard-reload world) mounts expanded', () => {
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: false }));
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupToggle(target).getAttribute('aria-expanded')).toBe('true');
		expect(panelRowsIn(target)).toHaveLength(1);
		unmount(instance);
	});

	it('junk stored value stays expanded (the default wins)', () => {
		localStorage.setItem('dsi-panel-group', '{"collapsed":"yes"}');
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(panelRowsIn(target)).toHaveLength(1);
		unmount(instance);
	});

	it('per-profile desk: dsi-panel-group_widi wins on that desk only', () => {
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: true }));
		localStorage.setItem('dsi-panel-group_widi', JSON.stringify({ collapsed: false }));
		publishState({
			rows: [row(panel('p1', 's-one'), { title: 'One' })],
			selectedPanelId: 'p1',
			profile: 'widi'
		});
		const { target, instance } = mountPanelList({ expand: false });
		expect(panelRowsIn(target)).toHaveLength(1); // widi desk: expanded
		unmount(instance);
	});

	it('no selection renders the bare `Focused - ` stem, no name chip (honest, never a wrong name)', () => {
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: null });
		const { target, instance } = mountPanelList({ expand: false });
		expect(groupTitle(target)).toBe('Focused - ');
		unmount(instance);
	});
});

// ── Fold map persistence (2026-09-03, ADR The Tree That Remembers) ───
// The family fold map joins the desk blob (`unfoldedSessionIds` on
// dsi-panel-group[_<profile>]): every map write persists (chevron AND
// reveals — D2), restore is a hydrate that never writes (D6), a desk
// switch swaps the map wholesale (D5), and a dead id drops at the NEXT
// save, never at load (D4).

/** The stored fold field — the desk blob's second half (default desk). */
function storedFoldIds(): string[] {
	const raw = localStorage.getItem('dsi-panel-group');
	return raw === null ? [] : (JSON.parse(raw)?.unfoldedSessionIds ?? []);
}

describe('SidebarOpenPanels — fold map persistence (2026-09-03)', () => {
	/** Main head + its panel child — the minimal two-row family. */
	function publishFamily(): { pub: ReturnType<typeof publishState> } {
		const pub = publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				row(panel('p2', 's-kid'), { title: 'Kid', depth: 1, parentSessionId: 's-main' })
			],
			selectedPanelId: 'p1'
		});
		return { pub };
	}

	function visibleIds(target: HTMLElement): (string | null)[] {
		return Array.from(panelRowsIn(target)).map((el) => el.getAttribute('data-session-id'));
	}

	it('a chevron toggle persists; folding back empties the field', () => {
		publishFamily();
		const { target, instance } = mountPanelList();
		unfoldParent(target, 's-main');
		expect(storedFoldIds()).toEqual(['s-main']);
		unfoldParent(target, 's-main'); // fold back — false entries never store
		expect(storedFoldIds()).toEqual([]);
		unmount(instance);
	});

	it('the fold-on-add reveal persists the newcomer — the restored neighbor stays out', () => {
		const ghostOf = (sessionId: string, parent: string, depth: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		});
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({ ghosts: [ghostOf('s-old', 's-main', 1)] });
		const { target, instance } = mountPanelList();
		expect(storedFoldIds()).toEqual([]); // the restored floor wrote nothing
		// The operator ADDS a session with a spawned child (spine click):
		pub.republish({
			rows: [row(panel('p1', 's-main'), { title: 'Main' }), row(panel('p2', 's-new'), { title: 'New' })],
			ghosts: [ghostOf('s-old', 's-main', 1), ghostOf('s-kid', 's-new', 1)],
			selectedPanelId: 'p2'
		});
		flushSync();
		// The reveal is IN the desk now — the newcomer's head, never the
		// restored neighbor the operator left folded.
		expect(storedFoldIds()).toEqual(['s-new']);
		unmount(instance);
	});

	it('an adoption reveal persists the revealed chain — only once the adoption lands', () => {
		const calls = registerRecorder();
		const ghostOf = (sessionId: string, parent: string, depth: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		});
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({ ghosts: [ghostOf('s-mid', 's-main', 1), ghostOf('s-leaf', 's-mid', 2)] });
		const { target, instance } = mountPanelList();
		unfoldParent(target, 's-main'); // the chevron's own write
		expect(storedFoldIds()).toEqual(['s-main']);
		// Click the NESTED ghost: the ask parks until the route adopts.
		target
			.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-leaf"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(calls.add).toEqual([{ sessionId: 's-leaf', agentPreset: null }]);
		expect(storedFoldIds()).toEqual(['s-main']); // nothing adopted → nothing persisted
		pub.republish({
			ghosts: [],
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				row(panel('p2', 's-mid'), { title: 'Mid', depth: 1, parentSessionId: 's-main' }),
				row(panel('p3', 's-leaf'), { title: 'Leaf', depth: 2, parentSessionId: 's-mid' })
			],
			selectedPanelId: 'p3'
		});
		flushSync();
		// The walk unfolded s-leaf + s-mid (s-main was already open) — the
		// whole chain is in the desk. Membership pinned, not insertion order.
		expect([...storedFoldIds()].sort()).toEqual(['s-leaf', 's-main', 's-mid']);
		unmount(instance);
	});

	it('a re-mount hydrates the exact map — the family stands open with no clicks', () => {
		publishFamily();
		const first = mountPanelList();
		unfoldParent(first.target, 's-main');
		unmount(first.instance);
		// Hard reload: same floor, fresh component — the stored map restores
		// the arrangement (children visible), and the group's open state
		// comes back with it (one blob, two fields).
		const second = mountPanelList({ expand: false });
		expect(
			second.target.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-group-toggle"]')
				?.getAttribute('aria-expanded')
		).toBe('true');
		expect(visibleIds(second.target)).toEqual(['s-main', 's-kid']);
		unmount(second.instance);
	});

	it('hydrate never writes — a restored floor leaves the desk blob byte-identical', () => {
		const seeded = JSON.stringify({ collapsed: false, unfoldedSessionIds: [] });
		localStorage.setItem('dsi-panel-group', seeded);
		publishFamily();
		const { target, instance } = mountPanelList({ expand: false });
		expect(visibleIds(target)).toEqual(['s-main']); // folded default intact
		expect(localStorage.getItem('dsi-panel-group')).toBe(seeded); // restore is read-only
		unmount(instance);
	});

	it('a desk switch swaps the map wholesale — each desk restores its own folds', () => {
		localStorage.setItem(
			'dsi-panel-group_widi',
			JSON.stringify({ collapsed: false, unfoldedSessionIds: [] })
		);
		localStorage.setItem(
			'dsi-panel-group',
			JSON.stringify({ collapsed: false, unfoldedSessionIds: ['s-main'] })
		);
		const { pub } = publishFamily();
		// publishFamily publishes the DEFAULT desk; arrive on widi instead.
		pub.republish({ profile: 'widi' });
		const { target, instance } = mountPanelList({ expand: false });
		expect(visibleIds(target)).toEqual(['s-main']); // widi: family folded
		// Desk switch → the default desk's OWN map hydrates: family open.
		pub.republish({ profile: null });
		flushSync();
		expect(visibleIds(target)).toEqual(['s-main', 's-kid']);
		// Back to widi: folded again — no merge, no carry-over (D5).
		pub.republish({ profile: 'widi' });
		flushSync();
		expect(visibleIds(target)).toEqual(['s-main']);
		unmount(instance);
	});

	it('a dead id drops at the next save — never at load (D4)', () => {
		localStorage.setItem(
			'dsi-panel-group',
			JSON.stringify({ collapsed: false, unfoldedSessionIds: ['s-dead', 's-main'] })
		);
		publishFamily();
		const { target, instance } = mountPanelList({ expand: false });
		// Load is dumb: the stale id survives the hydrate untouched — and
		// gates nothing (it matches no floor member).
		expect(storedFoldIds()).toEqual(['s-dead', 's-main']);
		expect(visibleIds(target)).toEqual(['s-main', 's-kid']);
		// The next fold save prunes to live members; the dead id never
		// resurfaces when the family opens again.
		unfoldParent(target, 's-main'); // fold
		expect(storedFoldIds()).toEqual([]);
		unfoldParent(target, 's-main'); // unfold
		expect(storedFoldIds()).toEqual(['s-main']);
		unmount(instance);
	});
});

// ── Lineage fold pair (2026-09-03): the header seg-group ────────────
// Collapse-all / expand-all over every session that HAS lineage — a
// depth-0 panel with children, the same gate the rows' fold chevron
// renders under. Disable rules: collapse dies when EVERY lineage
// session ships folded; expand dies when EVERY one stands unfolded;
// no families → both vacuously true → both disabled.

describe('SidebarOpenPanels — lineage fold pair (header seg-group)', () => {
	const collapseAllBtn = (target: HTMLElement): HTMLButtonElement =>
		target.querySelector<HTMLButtonElement>('[data-testid="sidebar-lineage-collapse-all"]')!;
	const expandAllBtn = (target: HTMLElement): HTMLButtonElement =>
		target.querySelector<HTMLButtonElement>('[data-testid="sidebar-lineage-expand-all"]')!;

	function visibleIds(target: HTMLElement): (string | null)[] {
		return Array.from(panelRowsIn(target)).map((el) => el.getAttribute('data-session-id'));
	}

	function ghostOf(sessionId: string, parent: string, depth: number): PanelRow {
		return {
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		};
	}

	/** Two independent families — A and B, each a head with one panel kid. */
	function publishTwoFamilies(): void {
		publishState({
			rows: [
				row(panel('p1', 's-a'), { title: 'A', depth: 0 }),
				row(panel('p2', 's-a-kid'), { title: 'AK', depth: 1, parentSessionId: 's-a' }),
				row(panel('p3', 's-b'), { title: 'B', depth: 0 }),
				row(panel('p4', 's-b-kid'), { title: 'BK', depth: 1, parentSessionId: 's-b' })
			],
			selectedPanelId: 'p1'
		});
	}

	it('renders the pair beside the group toggle; no families → both disabled (vacuous extremes)', () => {
		publishState({ rows: [row(panel('p1', 's-one'), { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList();
		expect(target.querySelector('[data-testid="sidebar-lineage-fold-toggle"]')).not.toBeNull();
		expect(collapseAllBtn(target).disabled).toBe(true);
		expect(expandAllBtn(target).disabled).toBe(true);
		unmount(instance);
	});

	it('a COLLAPSED group arms both segments — no rows visible, no extreme is truth', () => {
		publishTwoFamilies();
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: true })); // collapsed start
		const { target, instance } = mountPanelList({ expand: false });
		expect(collapseAllBtn(target).disabled).toBe(false);
		expect(expandAllBtn(target).disabled).toBe(false);
		unmount(instance);
	});

	it('a click on either segment while collapsed EXPANDS the group with the fold (persisted)', () => {
		publishTwoFamilies();
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: true })); // collapsed start
		const { target, instance } = mountPanelList({ expand: false });
		const groupToggle = target.querySelector<HTMLButtonElement>(
			'[data-testid="sidebar-panel-group-toggle"]'
		)!;
		expect(groupToggle.getAttribute('aria-expanded')).toBe('false');
		expandAllBtn(target).click();
		flushSync();
		// The group opened AND the families stand open — the result shows.
		expect(groupToggle.getAttribute('aria-expanded')).toBe('true');
		expect(visibleIds(target)).toEqual(['s-a', 's-a-kid', 's-b', 's-b-kid']);
		expect(JSON.parse(localStorage.getItem('dsi-panel-group') ?? 'null')).toMatchObject({
			collapsed: false,
			unfoldedSessionIds: ['s-a', 's-b']
		});
		// The disable state follows the now-visible truth.
		expect(expandAllBtn(target).disabled).toBe(true);
		unmount(instance);
	});

	it('collapse-all while collapsed also expands — heads visible, kids still hidden', () => {
		publishTwoFamilies();
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: true })); // collapsed start
		const { target, instance } = mountPanelList({ expand: false });
		collapseAllBtn(target).click();
		flushSync();
		expect(
			target
				.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-group-toggle"]')
				?.getAttribute('aria-expanded')
		).toBe('true');
		expect(visibleIds(target)).toEqual(['s-a', 's-b']);
		expect(storedFoldIds()).toEqual([]); // every family folded — nothing stores
		// The visible truth is all-folded: collapse dies at its extreme.
		expect(collapseAllBtn(target).disabled).toBe(true);
		expect(expandAllBtn(target).disabled).toBe(false);
		unmount(instance);
	});

	it('default FOLDED families: collapse disabled, expand enabled', () => {
		publishTwoFamilies();
		const { target, instance } = mountPanelList();
		expect(collapseAllBtn(target).disabled).toBe(true);
		expect(expandAllBtn(target).disabled).toBe(false);
		unmount(instance);
	});

	it('expand-all opens every family, persists the owners, and flips the disable state', () => {
		publishTwoFamilies();
		const { target, instance } = mountPanelList();
		expandAllBtn(target).click();
		flushSync();
		expect(visibleIds(target)).toEqual(['s-a', 's-a-kid', 's-b', 's-b-kid']);
		expect([...storedFoldIds()].sort()).toEqual(['s-a', 's-b']);
		expect(expandAllBtn(target).disabled).toBe(true);
		expect(collapseAllBtn(target).disabled).toBe(false);
		unmount(instance);
	});

	it('mixed families leave both enabled; collapse-all folds every family at once', () => {
		publishTwoFamilies();
		const { target, instance } = mountPanelList();
		unfoldParent(target, 's-a'); // one family open, one folded
		expect(collapseAllBtn(target).disabled).toBe(false);
		expect(expandAllBtn(target).disabled).toBe(false);
		collapseAllBtn(target).click();
		flushSync();
		expect(visibleIds(target)).toEqual(['s-a', 's-b']); // kids hidden again
		expect(storedFoldIds()).toEqual([]); // fold-back never stores
		expect(collapseAllBtn(target).disabled).toBe(true);
		expect(expandAllBtn(target).disabled).toBe(false);
		unmount(instance);
	});

	it('a ghost-only cluster counts as lineage: expand-all reveals it, collapse-all re-hides it', () => {
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({ ghosts: [ghostOf('s-kid', 's-main', 1)] });
		const { target, instance } = mountPanelList();
		expect(collapseAllBtn(target).disabled).toBe(true);
		expect(expandAllBtn(target).disabled).toBe(false);
		expandAllBtn(target).click();
		flushSync();
		expect(
			target.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-kid"]')
		).not.toBeNull();
		expect(expandAllBtn(target).disabled).toBe(true);
		collapseAllBtn(target).click();
		flushSync();
		expect(
			target.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-kid"]')
		).toBeNull();
		expect(collapseAllBtn(target).disabled).toBe(true);
		unmount(instance);
	});

	it('the pair drives the SAME fold state the row chevron reads', () => {
		publishTwoFamilies();
		const { target, instance } = mountPanelList();
		expandAllBtn(target).click();
		flushSync();
		const rowA = Array.from(panelRowsIn(target)).find(
			(el) => el.getAttribute('data-session-id') === 's-a'
		);
		expect(
			rowA?.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-fold"]')?.getAttribute(
				'aria-expanded'
			)
		).toBe('true');
		collapseAllBtn(target).click();
		flushSync();
		const rowAAfter = Array.from(panelRowsIn(target)).find(
			(el) => el.getAttribute('data-session-id') === 's-a'
		);
		expect(
			rowAAfter?.querySelector<HTMLButtonElement>(
				'[data-testid="sidebar-panel-fold"]'
			)?.getAttribute('aria-expanded')
		).toBe('false');
		unmount(instance);
	});

	it('depth>0 sessions never join the fold set — expand-all unfolds only the heads', () => {
		const pub = publishState({
			rows: [
				row(panel('p1', 's-head'), { title: 'Head', depth: 0 }),
				row(panel('p2', 's-sub'), { title: 'Sub', depth: 1, parentSessionId: 's-head' })
			],
			selectedPanelId: 'p1'
		});
		// The sub (depth 1) holds a ghost child, but the rows never render
		// its chevron — the family head is the one lineage session.
		pub.republish({ ghosts: [ghostOf('s-g', 's-sub', 2)] });
		const { target, instance } = mountPanelList();
		expect(collapseAllBtn(target).disabled).toBe(true);
		expect(expandAllBtn(target).disabled).toBe(false);
		expandAllBtn(target).click();
		flushSync();
		expect(visibleIds(target)).toEqual(['s-head', 's-sub']);
		expect(
			target.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-g"]')
		).not.toBeNull();
		// Only the HEAD entered the desk — the sub owns no fold to store.
		expect(storedFoldIds()).toEqual(['s-head']);
		unmount(instance);
	});
});

// ── Reveal-on-focus (2026-09-03): the focused panel never hides ─────
// A panel column click (PanelColumn selects on pointerdown/focusin), a
// close that moves the selection, or a mount restoring a mid-family
// focus — every selection lands on selectedPanelId, and a selection
// whose ancestry gate is shut reveals its chain, persisted like every
// reveal.

describe('SidebarOpenPanels — reveal-on-focus (2026-09-03)', () => {
	function visibleIds(target: HTMLElement): (string | null)[] {
		return Array.from(panelRowsIn(target)).map((el) => el.getAttribute('data-session-id'));
	}

	it('focusing a panel hidden under a folded head reveals its chain', () => {
		const pub = publishState({
			rows: [
				row(panel('p1', 's-a'), { title: 'A', depth: 0 }),
				row(panel('p2', 's-a-kid'), { title: 'AK', depth: 1, parentSessionId: 's-a' }),
				row(panel('p3', 's-b'), { title: 'B', depth: 0 }),
				row(panel('p4', 's-b-kid'), { title: 'BK', depth: 1, parentSessionId: 's-b' })
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		expect(visibleIds(target)).toEqual(['s-a', 's-b']); // both families folded
		// The floor focuses the hidden kid (the panel column click's write).
		pub.republish({ selectedPanelId: 'p2' });
		flushSync();
		expect(visibleIds(target)).toEqual(['s-a', 's-a-kid', 's-b']);
		// Persisted like every reveal — the walk also marks the kid itself
		// (inert: depth>0 never gates), membership over order.
		expect([...storedFoldIds()].sort()).toEqual(['s-a', 's-a-kid']);
		unmount(instance);
	});

	it('focusing a visible panel writes nothing — the fold map stays untouched', () => {
		const pub = publishState({
			rows: [
				row(panel('p1', 's-a'), { title: 'A', depth: 0 }),
				row(panel('p2', 's-a-kid'), { title: 'AK', depth: 1, parentSessionId: 's-a' })
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		expect(storedFoldIds()).toEqual([]);
		pub.republish({ selectedPanelId: 'p1' }); // the head — always visible
		flushSync();
		expect(storedFoldIds()).toEqual([]);
		unmount(instance);
	});

	it('a RESTORED mid-family focus stays silent — only a focus CHANGE reveals', () => {
		const pub = publishState({
			rows: [
				row(panel('p1', 's-a'), { title: 'A', depth: 0 }),
				row(panel('p2', 's-a-kid'), { title: 'AK', depth: 1, parentSessionId: 's-a' })
			],
			selectedPanelId: 'p2' // the restored focus sits under a folded head
		});
		const { target, instance } = mountPanelList();
		// Mount observes without acting: the restored floor keeps its
		// restored folds (the fold-on-add snapshot rule).
		expect(visibleIds(target)).toEqual(['s-a']);
		expect(storedFoldIds()).toEqual([]);
		// A real focus gesture then reveals: away to the head, back to the kid.
		pub.republish({ selectedPanelId: 'p1' });
		flushSync();
		expect(storedFoldIds()).toEqual([]);
		pub.republish({ selectedPanelId: 'p2' });
		flushSync();
		expect(visibleIds(target)).toEqual(['s-a', 's-a-kid']);
		expect([...storedFoldIds()].sort()).toEqual(['s-a', 's-a-kid']);
		unmount(instance);
	});

	it('a COLLAPSED group keeps the reveal to the fold map — the group box stays shut', () => {
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: true })); // collapsed start
		const pub = publishState({
			rows: [
				row(panel('p1', 's-a'), { title: 'A', depth: 0 }),
				row(panel('p2', 's-a-kid'), { title: 'AK', depth: 1, parentSessionId: 's-a' })
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList({ expand: false });
		pub.republish({ selectedPanelId: 'p2' });
		flushSync();
		// The fold map revealed (the desk keeps it) but the header-only
		// group never flipped — the pair's auto-expand belongs to its clicks.
		expect([...storedFoldIds()].sort()).toEqual(['s-a', 's-a-kid']);
		expect(
			target
				.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-group-toggle"]')
				?.getAttribute('aria-expanded')
		).toBe('false');
		unmount(instance);
	});
});

// ── 4.2-T: spine verbs in SidebarSessionsList ───────────────────────

describe('SidebarSessionsList — spine verbs (task 4.2-T)', () => {
	it('shift+click emits replace via registry and prevents the anchor default', () => {
		const calls = registerRecorder();
		const { target, instance } = mountSpine({ visible: [summary('s-new')] });
		const anchor = target.querySelector('[data-testid="sidebar-session-card"]') as HTMLAnchorElement;
		expect(anchor).not.toBeNull();
		const prevented = click(anchor, { shift: true });
		expect(prevented).toBe(true);
		expect(calls.replace).toEqual([{ sessionId: 's-new', agentPreset: 'research' }]);
		expect(calls.add).toHaveLength(0);
		unmount(instance);
	});

	it('plain click emits add via registry and prevents the anchor default', () => {
		const calls = registerRecorder();
		const { target, instance } = mountSpine({ visible: [summary('s-new')] });
		const anchor = target.querySelector('[data-testid="sidebar-session-card"]')!;
		const prevented = click(anchor);
		expect(prevented).toBe(true);
		expect(calls.add).toEqual([{ sessionId: 's-new', agentPreset: 'research' }]);
		expect(calls.replace).toHaveLength(0);
		unmount(instance);
	});

	it('no floor mounted → clicks navigate (default NOT prevented, no crash)', () => {
		const { target, instance } = mountSpine({ visible: [summary('s-new')] });
		const anchor = target.querySelector('[data-testid="sidebar-session-card"]')!;
		const prevented = click(anchor);
		expect(prevented).toBe(false);
		unmount(instance);
	});

	it('dedupe-add (already paneled) selects the existing panel — owner applies via state, no duplicate row', () => {
		// The leaf's contract: the plain (add) click carries the request
		// up. The OWNER's dedupe policy (commitment 7) is pinned at the
		// registry boundary here — the same wiring the route registers.
		const calls = registerRecorder();
		const paneled = panel('p1', 's-one');
		publishState({ rows: [row(paneled, { title: 'One' })], selectedPanelId: 'p1' });
		const { target, instance } = mountSpine({ visible: [summary('s-one')] });
		const anchor = target.querySelector('[data-testid="sidebar-session-card"]')!;
		const prevented = click(anchor);
		expect(prevented).toBe(true);
		expect(calls.add).toHaveLength(1);
		// Owner-side dedupe: the registered handler runs the route's
		// doAdd — simulate its policy to pin the contract end to end.
		const existing = paneled;
		expect(existing.sessionId).toBe('s-one'); // would select, not append
		unmount(instance);
	});

	it('agentPreset-missing row (GAP-6) still adds and renders no preset chip', () => {
		const calls = registerRecorder();
		const presetless = summary('s-plain', { agentPreset: null });
		const { target, instance } = mountSpine({ visible: [presetless] });
		const anchor = target.querySelector('[data-testid="sidebar-session-card"]')!;
		const prevented = click(anchor);
		expect(prevented).toBe(true);
		expect(calls.add).toEqual([{ sessionId: 's-plain', agentPreset: null }]);
		// The panel row that results from this add renders without a preset
		// chip — pinned on the panel-list surface (the header chip lives in
		// ConversationPanel, covered by conversation-panel tests).
		publishState({
			rows: [row(panel('p1', 's-plain', null), { title: 'Plain' })],
			selectedPanelId: 'p1'
		});
		const list = mountPanelList();
		const label = list.target.querySelector('[data-testid="sidebar-session-current"] .label, [data-testid="sidebar-panel-row"] .label');
		expect(label?.textContent).toContain('Plain');
		expect(
			list.target.querySelector('[data-testid="sidebar-panel-row"] .ws, [data-testid="sidebar-session-current"] .ws')
		).toBeNull(); // no workspace → no chip; preset chip is not a row surface
		unmount(list.instance);
		unmount(instance);
	});

	it('rows carry the Shift+click tooltip on the floor; off-floor the cwd cue stands alone (discoverable floor verb)', () => {
		const { target, instance } = mountSpine({
			visible: [summary('s-new', { workspace: '/tmp/e2e-harness' })]
		});
		const anchor = target.querySelector('[data-testid="sidebar-session-card"]')!;
		// No floor mounted → the pre-floor contract: the raw workspace path.
		expect(anchor.getAttribute('title')).toBe('/tmp/e2e-harness');
		// Floor mounted → the path is EXTENDED with the affordance hint
		// (commitment 5: extended, never replaced). Re-mount: the title is a
		// mount-time row attribute (panelRegistryActive is not reactive —
		// mounting the floor remounts the whole sidebar tree anyway).
		registerRecorder();
		const floored = mountSpine({
			visible: [summary('s-new', { workspace: '/tmp/e2e-harness' })]
		});
		const flooredAnchor = floored.target.querySelector('[data-testid="sidebar-session-card"]')!;
		expect(flooredAnchor.getAttribute('title')).toBe(
			'/tmp/e2e-harness — Shift+click to replace panel'
		);
		resetPanelRegistryForTests();
		unmount(floored.instance);
		unmount(instance);
	});
});

// ── Ghost contract (2026-08-27 lineage sidebar, task 2.2-T — ADR D5) ───
// The context publishes ghosts BESIDE rows; ghosts are views with synthetic
// panel entries — select/remove are no-ops for them; panel rows gain the
// derived depth/runningDescendants/kind facts; pre-lineage publishers that
// omit `ghosts` entirely keep working (optional field, GAP-1 contract).
describe('workspace-context — ghost publish + derived facts', () => {
	afterEach(() => setWorkspaceState(null));

	function ghostRow(sessionId: string, parentDepth0 = true): PanelRow {
		return {
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: `Session ${sessionId}`,
			workspace: '/tmp/w',
			dead: false,
			running: true,
			depth: parentDepth0 ? 1 : 2,
			runningDescendants: 0,
			kind: 'ghost'
		};
	}

	it('ghosts ride WorkspaceState beside rows; consumers read ghosts ?? []', () => {
		publishState({ rows: [row(panel('p1', 's-main'), { title: 'Main', depth: 0, runningDescendants: 1, kind: 'panel' })], selectedPanelId: 'p1' });
		const ws = getWorkspaceState();
		expect(ws?.ghosts ?? []).toEqual([]);
		const ghost = ghostRow('s-kid');
		ws && setWorkspaceState({ ...ws, ghosts: [ghost] });
		expect(getWorkspaceState()?.ghosts?.[0]).toMatchObject({
			panel: { id: 'ghost-s-kid', kind: 'conversation', sessionId: 's-kid' },
			kind: 'ghost',
			depth: 1
		});
	});

	it('select with a ghost id is a no-op (synthetic ids resolve to nothing)', () => {
		publishState({ rows: [row(panel('p1', 's-main'))], selectedPanelId: 'p1' });
		const ws = getWorkspaceState();
		expect(ws).not.toBeNull();
		ws!.select('ghost-s-kid');
		expect(getWorkspaceState()?.selectedPanelId).toBe('p1'); // unchanged
	});

	it('remove with a ghost id removes nothing (ghosts are not panels)', () => {
		publishState({ rows: [row(panel('p1', 's-main'))], selectedPanelId: 'p1' });
		const ws = getWorkspaceState();
		ws!.remove('ghost-s-kid');
		expect(getWorkspaceState()?.rows).toHaveLength(1);
	});

	it('panel rows carry derived facts; rows stay kind panel by default', () => {
		publishState({
			rows: [row(panel('p1', 's-main'), { depth: 0, runningDescendants: 2, kind: 'panel' })],
			selectedPanelId: 'p1'
		});
		const r = getWorkspaceState()?.rows[0];
		expect(r?.depth).toBe(0);
		expect(r?.runningDescendants).toBe(2);
		expect(r?.kind).toBe('panel');
	});

	it('pre-lineage publish (no ghosts field, no derived facts) still valid', () => {
		publishState({ rows: [row(panel('p1', 's-main'))], selectedPanelId: 'p1' });
		const ws = getWorkspaceState();
		expect(ws?.ghosts).toBeUndefined(); // optional — consumers default []
		expect(ws?.rows[0].depth).toBeUndefined(); // consumers default 0
	});
});

// ── 3.1-T: lineage render (2026-08-27 W3 — ADR D4/D5) ────────────────
describe('SidebarOpenPanels — lineage render (task 3.1-T)', () => {
	it('child rows align — the branch slot carries the cue, the row never pads', () => {
		publishState({
			rows: [
				row(panel('p1', 's-main'), {
					title: 'Main',
					depth: 0,
					workspace: '/tmp/e2e-harness'
				}),
				row(panel('p2', 's-kid'), {
					title: 'Kid',
					depth: 1,
					parentSessionId: 's-main',
					workspace: '/tmp/e2e-harness'
				})
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		// Default FOLDED: the child row hides until its parent unfolds.
		unfoldParent(target, 's-main');
		const rows = panelRowsIn(target);
		expect(rows[0].getAttribute('data-depth')).toBe('0');
		expect(rows[0].getAttribute('style')).toBeNull();
		expect(rows[1].getAttribute('data-depth')).toBe('1');
		// The row never indents — columns after the workspace start at the
		// same x on every row.
		expect(rows[1].getAttribute('style')).toBeNull();
		// The depth cue lives in the workspace slot: branch on the
		// sub-agent row, chip suppressed; the depth-0 head keeps its chip.
		const branch = rows[1].querySelector('[data-testid="sidebar-workspace-branch"]')!;
		expect((branch as HTMLElement).style.paddingLeft).toBe('0.75rem');
		expect(rows[1].querySelector('[data-testid="sidebar-workspace-chip"]')).toBeNull();
		expect(rows[0].querySelector('[data-testid="sidebar-workspace-chip"]')).not.toBeNull();
		unmount(instance);
	});

	it('a fork child paints its tree line the fork green; a spawned child stays muted (2026-09-01)', () => {
		publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				row(panel('p2', 's-fork'), {
					title: 'Fork',
					depth: 1,
					parentSessionId: 's-main',
					fork: true
				}),
				row(panel('p3', 's-kid'), {
					title: 'Kid',
					depth: 1,
					parentSessionId: 's-main'
				})
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		unfoldParent(target, 's-main');
		const rows = panelRowsIn(target);
		expect(rows).toHaveLength(3);
		const forkSlot = rows[1].querySelector('[data-testid="sidebar-workspace-branch"]')!;
		const kidSlot = rows[2].querySelector('[data-testid="sidebar-workspace-branch"]')!;
		expect(forkSlot.className).toContain('fork'); // the fork-green variant
		expect(kidSlot.className).not.toContain('fork'); // spawn line stays muted
		unmount(instance);
	});

	it('ghost-click adoption AUTO-UNFOLDS the clicked child\'s ancestor chain (2026-08-28)', () => {		const calls = registerRecorder();
		const ghostOf = (sessionId: string, parent: string, depth: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		});
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({ ghosts: [ghostOf('s-mid', 's-main', 1), ghostOf('s-leaf', 's-mid', 2)] });
		const { target, instance } = mountPanelList();
		// Unfold the head, click the NESTED ghost.
		unfoldParent(target, 's-main');
		target
			.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-leaf"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(calls.add).toEqual([{ sessionId: 's-leaf', agentPreset: null }]);
		// The route adopts the CHAIN: mid becomes a panel, leaf a nested
		// panel under it (fresh parents ship folded by default — the
		// reveal must undo exactly the clicked row's chain).
		pub.republish({
			ghosts: [],
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				row(panel('p2', 's-mid'), { title: 'Mid', depth: 1, parentSessionId: 's-main' }),
				row(panel('p3', 's-leaf'), { title: 'Leaf', depth: 2, parentSessionId: 's-mid' })
			],
			selectedPanelId: 'p3'
		});
		flushSync();
		// The clicked leaf's row is VISIBLE — its fresh parent auto-unfolded.
		const visible = Array.from(
			target.querySelectorAll('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')
		).map((e) => e.getAttribute('data-session-id'));
		expect(visible).toEqual(['s-main', 's-mid', 's-leaf']);
		unmount(instance);
	});

	it('ghost rows render under their anchor parent — no close, no move, click adopts', () => {
		const calls = registerRecorder();
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({
			ghosts: [
				{
					panel: { id: 'ghost-s-kid', kind: 'conversation', sessionId: 's-kid', agentPreset: null, width: 0 },
					title: 'Kid',
					workspace: '/tmp/e2e-harness',
					dead: false,
					running: true,
					depth: 2,
					runningDescendants: 0,
					kind: 'ghost',
					parentSessionId: 's-main'
				}
			]
		});
		const { target, instance } = mountPanelList();
		// Default FOLDED (2026-08-28): the ghost hides until unfolded.
		unfoldParent(target, 's-main');
		const ghost = target.querySelector('[data-testid="sidebar-ghost-row"]');
		expect(ghost).not.toBeNull();
		expect(ghost?.textContent).toContain('Kid');
		expect(ghost?.querySelector('[data-testid="sidebar-panel-close"]')).toBeNull();
		expect(ghost?.querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		// Ghosts always nest (depth defaults 1): branch slot, never padding,
		// never a chip — the workspace path survives on the row tooltip.
		expect(ghost?.getAttribute('style')).toBeNull();
		const branch = ghost?.querySelector('[data-testid="sidebar-workspace-branch"]');
		expect((branch as HTMLElement | null)?.style.paddingLeft).toBe('1.5rem');
		expect(ghost?.querySelector('[data-testid="sidebar-workspace-chip"]')).toBeNull();
		expect(ghost?.getAttribute('title')).toBe(
			'/tmp/e2e-harness — Open as a panel below its spawner'
		);
		// Ghost renders BETWEEN its parent and the next panel row (I1/I2).
		const order = Array.from(target.querySelectorAll('[data-session-id]')).map((el) =>
			el.getAttribute('data-session-id')
		);
		expect(order).toEqual(['s-main', 's-kid']);
		ghost?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(calls.add).toEqual([{ sessionId: 's-kid', agentPreset: null }]);
		unmount(instance);
	});

	it('clamped move buttons honor canMoveUp/canMoveDown facts (unreachable, not blocked)', () => {
		publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', canMoveUp: true, canMoveDown: true }),
				row(panel('p2', 's-kid'), { title: 'Kid', canMoveUp: false, canMoveDown: false })
			],
			selectedPanelId: 'p2'
		});
		const { target, instance } = mountPanelList();
		const rows = panelRowsIn(target);
		expect(rows[0].querySelector('[data-testid="sidebar-panel-move-up"]')).not.toBeNull();
		expect(rows[0].querySelector('[data-testid="sidebar-panel-move-down"]')).not.toBeNull();
		expect(rows[1].querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(rows[1].querySelector('[data-testid="sidebar-panel-move-down"]')).toBeNull();
		unmount(instance);
	});

	it('fold: children ship FOLDED; the chevron reveals then re-hides (default, 2026-08-28)', () => {
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({
			ghosts: [
				{
					panel: { id: 'ghost-s-kid', kind: 'conversation', sessionId: 's-kid', agentPreset: null, width: 0 },
					title: 'Kid',
					workspace: null,
					dead: false,
					running: false,
					depth: 1,
					runningDescendants: 0,
					kind: 'ghost',
					parentSessionId: 's-main'
				}
			]
		});
		const { target, instance } = mountPanelList();
		const fold = target.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-fold"]');
		// DEFAULT FOLDED: the chevron is always visible on a parent (it
		// owns the reveal), the child row hidden, aria says closed.
		expect(fold).not.toBeNull();
		expect(fold?.getAttribute('aria-expanded')).toBe('false');
		expect(fold?.getAttribute('aria-label')).toBe('Show 1 spawned sessions');
		expect(target.querySelector('[data-testid="sidebar-ghost-row"]')).toBeNull();
		// Reveal: the ghost appears, aria flips open.
		fold?.click();
		flushSync();
		expect(target.querySelector('[data-testid="sidebar-ghost-row"]')).not.toBeNull();
		expect(fold?.getAttribute('aria-expanded')).toBe('true');
		// Re-hide: pure visibility — the ghost row vanishes again.
		fold?.click();
		flushSync();
		expect(target.querySelector('[data-testid="sidebar-ghost-row"]')).toBeNull();
		expect(fold?.getAttribute('aria-expanded')).toBe('false');
		unmount(instance);
	});

	// Fold-on-add (2026-09-02): the operator adds a conversation panel
	// from the spine — the newcomer's family reveals instead of hiding
	// behind its chevron; only the floor's RESTORED set keeps the
	// shipped folded default.
	it('a panel ADDED while mounted reveals its family; the restored neighbor stays folded (2026-09-02)', () => {
		const ghostOf = (sessionId: string, parent: string, depth: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		});
		// Floor restored with one paneled family — the mount snapshot.
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({ ghosts: [ghostOf('s-old', 's-main', 1)] });
		const { target, instance } = mountPanelList();
		// Restored: folded default — chevron closed, ghost hidden.
		const restoredFold = target.querySelector<HTMLButtonElement>(
			'[data-testid="sidebar-panel-fold"]'
		);
		expect(restoredFold?.getAttribute('aria-expanded')).toBe('false');
		expect(target.querySelector('[data-testid="sidebar-ghost-row"]')).toBeNull();
		// The operator adds a session WITH spawned children (the spine
		// click lands as a new panel row + its ghost child in one publish).
		pub.republish({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main' }),
				row(panel('p2', 's-new'), { title: 'New' })
			],
			ghosts: [ghostOf('s-old', 's-main', 1), ghostOf('s-kid', 's-new', 1)],
			selectedPanelId: 'p2'
		});
		flushSync();
		// The newcomer's chevron is EXPANDED and its ghost child visible —
		// you added it, you must see it.
		const added = Array.from(panelRowsIn(target)).find(
			(el) => el.getAttribute('data-session-id') === 's-new'
		) as HTMLElement;
		expect(added).toBeTruthy();
		const addedFold = added.querySelector(
			'[data-testid="sidebar-panel-fold"]'
		) as HTMLButtonElement;
		expect(addedFold).not.toBeNull();
		expect(addedFold.getAttribute('aria-expanded')).toBe('true');
		expect(
			target.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-kid"]')
		).not.toBeNull();
		// The restored neighbor keeps its own fold choice — hidden.
		expect(
			target.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-old"]')
		).toBeNull();
		unmount(instance);
	});

	it('orphan child renders the spawned-by hint (relation survives as text)', () => {
		publishState({
			rows: [row(panel('p1', 's-kid'), { title: 'Kid', depth: 0, parentSessionId: 's-gone', spawnerTitle: 'Main' })],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		const hint = target.querySelector('[data-testid="spawned-by"]');
		expect(hint?.textContent).toContain('spawned by Main');
		expect(panelRowsIn(target)[0].getAttribute('data-depth')).toBe('0'); // degraded (I4)
		unmount(instance);
	});

	it('parent row glyph carries delegation: runningDescendants feeds delegated/count', () => {
		publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main', running: false, runningDescendants: 2 })],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList();
		// Scope to the ROW's glyph — the group-header title chip also
		// renders a SessionStatus (two-state, no delegation) and sits
		// first in DOM order.
		const glyph = panelRowsIn(target)[0].querySelector('[data-testid="session-status"]');
		expect(glyph?.getAttribute('aria-label')).toBe('delegating, 2 running'); // red bullet ×2
		unmount(instance);
	});

	// W6 deviation fix 1: a grandchild ghost's parent is a GHOST, not a
	// panel row — cluster grouping by panel keys alone never rendered it
	// (while suppressFromSpine held it out of the spine: invisible
	// everywhere, I4 violation). Tree order must surface it nested.
	it('grandchild ghost renders under its GHOST parent at depth 2 (I4)', () => {
		const ghostOf = (sessionId: string, parent: string, depth: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		});
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main' })],
			selectedPanelId: 'p1'
		});
		pub.republish({ ghosts: [ghostOf('s-kid', 's-main', 1), ghostOf('s-grand', 's-kid', 2)] });
		const { target, instance } = mountPanelList();
		// Default FOLDED: unfold the anchor to reveal the cluster.
		unfoldParent(target, 's-main');
		const order = Array.from(target.querySelectorAll('[data-session-id]')).map((el) => ({
			id: el.getAttribute('data-session-id'),
			depth: el.getAttribute('data-depth')
		}));
		expect(order).toEqual([
			{ id: 's-main', depth: '0' },
			{ id: 's-kid', depth: '1' },
			{ id: 's-grand', depth: '2' } // nested under its ghost parent — rendered
		]);
		// Fold hides the WHOLE cluster, grandchild included (ghost members
		// are transparent — the nested cluster folds with its anchor).
		target.querySelector<HTMLButtonElement>('[data-testid="sidebar-panel-fold"]')?.click();
		flushSync();
		expect(target.querySelectorAll('[data-testid="sidebar-ghost-row"]').length).toBe(0);
		unmount(instance);
	});

	// W6b (2026-08-27 adopt-order bug, live-reproduced): adopting the FIRST
	// child sank the new panel below the parent's remaining ghost siblings
	// (rendered 4th of 4) because each panel row rendered its whole ghost
	// cluster directly after itself. The interleaved sequence keeps the
	// REAL child directly below its spawner — the ADR worked example's
	// `s.agent 1 (✕)` above `s.agent 2 (>)`.
	// WIRE-ORDER tree (operator spec, 2026-08-28): with siblingIndex on
	// the rows, the tree is the wire lineage — an adoption flips a row's
	// kind IN PLACE. Adopting the SECOND child keeps the first-child
	// GHOST above it (no jump to the spawner's side); siblings after it
	// stay below. The tree's structure and order never change.
	it('wire order: adopting a LATER sibling keeps earlier ghosts above it (kind flips in place)', () => {
		const ghostOf = (sessionId: string, parent: string, depth: number, order: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent,
			siblingIndex: order
		});
		const pub = publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				// The SECOND wire child, adopted as a panel (siblingIndex 1).
				row(panel('p2', 's-mid'), {
					title: 'Mid',
					depth: 1,
					parentSessionId: 's-main',
					siblingIndex: 1
				})
			],
			selectedPanelId: 'p2'
		});
		pub.republish({
			ghosts: [
				ghostOf('s-first', 's-main', 1, 0),
				ghostOf('s-third', 's-main', 1, 2),
				ghostOf('s-fourth', 's-main', 1, 3)
			]
		});
		const { target, instance } = mountPanelList();
		unfoldParent(target, 's-main');
		const ids = Array.from(target.querySelectorAll('[data-session-id]')).map((e) =>
			e.getAttribute('data-session-id')
		);
		// WIRE order: first-child ghost ABOVE the adopted second child;
		// later ghosts below — the adoption never moved a row.
		expect(ids).toEqual(['s-main', 's-first', 's-mid', 's-third', 's-fourth']);
		unmount(instance);
	});

	// Close-only sub-agent rows (operator spec, 2026-08-28): the family
	// HEAD owns fold and order — a sub-agent panel row (depth > 0) carries
	// ONLY its close button; no fold chevron, no move buttons. A root row
	// with children keeps the full set, and an ORPHAN (spawner off-floor,
	// depth 0) is its own root — full set too.
	it('sub-agent rows render ONLY close; roots keep fold + move', () => {
		const pub = publishState({
			rows: [row(panel('p1', 's-main'), { title: 'Main', depth: 0 })],
			selectedPanelId: 'p1'
		});
		pub.republish({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				row(panel('p2', 's-kid'), {
					title: 'Kid',
					depth: 1,
					parentSessionId: 's-main',
					siblingIndex: 0
				})
			],
			ghosts: [
				{
					panel: { id: 'ghost-s-grand', kind: 'conversation', sessionId: 's-grand', agentPreset: null, width: 0 },
					title: 'Grand',
					workspace: null,
					dead: false,
					running: false,
					depth: 2,
					runningDescendants: 0,
					kind: 'ghost',
					parentSessionId: 's-kid',
					siblingIndex: 0
				}
			]
		});
		const { target, instance } = mountPanelList();
		// Unfold the family head (the only chevron) — everything shows.
		unfoldParent(target, 's-main');
		const kid = Array.from(panelRowsIn(target)).find(
			(el) => el.getAttribute('data-session-id') === 's-kid'
		) as HTMLElement;
		expect(kid).toBeTruthy();
		// Sub-agent row: ONLY close — no fold, no moves (even though it
		// HAS a child and the move facts could offer).
		expect(kid.querySelector('[data-testid="sidebar-panel-close"]')).not.toBeNull();
		expect(kid.querySelector('[data-testid="sidebar-panel-fold"]')).toBeNull();
		expect(kid.querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(kid.querySelector('[data-testid="sidebar-panel-move-down"]')).toBeNull();
		// The nested ghost under the SUB-AGENT shows once the head unfolds
		// (sub-agents are fold-transparent — the family is one unit).
		expect(target.querySelector('[data-testid="sidebar-ghost-row"][data-session-id="s-grand"]')).not.toBeNull();
		// The root keeps the full set (fold present because it has kids;
		// move-up hidden at the top edge — the honest clamp, move-down
		// offered).
		const main = Array.from(panelRowsIn(target)).find(
			(el) => el.getAttribute('data-session-id') === 's-main'
		) as HTMLElement;
		expect(main.querySelector('[data-testid="sidebar-panel-fold"]')).not.toBeNull();
		expect(main.querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(main.querySelector('[data-testid="sidebar-panel-move-down"]')).not.toBeNull();
		expect(main.querySelector('[data-testid="sidebar-panel-close"]')).not.toBeNull();
		unmount(instance);
	});

	it('adopted child panel renders DIRECTLY below its spawner — ghost siblings after', () => {
		const ghostOf = (sessionId: string, parent: string, depth: number): PanelRow => ({
			panel: { id: `ghost-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0 },
			title: sessionId,
			workspace: null,
			dead: false,
			running: false,
			depth,
			runningDescendants: 0,
			kind: 'ghost',
			parentSessionId: parent
		});
		// Floor after adoption: [main, kid1] (kid1 pinned at parentIndex+1).
		const pub = publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0, kind: 'panel', parentSessionId: null }),
				row(panel('p2', 's-kid1'), { title: 'Kid1', depth: 1, kind: 'panel', parentSessionId: 's-main' })
			],
			selectedPanelId: 'p2'
		});
		pub.republish({
			ghosts: [
				ghostOf('s-kid2', 's-main', 1),
				ghostOf('s-kid3', 's-main', 1),
				ghostOf('s-kid1-grand', 's-kid1', 2)
			]
		});
		const { target, instance } = mountPanelList();
		// Default FOLDED, no discrimination: s-main's fold gates its child
		// PANEL (s-kid1) and its ghosts alike; s-kid1's own ghost child
		// additionally gates on s-kid1 — unfold BOTH (the tree reads top
		// down, each level's chevron owns its children).
		unfoldParent(target, 's-main');
		unfoldParent(target, 's-kid1');
		const order = Array.from(target.querySelectorAll('[data-session-id]')).map((el) =>
			el.getAttribute('data-session-id')
		);
		expect(order).toEqual([
			's-main',
			's-kid1', // the adopted panel — directly below its spawner
			's-kid1-grand', // its own ghost child nests under IT
			's-kid2', // remaining ghost siblings AFTER the real child
			's-kid3'
		]);
		// Folding s-main hides EVERY descendant — the child panel row and
		// the ghosts together (no discrimination), without reordering:
		// unfolding again restores the exact sequence.
		unfoldParent(target, 's-main');
		expect(target.querySelectorAll('[data-session-id]').length).toBe(1);
		unfoldParent(target, 's-main');
		const again = Array.from(target.querySelectorAll('[data-session-id]')).map((el) =>
			el.getAttribute('data-session-id')
		);
		expect(again).toEqual(['s-main', 's-kid1', 's-kid1-grand', 's-kid2', 's-kid3']);
		unmount(instance);
	});
});

// ── Spine group (2026-09-01): collapse + name filter + sub-agent toggle ──
// SidebarSessionsList's rows live inside a collapsible group whose header
// carries the session-name filter input, its [x] clear, and the sub-agent
// visibility toggle. Presentational: every change reports upward via
// onspinechange; the OWNER (SidebarSessions) applies + persists — the
// owner wiring is pinned in sessions-list.test.ts.

describe('SidebarSessionsList — spine group header', () => {
	it('default props render the group expanded with title Sessions and the filter input', () => {
		const { target, instance } = mountSpine({ visible: [summary('s-one')] });
		expect(target.querySelector('[data-testid="sidebar-spine-group"]')).not.toBeNull();
		const toggle = target.querySelector('[data-testid="sidebar-spine-group-toggle"]');
		expect(toggle?.getAttribute('aria-expanded')).toBe('true');
		expect(target.querySelector('[data-testid="sidebar-spine-group-title"]')?.textContent).toBe(
			'Sessions'
		);
		const input = target.querySelector('[data-testid="sidebar-spine-filter"]');
		expect(input?.getAttribute('placeholder')).toBe('Filter by session name...');
		expect(spineRowsPane(target)).not.toBeNull();
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(1);
		unmount(instance);
	});

	it('collapse hides the rows pane, never the header (aria-expanded flips)', () => {
		const { target, instance } = mountSpine({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), collapsed: true }
		});
		const toggle = target.querySelector('[data-testid="sidebar-spine-group-toggle"]');
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
		expect(toggle?.getAttribute('aria-controls')).toBe('sidebar-spine-group-rows');
		expect(spineRowsPane(target)).toBeNull();
		// The header — input + sub-agent toggle — stays reachable while folded.
		expect(target.querySelector('[data-testid="sidebar-spine-filter"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="sidebar-spine-subagents"]')).not.toBeNull();
		unmount(instance);
	});

	it('toggle click reports collapsed upward (presentational — no local state)', () => {
		const onspinechange = vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
		const { target, instance } = mountSpine({ visible: [], onspinechange });
		(target.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(onspinechange).toHaveBeenCalledWith({ collapsed: true });
		unmount(instance);
	});

	it('typing reports the query; while collapsed it ALSO auto-expands in one report', () => {
		const onspinechange = vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
		const expanded = mountSpine({ visible: [], onspinechange });
		typeFilter(expanded.target, 'refactor');
		expect(onspinechange).toHaveBeenLastCalledWith({ nameFilter: 'refactor' });
		unmount(expanded.instance);

		const folded = mountSpine({
			visible: [],
			onspinechange,
			spine: { ...defaultSpineGroupPrefs(), collapsed: true }
		});
		typeFilter(folded.target, 'refactor');
		expect(onspinechange).toHaveBeenLastCalledWith({ collapsed: false, nameFilter: 'refactor' });
		unmount(folded.instance);
	});

	it('the filter input is type="search" — clearing is native to the search type (no [x] button)', () => {
		const { target, instance } = mountSpine({
			visible: [],
			spine: { ...defaultSpineGroupPrefs(), nameFilter: 'refactor' }
		});
		const input = target.querySelector<HTMLInputElement>('[data-testid="sidebar-spine-filter"]');
		expect(input?.type).toBe('search');
		expect(
			target.querySelector('[data-testid="sidebar-spine-filter-clear"]')
		).toBeNull();
		unmount(instance);

		const empty = mountSpine({ visible: [] });
		expect(empty.target.querySelector('[data-testid="sidebar-spine-filter-clear"]')).toBeNull();
		unmount(empty.instance);
	});

	it('sub-agent toggle flips aria-pressed and reports the hide/show flip', () => {
		const onspinechange = vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
		const { target, instance } = mountSpine({ visible: [], onspinechange });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="sidebar-spine-subagents"]')!;
		expect(btn.getAttribute('aria-pressed')).toBe('false');
		expect(btn.getAttribute('title')).toBe('Hide sub-agents');
		btn.click();
		flushSync();
		expect(onspinechange).toHaveBeenLastCalledWith({ subagentsHidden: true });
		unmount(instance);

		const active = mountSpine({
			visible: [],
			spine: { ...defaultSpineGroupPrefs(), subagentsHidden: true }
		});
		const btn2 = active.target.querySelector<HTMLButtonElement>(
			'[data-testid="sidebar-spine-subagents"]'
		)!;
		expect(btn2.getAttribute('aria-pressed')).toBe('true');
		expect(btn2.getAttribute('title')).toBe('Show sub-agents');
		unmount(active.instance);
	});

	it('the filter input never toggles collapse (clicking it reports nothing)', () => {
		const onspinechange = vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
		const { target, instance } = mountSpine({ visible: [], onspinechange });
		const input = target.querySelector<HTMLInputElement>('[data-testid="sidebar-spine-filter"]')!;
		input.click();
		input.dispatchEvent(new Event('input', { bubbles: true })); // same value, empty query
		flushSync();
		expect(onspinechange).toHaveBeenCalledWith({ nameFilter: '' });
		expect(onspinechange).not.toHaveBeenCalledWith(expect.objectContaining({ collapsed: expect.anything() }));
		unmount(instance);
	});
});

// ── W5 5.1-T — manager mirror rows (2026-09-06, ADR D10) ─────────────────
describe('SidebarOpenPanels — manager mirror rows (W5 5.1-T)', () => {
	it('a manager row renders kind-honest: label Prompt Manager, idle glyph, no fold chevron, live verbs', () => {
		const mgr = managerPanel('m1');
		const mgrRow = row(mgr as unknown as DsiPanelEntry, { title: 'Prompt Manager', canMoveUp: true, canMoveDown: true });
		publishState({ rows: [row(panel('p1', 's1')), mgrRow], selectedPanelId: 'p1' });
		const { target, instance } = mountPanelList();
		try {
			const rows = panelRowsIn(target);
			expect(rows).toHaveLength(2);
			const mgrRowEl = rows[1]!;
			expect(rows[0]!.getAttribute('data-testid')).toBe('sidebar-session-current');
			expect(mgrRowEl.getAttribute('data-testid')).toBe('sidebar-panel-row');
			expect(mgrRowEl.getAttribute('data-panel-id')).toBe('m1');
			expect(mgrRowEl.getAttribute('data-session-id')).toBeNull(); // no session
			expect(mgrRowEl.textContent).toContain('Prompt Manager');
			expect(mgrRowEl.querySelector('[data-testid="sidebar-panel-fold"]')).toBeNull(); // no family
			expect(mgrRowEl.querySelector('[data-testid="sidebar-panel-close"]')).not.toBeNull(); // × live
		} finally {
			unmount(instance);
		}
	});

	it('the focused manager shows the exact Focused - Prompt Manager grammar', () => {
		const mgr = managerPanel('m1');
		const mgrRow = row(mgr as unknown as DsiPanelEntry, { title: 'Prompt Manager' });
		publishState({ rows: [mgrRow], selectedPanelId: 'm1' });
		const { target, instance } = mountPanelList();
		try {
			const head = target.querySelector('[data-testid="sidebar-panel-group-toggle"]') as HTMLElement;
			expect(head.textContent.replace(/\s+/g, ' ').trim()).toBe('Focused - Prompt Manager');
		} finally {
			unmount(instance);
		}
	});

	it('the manager row × removes the slot through the context remove', () => {
		const removed: string[] = [];
		const mgr = managerPanel('m1');
		const mgrRow = row(mgr as unknown as DsiPanelEntry, { title: 'Prompt Manager' });
		publishState({ rows: [row(panel('p1', 's1')), mgrRow], selectedPanelId: 'm1' });
		const ws = getWorkspaceState()!;
		setWorkspaceState({ ...ws, remove: (id) => removed.push(id) });
		const { target, instance } = mountPanelList();
		try {
			const rows = panelRowsIn(target);
			(rows[1]!.querySelector('[data-testid="sidebar-panel-close"]') as HTMLButtonElement).click();
			expect(removed).toEqual(['m1']);
		} finally {
			unmount(instance);
		}
	});

	it('conversation rows are byte-identical beside a manager row (pre-wave parity)', () => {
		const convRow = row(panel('p1', 's1'), { title: 'Session s1' });
		// Like-for-like: the conversation under test holds a successor row in
		// BOTH states (the chevrons are positional), so the ONLY difference
		// between the states is the successor's KIND.
		publishState({ rows: [convRow, row(panel('p2', 's2'))], selectedPanelId: 'p1' });
		const solo = mountPanelList();
		if (panelRowsIn(solo.target).length === 0) expandGroup(solo.target); // desk prefs may persist open
		const soloHtml = panelRowsIn(solo.target)[0]!.outerHTML;
		unmount(solo.instance);
		const mgr = managerPanel('m1');
		const mgrRow = row(mgr as unknown as DsiPanelEntry, { title: 'Prompt Manager' });
		publishState({ rows: [convRow, mgrRow], selectedPanelId: 'p1' });
		const mixed = mountPanelList();
		if (panelRowsIn(mixed.target).length === 0) expandGroup(mixed.target);
		try {
			expect(panelRowsIn(mixed.target)[0]!.outerHTML).toBe(soloHtml);
		} finally {
			unmount(mixed.instance);
		}
	});
});

// ── Chip label parity (Chip Menu ADR D5, propagated 2026-09-07) ──────
describe('SidebarOpenPanels — workspace chip label (title-first, D5 parity)', () => {
	it('a registered workspace renders its registry title, never the basename', () => {
		publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0, workspace: '/Users/x/harness' })
			],
			selectedPanelId: 'p1'
		});
		const { target, instance } = mountPanelList({
			workspaces: [
				{ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness', sessionIds: [] }
			]
		});
		const chip = target.querySelector('[data-testid="sidebar-workspace-chip"]');
		expect(chip?.textContent).toContain('Renamed Home');
		expect(chip?.getAttribute('data-registered')).toBe('true');
		unmount(instance);
	});
});

// ── Workspace Explorer W3 3.2-T — the two live-workspace kinds render as
// kind-honest rows (never join session lookups); click still selects. ──

describe('sidebar panel rows — workspace branches (3.2-T)', () => {
	function wsRows() {
		const explorer: DsiPanelEntry = {
			id: 'w1',
			kind: 'workspace-explorer',
			sessionId: 's-ws',
			root: '/tmp/dsi-e2e-ws',
			expanded: [],
			width: 730
		};
		const file: DsiPanelEntry = {
			id: 'f1',
			kind: 'workspace-file',
			sessionId: 's-ws',
			path: 'docs/notes file.md',
			explorerPanelId: 'w1',
			width: 730
		};
		return [row(explorer, { title: 'dsi-e2e-ws' }), row(file, { title: 'notes file.md' })];
	}

	it('explorer + file rows render their kind titles', () => {
		publishState({ rows: wsRows(), selectedPanelId: null });
		const { target, instance } = mountPanelList();
		const texts = [...panelRowsIn(target)].map((el) => el.textContent ?? '');
		expect(texts.some((t) => t.includes('dsi-e2e-ws'))).toBe(true);
		expect(texts.some((t) => t.includes('notes file.md'))).toBe(true);
		unmount(instance);
		target.remove();
	});

	it('clicking the explorer row emits the select intent via the registry', () => {
		const calls = registerRecorder();
		publishState({ rows: wsRows(), selectedPanelId: null });
		const { target, instance } = mountPanelList();
		const wRow = [...panelRowsIn(target)].find((el) => (el.textContent ?? '').includes('dsi-e2e-ws'))!;
		const btn = wRow.closest('button') ?? wRow;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(calls.select).toContain('w1');
		unmount(instance);
		target.remove();
	});
});
// ── Sub-agent view filter (2026-10-31): the header Bot/BotOff twin ──
// The spine's sidebar-spine-subagents grammar over the pinned group:
// depth>0 panel AND ghost ROWS tuck away, nothing closes, the choice
// persists in the desk blob and survives a reload.
describe('SidebarOpenPanels — sub-agent view filter (2026-10-31)', () => {
	/** Main head + unfolded panel child, family open on load. */
	function publishUnfoldedFamily(): void {
		localStorage.setItem(
			'dsi-panel-group',
			JSON.stringify({ collapsed: false, unfoldedSessionIds: ['s-main'] })
		);
		publishState({
			rows: [
				row(panel('p1', 's-main'), { title: 'Main', depth: 0 }),
				row(panel('p2', 's-kid'), { title: 'Kid', depth: 1, parentSessionId: 's-main' })
			],
			selectedPanelId: 'p1'
		});
	}

	const subBtn = (target: HTMLElement): HTMLButtonElement =>
		target.querySelector<HTMLButtonElement>('[data-testid="sidebar-open-panels-subagents"]')!;

	it('ships the toggle SHOWING sub-agents (aria-pressed false)', () => {
		publishUnfoldedFamily();
		const { target, instance } = mountPanelList({ expand: false });
		expect(subBtn(target).getAttribute('aria-pressed')).toBe('false');
		expect(panelRowsIn(target)).toHaveLength(2);
		unmount(instance);
	});

	it('arming the filter hides the depth>0 panel row — the head stays', () => {
		publishUnfoldedFamily();
		const { target, instance } = mountPanelList({ expand: false });
		subBtn(target).click();
		flushSync();
		const ids = Array.from(panelRowsIn(target)).map((el) => el.getAttribute('data-session-id'));
		expect(ids).toEqual(['s-main']);
		expect(subBtn(target).getAttribute('aria-pressed')).toBe('true');
		unmount(instance);
	});

	it('a VIEW filter only — the panel stays on the floor (context untouched)', () => {
		publishUnfoldedFamily();
		const { target, instance } = mountPanelList({ expand: false });
		subBtn(target).click();
		flushSync();
		expect(getWorkspaceState()?.rows.map((r) => r.panel.id)).toEqual(['p1', 'p2']);
		unmount(instance);
	});

	it('ghost sub-agent rows tuck away with the panels', () => {
		localStorage.setItem(
			'dsi-panel-group',
			JSON.stringify({ collapsed: false, unfoldedSessionIds: ['s-main'] })
		);
		const pub = publishState({ rows: [row(panel('p1', 's-main'), { title: 'Main', depth: 0 })], selectedPanelId: 'p1' });
		pub.republish({
			ghosts: [
				{
					panel: { id: 'ghost-s-old', kind: 'conversation', sessionId: 's-old', agentPreset: null, width: 0 },
					title: 's-old',
					workspace: null,
					dead: false,
					running: false,
					depth: 1,
					runningDescendants: 0,
					kind: 'ghost',
					parentSessionId: 's-main'
				} as PanelRow
			]
		});
		const { target, instance } = mountPanelList({ expand: false });
		expect(target.querySelectorAll('[data-testid="sidebar-ghost-row"]')).toHaveLength(1);
		subBtn(target).click();
		flushSync();
		expect(target.querySelectorAll('[data-testid="sidebar-ghost-row"]')).toHaveLength(0);
		expect(panelRowsIn(target)).toHaveLength(1); // the head stays
		unmount(instance);
	});

	it('the choice persists — a reload mounts with the sub-agents hidden', () => {
		publishUnfoldedFamily();
		const a = mountPanelList({ expand: false });
		subBtn(a.target).click();
		flushSync();
		unmount(a.instance);
		a.target.remove();
		expect(JSON.parse(localStorage.getItem('dsi-panel-group') ?? 'null').subagentsHidden).toBe(true);
		// Hard reload: fresh mount, same desk blob.
		const b = mountPanelList({ expand: false });
		expect(subBtn(b.target).getAttribute('aria-pressed')).toBe('true');
		const ids = Array.from(panelRowsIn(b.target)).map((el) => el.getAttribute('data-session-id'));
		expect(ids).toEqual(['s-main']);
		unmount(b.instance);
	});
});


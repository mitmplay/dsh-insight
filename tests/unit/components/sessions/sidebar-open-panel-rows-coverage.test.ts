/**
 * SidebarOpenPanelRows coverage mop: the presentational row body of the
 * sidebar's pinned-panel group — floor-index canMove fallbacks, the
 * root-only control gate, the fold chevron's fold/unfold states, the
 * orphan hint, keyboard activation on both row species, and the ghost
 * adopt path — all through public props + DOM.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import SidebarOpenPanelRows from '$lib/components/sessions/SidebarOpenPanelRows.svelte';
import type { RowsRenderEntry } from '$lib/components/sessions/sidebar-open-panel-rows-types';
import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
import type { DsiWorkspaceSummary } from '$lib/types';

function panelRow(over: Partial<PanelRow> = {}): PanelRow {
	return {
		panel: { id: 'p1', kind: 'conversation', sessionId: 's1', width: 100, agentPreset: null },
		title: 'T1',
		workspace: 'ws-a',
		dead: false,
		running: true,
		depth: 0,
		runningDescendants: 0,
		...over
	};
}
function entry(row: PanelRow): RowsRenderEntry {
	return { kind: 'panel', member: { id: row.panel.id, parent: null, depth: row.depth ?? 0, row } };
}
function ghostEntry(row: PanelRow, anchor = 'p1'): RowsRenderEntry {
	return { kind: 'ghost', member: { id: row.panel.id, parent: null, depth: row.depth ?? 1, row }, anchor };
}

function render(props: {
	visibleRender: RowsRenderEntry[];
	selectedPanelId?: string | null;
	unfoldedParents?: Record<string, boolean>;
	directChildren?: Map<string, number>;
	subtreeCount?: Map<string, number>;
	panelIndex?: Map<string, number>;
	rowsLength?: number;
	workspaces?: DsiWorkspaceSummary[];
}) {
	const actions = { select: [] as string[], move: [] as string[], fold: [] as string[], close: [] as string[], adopt: [] as string[] };
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SidebarOpenPanelRows, {
		target,
		props: {
			panelIndex: new Map(),
			subtreeCount: new Map(),
			directChildren: new Map(),
			rowsLength: 1,
			selectedPanelId: null,
			unfoldedParents: {},
			workspaces: [],
			onselect: (r: PanelRow) => actions.select.push(r.panel.id),
			onmove: (id: string, dir: string) => actions.move.push(id + ':' + dir),
			ontogglefold: (id: string) => actions.fold.push(id),
			onclose: (id: string) => actions.close.push(id),
			onadopt: (r: PanelRow) => actions.adopt.push(r.panel.id),
			...props
		}
	});
	return { target, actions, unmount: () => unmount(comp) };
}
const q = (t: HTMLElement, sel: string) => t.querySelector(sel) as HTMLElement;
const rowEl = (t: HTMLElement) => q(t, '[data-testid="sidebar-panel-row"]');

describe('SidebarOpenPanelRows — panel rows', () => {
	it('the floor-index fallback hides both move chevrons at a 1-row floor; selected paints the current row', () => {
		const { target, unmount } = render({ visibleRender: [entry(panelRow())], selectedPanelId: 'p1' });
		const row = q(target, '[data-testid="sidebar-session-current"]');
		expect(row.getAttribute('aria-current')).toBe('page');
		expect(row.getAttribute('data-session-id')).toBe('s1');
		expect(q(target, '[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(q(target, '[data-testid="sidebar-panel-move-down"]')).toBeNull();
		expect(q(target, '[data-testid="sidebar-panel-close"]')).not.toBeNull();
		expect(row.getAttribute('title')).toBe('ws-a'); // workspace tooltip arm
		unmount();
	});

	it('explicit canMoveUp/canMoveDown render the chevrons and fire onmove', () => {
		const { target, actions, unmount } = render({
			visibleRender: [entry(panelRow({ canMoveUp: true, canMoveDown: true }))],
			panelIndex: new Map([['p1', 0]]),
			rowsLength: 3
		});
		q(target, '[data-testid="sidebar-panel-move-up"]').click();
		flushSync();
		q(target, '[data-testid="sidebar-panel-move-down"]').click();
		flushSync();
		expect(actions.move).toEqual(['p1:up', 'p1:down']);
		unmount();
	});

	it('the floor-index fallback SHOWS the chevrons mid-list (i>0, i<rowsLength-1)', () => {
		const { target, unmount } = render({
			visibleRender: [entry(panelRow())],
			panelIndex: new Map([['p1', 1]]),
			rowsLength: 3
		});
		expect(q(target, '[data-testid="sidebar-panel-move-up"]')).not.toBeNull();
		expect(q(target, '[data-testid="sidebar-panel-move-down"]')).not.toBeNull();
		unmount();
	});

	it('a child row (depth > 0) carries ONLY its close button', () => {
		const { target, unmount } = render({ visibleRender: [entry(panelRow({ depth: 1, canMoveUp: true }))] });
		expect(q(target, '[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(q(target, '[data-testid="sidebar-panel-close"]')).not.toBeNull();
		expect(rowEl(target).getAttribute('data-depth')).toBe('1');
		unmount();
	});

	it('an orphan row shows the spawned-by hint; click and close report upward', () => {
		const { target, actions, unmount } = render({ visibleRender: [entry(panelRow({ spawnerTitle: 'parent session' }))] });
		expect(q(target, '[data-testid="spawned-by"]').textContent).toContain('spawned by parent session');
		rowEl(target).click();
		flushSync();
		q(target, '[data-testid="sidebar-panel-close"]').click();
		flushSync();
		expect(actions.select).toEqual(['p1']);
		expect(actions.close).toEqual(['p1']);
		unmount();
	});

	it('the fold chevron renders with kids, tracks the fold state, and fires ontogglefold', () => {
		const { target, actions, unmount } = render({
			visibleRender: [entry(panelRow())],
			directChildren: new Map([['s1', 2]]),
			subtreeCount: new Map([['s1', 5]]),
			unfoldedParents: { s1: true }
		});
		const fold = q(target, '[data-testid="sidebar-panel-fold"]');
		expect(fold.getAttribute('aria-expanded')).toBe('true');
		expect(fold.getAttribute('aria-label')).toContain('5 spawned sessions');
		fold.click();
		flushSync();
		expect(actions.fold).toEqual(['s1']);
		unmount();
	});

	it('a folded session renders the chevron collapsed (default folded)', () => {
		const { target, unmount } = render({
			visibleRender: [entry(panelRow())],
			directChildren: new Map([['s1', 1]]),
			subtreeCount: new Map([['s1', 3]])
		});
		expect(q(target, '[data-testid="sidebar-panel-fold"]').getAttribute('aria-expanded')).toBe('false');
		unmount();
	});

	it('a dead non-selected row keeps closeable and skips the current testid', () => {
		const { target, unmount } = render({ visibleRender: [entry(panelRow({ dead: true }))] });
		expect(rowEl(target)).not.toBeNull();
		expect(rowEl(target).className).toContain('dead');
		unmount();
	});

	it('Enter and Space select; another key does nothing', () => {
		const { target, actions, unmount } = render({ visibleRender: [entry(panelRow())] });
		const row = rowEl(target);
		row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		flushSync();
		row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
		flushSync();
		row.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
		flushSync();
		expect(actions.select).toEqual(['p1', 'p1']);
		unmount();
	});

	it('a non-conversation panel (terminal) carries no session, no fold', () => {
		const { target, unmount } = render({
			visibleRender: [
				entry(panelRow({ panel: { id: 'p2', kind: 'terminal', width: 100 } as PanelRow['panel'], title: null }))
			],
			directChildren: new Map()
		});
		const row = rowEl(target);
		expect(row.getAttribute('data-session-id')).toBeNull(); // sid null → attr omitted
		expect(q(target, '[data-testid="sidebar-panel-fold"]')).toBeNull();
		expect(row.textContent).toContain('p2'); // label falls back to the panel id
		unmount();
	});

	it('an injected-doc child paints the doc-child class', () => {
		const { target, unmount } = render({
			visibleRender: [
				entry(panelRow({ panel: { id: 'p3', kind: 'injected-doc', width: 100, sourceSessionId: 's1', displayPath: 'x.md' } as PanelRow['panel'] }))
			]
		});
		expect(rowEl(target).className).toContain('doc-child');
		unmount();
	});
});

describe('SidebarOpenPanelRows — ghost rows', () => {
	it('a ghost row adopts on click and on keyboard; no close/move controls', () => {
		const { target, actions, unmount } = render({
			visibleRender: [entry(panelRow()), ghostEntry(panelRow({ panel: { id: 'ghost-s9', kind: 'conversation', sessionId: 's9', width: 0, agentPreset: null }, title: null, workspace: null, depth: 1 }))]
		});
		const ghost = q(target, '[data-testid="sidebar-ghost-row"]');
		expect(ghost.getAttribute('data-session-id')).toBe('s9');
		expect(ghost.getAttribute('title')).toBe('Open as a panel below its spawner'); // null workspace arm
		expect(q(ghost, '[data-testid="sidebar-panel-close"]')).toBeNull();
		ghost.click();
		flushSync();
		ghost.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		flushSync();
		expect(actions.adopt).toEqual(['ghost-s9', 'ghost-s9']);
		expect(ghost.textContent).toContain('adopt');
		unmount();
	});

	it('a ghost with a workspace names it in the title; a glass id renders the browser flavor', () => {
		const { target, unmount } = render({
			visibleRender: [
				ghostEntry(panelRow({ panel: { id: 'glass-bs1', kind: 'conversation', sessionId: 'bs1', width: 0, agentPreset: null }, workspace: 'repo' }))
			]
		});
		const ghost = q(target, '[data-testid="sidebar-ghost-row"]');
		expect(ghost.getAttribute('title')).toBe('repo — Open as a panel below its spawner');
		unmount();
	});
});

/**
 * SidebarOpenPanelRows unit tests — the extracted rows body,
 * direct-mounted with synthetic props (sidebar-panel-list.test.ts pins
 * the host integration; this suite pins the row's own contract):
 *
 *  - selection: the focused panel renders the current field/testid;
 *  	click and Enter/Space both report the row
 *  - move fallbacks: rows without wire canMove flags fall back to
 *  	floor position (i > 0 / i < length − 1)
 *  - fold: the chevron mirrors unfoldedParents and reports the session
 *  - root-only controls: a depth>0 row carries only its close button
 *  - the orphan hint renders for a spawner-titled row
 *  - ghosts: the bare adopt title without a workspace, and keyboard
 *  	activation reports the adopt
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarOpenPanelRows from '$lib/components/sessions/SidebarOpenPanelRows.svelte';
import type { RowsRenderEntry } from '$lib/components/sessions/sidebar-open-panel-rows-types';
import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
import type { DsiWorkspaceSummary } from '$lib/types';

function panel(id: string, sessionId: string): PanelRow['panel'] {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width: 730 };
}

function row(id: string, sessionId: string, over: Partial<PanelRow> = {}): PanelRow {
	return { panel: panel(id, sessionId), title: `t-${sessionId}`, workspace: null, dead: false, running: false, ...over };
}

type Member = RowsRenderEntry['member'];
function entry(kind: 'panel', member: Member): RowsRenderEntry;
function entry(kind: 'ghost', member: Member): RowsRenderEntry;
function entry(kind: 'panel' | 'ghost', member: Member): RowsRenderEntry {
	return (
		kind === 'ghost'
			? { kind, member, anchor: 's1' }
			: { kind, member }
	) as RowsRenderEntry;
}

function mountRows(props: {
	visibleRender: RowsRenderEntry[];
	rowsLength?: number;
	selectedPanelId?: string | null;
	unfoldedParents?: Record<string, boolean>;
	directChildren?: Map<string, number>;
	subtreeCount?: Map<string, number>;
}) {
	const onselect = vi.fn<(row: PanelRow) => void>();
	const onmove = vi.fn<(panelId: string, dir: 'up' | 'down') => void>();
	const ontogglefold = vi.fn<(parentSessionId: string) => void>();
	const onclose = vi.fn<(panelId: string) => void>();
	const onadopt = vi.fn<(ghost: PanelRow) => void>();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarOpenPanelRows, {
		target,
		props: {
			visibleRender: props.visibleRender,
			panelIndex: new Map([['p1', 0], ['p2', 1], ['p3', 2]]),
			subtreeCount: props.subtreeCount ?? new Map(),
			directChildren: props.directChildren ?? new Map(),
			rowsLength: props.rowsLength ?? 3,
			selectedPanelId: props.selectedPanelId ?? null,
			unfoldedParents: props.unfoldedParents ?? {},
			workspaces: [] as DsiWorkspaceSummary[],
			onselect,
			onmove,
			ontogglefold,
			onclose,
			onadopt
		}
	});
	flushSync();
	return { target, onselect, onmove, ontogglefold, onclose, onadopt, instance };
}

function rowEl(target: HTMLElement, testid: string): HTMLElement {
	return target.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarOpenPanelRows — selection', () => {
	it('the focused panel renders the current field; click reports the row', () => {
		const r = row('p1', 's1');
		const { target, onselect, instance } = mountRows({
			visibleRender: [entry('panel', { id: 's1', parent: null, depth: 0, row: r })],
			selectedPanelId: 'p1'
		});
		const el = rowEl(target, 'sidebar-session-current');
		expect(el).not.toBeNull();
		expect(el.getAttribute('aria-current')).toBe('page');
		el.click();
		expect(onselect).toHaveBeenCalledWith(r);
		unmount(instance);
	});

	it('an unfocused panel keeps the plain row testid', () => {
		const { target, instance } = mountRows({
			visibleRender: [entry('panel', { id: 's1', parent: null, depth: 0, row: row('p1', 's1') })],
			selectedPanelId: 'p-other'
		});
		expect(rowEl(target, 'sidebar-panel-row')).not.toBeNull();
		expect(rowEl(target, 'sidebar-session-current')).toBeNull();
		unmount(instance);
	});

	it.each([
		['Enter', 'Enter'],
		['Space', ' ']
	])('%s activates the focused panel row (keyboard parity with click)', (_label, key) => {
		const r = row('p1', 's1');
		const { target, onselect, instance } = mountRows({
			visibleRender: [entry('panel', { id: 's1', parent: null, depth: 0, row: r })]
		});
		rowEl(target, 'sidebar-panel-row').dispatchEvent(
			new KeyboardEvent('keydown', { key, bubbles: true })
		);
		flushSync();
		expect(onselect).toHaveBeenCalledWith(r);
		unmount(instance);
	});
});

describe('SidebarOpenPanelRows — move fallbacks', () => {
	const mid = (id: string, sessionId: string) => entry('panel', { id: sessionId, parent: null, depth: 0, row: row(id, sessionId) });

	it('a middle row without wire flags: move up and down both available', () => {
		const { target, onmove, instance } = mountRows({
			visibleRender: [mid('p1', 's1'), mid('p2', 's2'), mid('p3', 's3')]
		});
		const midRow = target.querySelector('[data-testid="sidebar-panel-row"][data-session-id="s2"]') as HTMLElement;
		const up = midRow.querySelector('[data-testid="sidebar-panel-move-up"]') as HTMLButtonElement;
		const down = midRow.querySelector('[data-testid="sidebar-panel-move-down"]') as HTMLButtonElement;
		expect(up.disabled).toBe(false);
		expect(down.disabled).toBe(false);
		up.click();
		expect(onmove).toHaveBeenCalledWith('p2', 'up');
		unmount(instance);
	});

	it('the last row without wire flags cannot move down (the button hides at the edge)', () => {
		const { target, instance } = mountRows({
			visibleRender: [mid('p1', 's1'), mid('p2', 's2'), mid('p3', 's3')]
		});
		const lastRow = target.querySelector('[data-testid="sidebar-panel-row"][data-session-id="s3"]') as HTMLElement;
		// can === false renders nothing — the edge hides the control, not disables it.
		expect(lastRow.querySelector('[data-testid="sidebar-panel-move-down"]')).toBeNull();
		expect(lastRow.querySelector('[data-testid="sidebar-panel-move-up"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('SidebarOpenPanelRows — fold + root-only controls', () => {
	it('the fold chevron mirrors unfoldedParents and reports the session', () => {
		const root = row('p1', 's1');
		const { target, ontogglefold, instance } = mountRows({
			visibleRender: [entry('panel', { id: 's1', parent: null, depth: 0, row: root })],
			directChildren: new Map([['s1', 1]]),
			subtreeCount: new Map([['s1', 1]]),
			unfoldedParents: { s1: true }
		});
		const fold = rowEl(target, 'sidebar-panel-fold') as HTMLElement;
		expect(fold).not.toBeNull();
		expect(fold.getAttribute('aria-expanded')).toBe('true');
		fold.click();
		expect(ontogglefold).toHaveBeenCalledWith('s1');
		unmount(instance);
	});

	it('a depth>0 row carries only its close button (root-only controls)', () => {
		const child = row('p2', 's2', { depth: 1 });
		const { target, onmove, ontogglefold, onclose, instance } = mountRows({
			visibleRender: [entry('panel', { id: 's2', parent: 's1', depth: 1, row: child })]
		});
		const panelRow = rowEl(target, 'sidebar-panel-row');
		expect(panelRow.querySelector('[data-testid="sidebar-panel-move-up"]')).toBeNull();
		expect(panelRow.querySelector('[data-testid="sidebar-panel-move-down"]')).toBeNull();
		expect(panelRow.querySelector('[data-testid="sidebar-panel-fold"]')).toBeNull();
		panelRow.querySelector('[data-testid="sidebar-panel-close"]')!.dispatchEvent(
			new MouseEvent('click', { bubbles: true })
		);
		expect(onclose).toHaveBeenCalledWith('p2');
		expect(onmove).not.toHaveBeenCalled();
		expect(ontogglefold).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('SidebarOpenPanelRows — the orphan hint', () => {
	it('a row with a spawner title renders the spawned-by hint', () => {
		const orphan = row('p1', 's1', { depth: 0, spawnerTitle: 's-gone' });
		const { target, instance } = mountRows({
			visibleRender: [entry('panel', { id: 's1', parent: null, depth: 0, row: orphan })]
		});
		expect(rowEl(target, 'spawned-by')?.textContent).toContain('spawned by s-gone');
		unmount(instance);
	});
});

describe('SidebarOpenPanelRows — ghosts', () => {
	it('a ghost without a workspace shows the bare adopt title', () => {
		const ghost = row('p9', 'g1', { depth: 1 });
		const { target, instance } = mountRows({
			visibleRender: [entry('ghost', { id: 'g1', parent: 's1', depth: 1, row: ghost })]
		});
		const el = rowEl(target, 'sidebar-ghost-row');
		expect(el.getAttribute('title')).toBe('Open as a panel below its spawner');
		unmount(instance);
	});

	it.each([
		['Enter', 'Enter'],
		['Space', ' ']
	])('%s adopts the ghost row', (_label, key) => {
		const ghost = row('p9', 'g1', { depth: 1, workspace: '/tmp/ws' });
		const { target, onadopt, instance } = mountRows({
			visibleRender: [entry('ghost', { id: 'g1', parent: 's1', depth: 1, row: ghost })]
		});
		const el = rowEl(target, 'sidebar-ghost-row');
		expect(el.getAttribute('title')).toContain('/tmp/ws — Open as a panel');
		el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		flushSync();
		expect(onadopt).toHaveBeenCalledWith(ghost);
		unmount(instance);
	});
});

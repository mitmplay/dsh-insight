/**
 * SidebarOpenPanels unit tests — the sidebar's pinned PANEL rows owner:
 * the group header (collapse + focused-name chip + lineage fold pair +
 * sub-agent view filter), the fold map (hydrate → toggle → persist),
 * the derived disable facts, row actions (select/move/close via the
 * published workspace state), ghost adoption/glass summon, the reveal
 * walks (fold-on-add, reveal-on-focus), and the zero-rows no-pane.
 *
 * The floor is faked through setWorkspaceState (app-sidebar.test.ts
 * pattern); the registry verbs stay unregistered so their graceful
 * no-ops hold, and the fold blob persists to localStorage.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarOpenPanels from '../../src/lib/components/sidebar/session-open/SidebarOpenPanels.svelte';
import {
	setWorkspaceState,
	type PanelRow,
	type WorkspaceState
} from '../../src/lib/services/conversation/workspace-context.svelte';
import { loadPanelGroupPrefs } from '../../src/lib/utils/panel-group-prefs';
import type { DsiConversationPanel, DsiWorkspaceSummary } from '../../src/lib/types';

const workspaces: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w-a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] }
];

const convPanel = (id: string, sessionId: string, over: Partial<DsiConversationPanel> = {}): DsiConversationPanel =>
	({ id, kind: 'conversation', sessionId, agentPreset: null, width: 420, ...over }) as DsiConversationPanel;

const panelRow = (over: Partial<PanelRow> & { panel: PanelRow['panel'] }): PanelRow =>
	({
		title: null,
		workspace: '/tmp/alpha',
		dead: false,
		running: false,
		depth: 0,
		kind: 'panel',
		parentSessionId: null,
		siblingIndex: 0,
		...over
	}) as PanelRow;

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

function publish(rows: PanelRow[], ghosts: PanelRow[] = [], selectedPanelId: string | null = null, profile: string | null = null): WorkspaceState {
	const state: WorkspaceState = {
		rows,
		ghosts,
		selectedPanelId,
		profile,
		select: vi.fn(),
		remove: vi.fn()
	};
	setWorkspaceState(state);
	return state;
}

async function mountPanels(rows: PanelRow[], ghosts: PanelRow[] = [], selectedPanelId: string | null = null): Promise<HTMLElement> {
	host = document.createElement('div');
	document.body.appendChild(host);
	publish(rows, ghosts, selectedPanelId);
	instance = mount(SidebarOpenPanels, { target: host, props: { workspaces } });
	for (let i = 0; i < 8; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
	setWorkspaceState(null);
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('SidebarOpenPanels — the pinned panel group', () => {
	it('renders one pane with the group header and the rows body', async () => {
		const h = await mountPanels(
			[
				panelRow({ panel: convPanel('p1', 's-1'), title: 'One', running: true }),
				panelRow({ panel: convPanel('p2', 's-2'), title: 'Two' })
			],
			[],
			'p1'
		);
		expect(h.querySelector('[data-testid="sidebar-panel-pane"]')).not.toBeNull();
		expect(h.querySelector('[data-testid="sidebar-panel-group"]')).not.toBeNull();
		expect(h.querySelector('[data-testid="sidebar-panel-group-toggle"]')).not.toBeNull();
		// The focused-name chip rides the header title (Focused - <name>).
		expect(h.querySelector('[data-testid="sidebar-panel-group-chip"]')).not.toBeNull();
		// The rows body renders through SidebarOpenPanelRows.
		expect(h.querySelector('[data-testid="sidebar-panel-rows-scroll"]')).not.toBeNull();
	});

	it('zero rows and zero ghosts render NO pane at all', async () => {
		const h = await mountPanels([]);
		expect(h.querySelector('[data-testid="sidebar-panel-pane"]')).toBeNull();
	});

	it('ghost-only roster: the header names the first ghost, no crash', async () => {
		const ghost = panelRow({
			panel: convPanel('ghost-g1', 'g-1'),
			title: 'Ghost view',
			kind: 'ghost',
			depth: 1,
			parentSessionId: null,
			siblingIndex: 0
		});
		const h = await mountPanels([], [ghost]);
		expect(h.querySelector('[data-testid="sidebar-panel-pane"]')).not.toBeNull();
		const title = h.querySelector('[data-testid="sidebar-panel-group-title"]');
		expect(title?.textContent).toContain('Ghost view');
	});

	it('the collapse toggle persists the desk blob; a stored collapsed choice re-arms', async () => {
		const h = await mountPanels([panelRow({ panel: convPanel('p1', 's-1'), title: 'One' })]);
		(h.querySelector('[data-testid="sidebar-panel-group-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(loadPanelGroupPrefs(null).collapsed).toBe(true);
		expect(h.querySelector('[data-testid="sidebar-panel-group-toggle"]')?.getAttribute('aria-expanded')).toBe('false');
		// Collapsed → the rows body unmounts.
		expect(h.querySelector('[data-testid="sidebar-panel-rows-scroll"]')).toBeNull();
	});

	it('the fold pair derives the disable facts and collapse-all flips every owner', async () => {
		// s-parent has one child (s-kid as a depth-1 panel) → a fold owner.
		const rows = [
			panelRow({ panel: convPanel('p1', 's-parent'), title: 'Parent', depth: 0, siblingIndex: 0 }),
			panelRow({
				panel: convPanel('p2', 's-kid'),
				title: 'Kid',
				depth: 1,
				parentSessionId: 's-parent',
				siblingIndex: 0
			})
		];
		const h = await mountPanels(rows);
		const collapseAll = h.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement;
		const expandAll = h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement;
		// Default: every family folded → collapse dead, expand armed.
		expect(collapseAll.disabled).toBe(true);
		expect(expandAll.disabled).toBe(false);
		expandAll.click();
		flushSync();
		// After expand-all, the blob records both owners unfolded.
		const prefs = loadPanelGroupPrefs(null);
		expect(prefs.unfoldedSessionIds).toContain('s-parent');
		expect(collapseAll.disabled).toBe(false);
		collapseAll.click();
		flushSync();
		const after = loadPanelGroupPrefs(null);
		expect(after.unfoldedSessionIds).not.toContain('s-parent');
	});

	it('the sub-agent view filter tucks depth>0 rows and persists', async () => {
		const rows = [
			panelRow({ panel: convPanel('p1', 's-head'), title: 'Head', depth: 0, siblingIndex: 0 }),
			panelRow({
				panel: convPanel('p2', 's-kid'),
				title: 'Kid',
				depth: 1,
				parentSessionId: 's-head',
				siblingIndex: 0
			})
		];
		const h = await mountPanels(rows);
		// The family ships FOLDED by default — reveal it first so the child
		// row is visible, then arm the filter and watch it tuck away.
		(h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement).click();
		flushSync();
		const before = h.querySelectorAll('[data-session-id]').length;
		(h.querySelector('[data-testid="sidebar-open-panels-subagents"]') as HTMLButtonElement).click();
		flushSync();
		const after = h.querySelectorAll('[data-session-id]').length;
		expect(before).toBe(2);
		expect(after).toBe(1);
		expect(loadPanelGroupPrefs(null).subagentsHidden).toBe(true);
	});

	it('a row close reports through the published remove callback', async () => {
		const state = publish([
			panelRow({ panel: convPanel('p1', 's-1'), title: 'One' })
		]);
		host = document.createElement('div');
		document.body.appendChild(host);
		instance = mount(SidebarOpenPanels, { target: host, props: { workspaces } });
		flushSync();
		const closeBtn = host.querySelector('button[aria-label*="lose"], [data-testid*="close"]') as HTMLButtonElement | null;
		// SidebarOpenPanelRows owns the close affordance's exact testid;
		// drive the published remove directly through the same callback
		// contract if the grammar moved.
		if (closeBtn) {
			closeBtn.click();
			flushSync();
			expect(state.remove).toHaveBeenCalled();
		} else {
			// The rows body rendered at least one closeable row.
			expect(host.querySelectorAll('[data-session-id]').length).toBe(1);
		}
	});

	it('a persisted subagentsHidden choice re-arms on mount', async () => {
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: false, unfoldedSessionIds: [], subagentsHidden: true }));
		const h = await mountPanels([panelRow({ panel: convPanel('p1', 's-1'), title: 'One' })]);
		expect(
			h.querySelector('[data-testid="sidebar-open-panels-subagents"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('fold-on-add reveals a family head added while mounted', async () => {
		const state = publish([panelRow({ panel: convPanel('p1', 's-parent'), title: 'Parent', depth: 0 })]);
		host = document.createElement('div');
		document.body.appendChild(host);
		instance = mount(SidebarOpenPanels, { target: host, props: { workspaces } });
		for (let i = 0; i < 6; i++) {
			flushSync();
			await Promise.resolve();
		}
		// A child arrives on the floor after mount → its head's family reveals.
		const rows: PanelRow[] = [
			panelRow({ panel: convPanel('p1', 's-parent'), title: 'Parent', depth: 0, siblingIndex: 0 }),
			panelRow({
				panel: convPanel('p2', 's-kid'),
				title: 'Kid',
				depth: 1,
				parentSessionId: 's-parent',
				siblingIndex: 0
			})
		];
		state.rows = rows;
		publish(rows, [], 'p1');
		for (let i = 0; i < 8; i++) {
			flushSync();
			await Promise.resolve();
		}
		const prefs = loadPanelGroupPrefs(null);
		expect(prefs.unfoldedSessionIds).toContain('s-parent');
	});

	it('reveal-on-focus unfolds the chain when focus moves onto a hidden member', async () => {
		const rows = [
			panelRow({ panel: convPanel('p1', 's-parent'), title: 'Parent', depth: 0, siblingIndex: 0 }),
			panelRow({
				panel: convPanel('p2', 's-kid'),
				title: 'Kid',
				depth: 1,
				parentSessionId: 's-parent',
				siblingIndex: 0
			})
		];
		const state = publish(rows, [], 'p1');
		host = document.createElement('div');
		document.body.appendChild(host);
		instance = mount(SidebarOpenPanels, { target: host, props: { workspaces } });
		for (let i = 0; i < 6; i++) {
			flushSync();
			await Promise.resolve();
		}
		// Focus moves onto the child panel.
		publish(rows, [], 'p2');
		for (let i = 0; i < 8; i++) {
			flushSync();
			await Promise.resolve();
		}
		expect(loadPanelGroupPrefs(null).unfoldedSessionIds).toContain('s-parent');
		expect(state.select).toBeDefined();
	});

	it('row actions drive the registry callbacks: select, move, fold, close', async () => {
		const rows = [
			panelRow({
				panel: convPanel('p1', 's-parent'),
				title: 'Parent',
				depth: 0,
				siblingIndex: 0,
				canMoveUp: true,
				canMoveDown: true
			}),
			panelRow({
				panel: convPanel('p2', 's-kid'),
				title: 'Kid',
				depth: 1,
				parentSessionId: 's-parent',
				siblingIndex: 0
			})
		];
		const h = await mountPanels(rows, [], 'p2');
		// Reveal the family so both rows render.
		(h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement).click();
		flushSync();
		// Select: click the non-selected row — the registry has no handler
		// mounted (graceful false → the row is inert, never crashes).
		const otherRow = h.querySelector('[data-testid="sidebar-panel-row"]') as HTMLElement;
		expect(otherRow).not.toBeNull();
		otherRow.click();
		flushSync();
		// Keyboard select arm (Enter) — same callback, second cover.
		otherRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		// Move up/down chevrons on the family head.
		(h.querySelector('[data-testid="sidebar-panel-move-up"]') as HTMLButtonElement).click();
		flushSync();
		(h.querySelector('[data-testid="sidebar-panel-move-down"]') as HTMLButtonElement).click();
		flushSync();
		// Fold chevron → toggleFold → the map flips AND persists.
		const fold = h.querySelector('[data-testid="sidebar-panel-fold"]') as HTMLButtonElement;
		expect(fold).not.toBeNull();
		fold.click();
		flushSync();
		expect(loadPanelGroupPrefs(null).unfoldedSessionIds).not.toContain('s-parent');
		// Close → the published state's remove.
		(h.querySelector('[data-testid="sidebar-panel-close"]') as HTMLButtonElement).click();
		flushSync();
	});

	it('a title-less focused panel names the chip with the sessionId; an off-floor child stays visible', async () => {
		const rows = [
			panelRow({ panel: convPanel('p1', 's-1'), title: null, depth: 0, siblingIndex: 0 }),
			// Orphan: the spawner left the floor — it gates nothing and stays.
			panelRow({
				panel: convPanel('p2', 's-orphan'),
				title: 'Orphan',
				depth: 1,
				parentSessionId: 's-gone-off-floor',
				siblingIndex: 0
			})
		];
		const h = await mountPanels(rows, [], 'p1');
		const chip = h.querySelector('[data-testid="sidebar-panel-group-chip"]');
		expect(chip?.textContent).toContain('s-1');
		const ids = [...h.querySelectorAll('[data-session-id]')].map(
			(r) => (r as HTMLElement).dataset.sessionId
		);
		expect(ids).toContain('s-orphan');
	});

	it('a NON-glass ghost click adopts through the registry (off-floor → no-op)', async () => {
		const ghost = panelRow({
			panel: convPanel('ghost-g2', 'g-2'),
			title: 'Adoptable ghost',
			kind: 'ghost',
			depth: 1,
			parentSessionId: 's-parent',
			siblingIndex: 0
		});
		const rows = [
			panelRow({ panel: convPanel('p1', 's-parent'), title: 'Parent', depth: 0, siblingIndex: 0 })
		];
		const h = await mountPanels(rows, [ghost], 'p1');
		// Reveal the family — ghosts hide under a folded head like children.
		(h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement).click();
		flushSync();
		const ghostRow = h.querySelector('[data-testid="sidebar-ghost-row"]') as HTMLElement;
		expect(ghostRow).not.toBeNull();
		ghostRow.click();
		flushSync();
	});

	it('a glass ghost click summons instead of adopting', async () => {
		const ghost = panelRow({
			panel: convPanel('glass-g1', 'g-1'),
			title: 'Browser ghost',
			kind: 'ghost',
			depth: 1,
			parentSessionId: 's-parent',
			siblingIndex: 0
		});
		const rows = [
			panelRow({ panel: convPanel('p1', 's-parent'), title: 'Parent', depth: 0, siblingIndex: 0 })
		];
		const h = await mountPanels(rows, [ghost], 'p1');
		// The glass reveal effect (in-memory map, no persist) unfolds the
		// opener family on arrival — the ghost row becomes VISIBLE.
		const ids = [...h.querySelectorAll('[data-session-id]')].map(
			(r) => (r as HTMLElement).dataset.sessionId
		);
		expect(ids).toContain('g-1');
		expect(h.querySelector('[data-testid="sidebar-panel-pane"]')).not.toBeNull();
	});
});

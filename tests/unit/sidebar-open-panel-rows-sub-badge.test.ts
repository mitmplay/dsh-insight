/**
 * SidebarOpenPanelRows × Sub-Agent Parent Badge (ADR-0078 Amendment 1,
 * Wave 4 task 4.1-T) — the open-panel group pins: a PANEL row whose
 * session spawned 5 sub-agents renders the muted Bot pill with EXACT
 * text "5"; a ghost row never renders one (D1 — ghosts are the
 * children); a childless panel row renders none. Mounted through the
 * SidebarOpenPanels host exactly as sidebar-open-panel-rows-sch-badge
 * .test.ts does — the rows markup under test IS SidebarOpenPanelRows's
 * WorkspaceRowItem call sites, and the count derives from the
 * PRE-view-filter session list threaded from the host (never the
 * filtered list). Title strings untouched (D2); no behavior keys to the
 * badge (D3). Spec: dev/specs/2026-11/2026-11-23 - Sub-Agent Parent
 * Badge.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarOpenPanels from '../../src/lib/components/sidebar/session-open/SidebarSessionOpen.svelte';
import {
	setWorkspaceState,
	type PanelRow,
	type WorkspaceState
} from '../../src/lib/services/conversation/workspace-context.svelte';
import type { DsiConversationPanel, DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

const workspaces: DsiWorkspaceSummary[] = [];

const convPanel = (id: string, sessionId: string): DsiConversationPanel =>
	({ id, kind: 'conversation', sessionId, agentPreset: null, width: 420 }) as DsiConversationPanel;

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

/** A lineage summary row — origin-'subagent' child of `parent`. */
const subRow = (sessionId: string, parent: string): DsiSessionSummary =>
	({ sessionId, parentSessionId: parent, origin: 'subagent', title: sessionId }) as DsiSessionSummary;

let instance: Record<string, unknown> | null = null;

function mountWith(rows: PanelRow[], ghosts: PanelRow[] = [], sessions: DsiSessionSummary[] = []): HTMLElement {
	const state: WorkspaceState = {
		rows,
		ghosts,
		selectedPanelId: null,
		profile: null,
		select: vi.fn(),
		remove: vi.fn()
	};
	setWorkspaceState(state);
	const target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(SidebarOpenPanels, { target, props: { workspaces, sessions } });
	flushSync();
	return target;
}

function subBadgeIn(target: HTMLElement, rowTestid: string): Element | null {
	return target.querySelector(`[data-testid="${rowTestid}"] [data-testid="sidebar-sub-badge"]`);
}

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = null;
	}
	setWorkspaceState(null);
	document.body.innerHTML = '';
});

describe('sidebar-open-panel-rows — Sub-Agent Parent badge (ADR-0078 Amendment 1, 4.1-T)', () => {
	it('a panel row whose session has 5 sub-agent children renders the pill with EXACT text 5', () => {
		const kids = ['k1', 'k2', 'k3', 'k4', 'k5'].map((k) => subRow(k, 's-parent'));
		const target = mountWith(
			[panelRow({ panel: convPanel('p1', 's-parent'), title: 'Container Base' })],
			[],
			kids
		);
		const badge = subBadgeIn(target, 'sidebar-panel-row');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toBe('5');
		// D2: the title string is untouched — the pill is separate DOM.
		const row = target.querySelector('[data-testid="sidebar-panel-row"]');
		expect(row?.querySelector('.label')?.textContent).toBe('Container Base');
	});

	it('a childless panel row renders NO badge', () => {
		const target = mountWith(
			[panelRow({ panel: convPanel('p1', 's-plain'), title: 'Plain' })],
			[],
			[subRow('k1', 'someone-else')]
		);
		expect(subBadgeIn(target, 'sidebar-panel-row')).toBeNull();
	});

	it('a ghost row NEVER renders the badge (D1: ghosts are the children)', () => {
		const target = mountWith(
			[panelRow({ panel: convPanel('p1', 's-parent'), title: 'Head' })],
			[
				panelRow({
					panel: convPanel('ghost-1', 's-ghost'),
					title: 'Ghost child',
					kind: 'ghost',
					depth: 1,
					origin: 'subagent'
				})
			],
			[subRow('s-ghost', 's-parent'), subRow('k2', 's-parent')]
		);
		expect(subBadgeIn(target, 'sidebar-ghost-row')).toBeNull();
		// The parent panel row still carries its own honest count.
		expect(subBadgeIn(target, 'sidebar-panel-row')?.textContent).toBe('2');
	});
});

/**
 * SidebarOpenPanelRows × SCH badge (Scheduled Mark, task 2.2-T, ADR-0057
 * D2) — the panel-group pins: a scheduled PANEL row shows the muted pill
 * with the EXACT text SCH; ghost rows (subagent species) and an ordinary
 * panel row show none. Mounted through the SidebarOpenPanels host (the
 * app-sidebar pattern) exactly as sidebar-open-panels.test.ts does — the
 * rows markup under test IS SidebarOpenPanelRows's WorkspaceRowItem call
 * sites. Title strings untouched (D2); no behavior keys to the badge
 * (D3). Spec: dev/specs/2026-11/2026-11-10 - The Scheduled Mark.
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
import type { DsiConversationPanel, DsiWorkspaceSummary } from '../../src/lib/types';

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

let instance: Record<string, unknown> | null = null;

function mountWith(rows: PanelRow[], ghosts: PanelRow[] = []): HTMLElement {
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
	instance = mount(SidebarOpenPanels, { target, props: { workspaces } });
	flushSync();
	return target;
}

function badgeIn(target: HTMLElement, testid: string): Element | null {
	return target.querySelector(`[data-testid="${testid}"] [data-testid="sidebar-sch-badge"]`);
}

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = null;
	}
	setWorkspaceState(null);
	document.body.innerHTML = '';
});

describe('sidebar-open-panel-rows — SCH badge (Scheduled Mark 2.2-T)', () => {
	it('a scheduled panel row shows the badge with EXACT text SCH and keeps the title', () => {
		const target = mountWith([
			panelRow({ panel: convPanel('p1', 's-sched'), title: 'Nightly report', origin: 'scheduled' })
		]);
		const row = target.querySelector('[data-testid="sidebar-panel-row"]');
		expect(row).not.toBeNull();
		const badge = badgeIn(target, 'sidebar-panel-row');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toBe('SCH');
		expect(row?.querySelector('.label')?.textContent).toBe('Nightly report');
	});

	it('an ordinary panel row (origin null) shows NO badge', () => {
		const target = mountWith([
			panelRow({ panel: convPanel('p1', 's-plain'), title: 'Plain', origin: null })
		]);
		expect(badgeIn(target, 'sidebar-panel-row')).toBeNull();
	});

	it('a subagent-species panel row (origin subagent) shows NO badge', () => {
		const target = mountWith([
			panelRow({ panel: convPanel('p1', 's-kid'), title: 'Kid', origin: 'subagent' })
		]);
		expect(badgeIn(target, 'sidebar-panel-row')).toBeNull();
	});

	it('a ghost row shows NO badge even beside a scheduled sibling', () => {
		const target = mountWith(
			[panelRow({ panel: convPanel('p1', 's-sched'), title: 'Head', origin: 'scheduled' })],
			[
				panelRow({
					panel: convPanel('ghost-1', 's-ghost'),
					title: 'Ghost',
					kind: 'ghost',
					depth: 1,
					origin: null
				})
			]
		);
		expect(badgeIn(target, 'sidebar-ghost-row')).toBeNull();
		expect(badgeIn(target, 'sidebar-panel-row')).not.toBeNull();
	});
});

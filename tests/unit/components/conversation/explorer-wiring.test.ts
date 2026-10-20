/**
 * explorer-wiring tests (W3 task 3.2-T, Workspace Explorer ADR D4):
 *   - CLICK FIRES — the header chip chain (DisplayWorkspace →
 *     WorkspaceChip spread) forwards a plain click as the open-explorer
 *     intent; SessionIdAndName composes (sessionId, workspace) into it;
 *   - SIDEBAR UNTOUCHED — without an onOpenExplorer prop the chip is
 *     INERT (no click handler reaches the span): the sidebar surfaces
 *     (Workspaces pill, SessionFilterHeader) keep their menu-on-click
 *     behavior; the resolved Chip Menu ADR contradiction lands on the
 *     header-surface-only decision.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisplayWorkspace from '$lib/components/conversation/header/DisplayWorkspace.svelte';
import SessionIdAndName from '$lib/components/conversation/header/SessionIdAndName.svelte';
import { findWorkspaceExplorerPanel, findWorkspaceFilePanel, workspaceFileSlot } from '$lib/services/panels/panel-placement';
import type { DsiPanelEntry, DsiWorkspaceSummary } from '$lib/types';

const workspaces: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w1', title: 'Harness', path: '/Users/wharsojo/agentic-ai/deepseek-harness', sessionIds: ['s1'] }
];

function mountDisplay(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DisplayWorkspace, { target, props: { workspace: '/ws/a', workspaces: [], ...props } });
	flushSync();
	return { target, instance, cleanup: () => { unmount(instance); target.remove(); } };
}

function chipOf(target: HTMLElement): HTMLElement {
	return target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!;
}

describe('DisplayWorkspace — click fires (3.2-T)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('a plain chip click fires the open-explorer intent', () => {
		const onOpenExplorer = vi.fn();
		const view = mountDisplay({ onOpenExplorer });
		chipOf(view.target).click();
		flushSync();
		expect(onOpenExplorer).toHaveBeenCalledTimes(1);
		view.cleanup();
	});

	it('without the prop the chip is INERT — no handler reaches the span (sidebar untouched)', () => {
		const view = mountDisplay();
		const chip = chipOf(view.target);
		expect(chip.onclick).toBeNull();
		expect(() => {
			chip.click();
			flushSync();
		}).not.toThrow();
		view.cleanup();
	});
});

describe('SessionIdAndName — the composed intent (3.2-T)', () => {
	it('binds (sessionId, workspace) into the click and stays inert without it', () => {
		const onOpenExplorer = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(SessionIdAndName, {
			target,
			props: {
				sessionId: 's-1',
				title: 'T',
				initialTitle: null,
				workspace: '/ws/a',
				workspaces,
				onOpenExplorer
			}
		});
		flushSync();
		target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!.click();
		flushSync();
		expect(onOpenExplorer).toHaveBeenCalledWith('s-1', '/ws/a');
		unmount(instance);
		target.remove();

		// No workspace → no chip at all (DisplayWorkspace renders nothing),
		// so the intent can never fire half-bound.
		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		const instance2 = mount(SessionIdAndName, {
			target: target2,
			props: { sessionId: 's-1', title: 'T', initialTitle: null, workspace: null, onOpenExplorer }
		});
		flushSync();
		expect(target2.querySelector('[data-testid="session-workspace"]')).toBeNull();
		unmount(instance2);
		target2.remove();
	});
});

// ── Workspace Explorer W4 4.2-T — the floor's file actions: the page
// composes EXACTLY these pure steps (openWorkspaceFile) — dedupe by the
// (sessionId, path) pair, the slot below its explorer by panel id, and
// the focused-slot fallback when the explorer is closed. The composed
// journey is pinned end-to-end by the e2e spec (part 2). ──

describe('floor file actions (4.2-T)', () => {
	it('the composed dedupe: find-then-focus prevents a second file panel', () => {
		const panels: DsiPanelEntry[] = [
			{ id: 'w1', kind: 'workspace-explorer', sessionId: 's1', root: '/ws', expanded: [], width: 600 },
			{ id: 'f1', kind: 'workspace-file', sessionId: 's1', path: 'README.md', explorerPanelId: 'w1', width: 600 }
		];
		// The action's guard: an open panel with the pair → focus, no insert.
		const open = findWorkspaceFilePanel(panels, 's1', 'README.md');
		expect(open?.id).toBe('f1');
	});

	it('the composed slot: a fresh file lands BELOW its explorer (by panel id)', () => {
		const panels: DsiPanelEntry[] = [
			{ id: 'w1', kind: 'workspace-explorer', sessionId: 's1', root: '/ws', expanded: [], width: 600 }
		];
		// Shared Tree D1: the explorer lookup is ROOT-keyed across sessions.
		const explorer = findWorkspaceExplorerPanel(panels, '/ws');
		// workspaceFileSlot matched the EXPLORER PANEL id — even when the
		// explorer's conversation panel is closed.
		expect(workspaceFileSlot(panels, explorer!.id, 99)).toBe(1);
	});

	it('the composed fallback: a closed explorer falls to the focused slot', () => {
		expect(workspaceFileSlot([{ id: 'p1', kind: 'prompt-manager', width: 600 }], 'w-gone', 5)).toBe(5);
	});
});

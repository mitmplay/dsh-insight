<script lang="ts">
	/**
	 * WorkspaceExplorerToolbar — the explorer's full-width toolbar (Git Eye
	 * ADR 2026-09-12 D4/D5): an in-flow flex row — the FIRST child of
	 * .explorer, full width, left-aligned — with the tree scrolling in its
	 * own box below. The Explorer/Changes tab strip is UNCONDITIONAL
	 * (The Always Tabs ADR 2026-09-16 D1): it renders on every desk from
	 * FIRST PAINT — seeing is never writing, so no probe gates a read
	 * affordance. Explorer is the remount default — the panel owns the
	 * state. The action cluster (Refresh / Collapse-all / column capture)
	 * lives in WorkspaceExplorerButtons (extracted 2026-09-13) — intent
	 * only. Refresh and Collapse-all stay reachable while the tree scrolls.
	 * INTENT ONLY (Module Communication Map): buttons emit onRefresh /
	 * onCollapseAll / onTabChange — the panel and the floor owner own the
	 * state the intents act on. The workspace title and the full-path copy
	 * live in the column's PanelHeader, not here.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import WorkspaceExplorerButtons from './WorkspaceExplorerButtons.svelte';

	// The canvas-copy capture target: the owning PanelColumn. The toolbar
	// is a deeply nested child of the column, and the column element is
	// page-owned (the route's PanelColumn), so the toolbar walks UP from
	// its own root to the nearest ancestor carrying the column's
	// data-testid marker — no new prop threading through
	// WorkspaceExplorerPanel just to name an ancestor. (Layout-independent:
	// survived the overlay → in-flow move unchanged.)
	let headEl = $state<HTMLDivElement>();
	let columnEl = $state<HTMLElement | null>(null);
	$effect.pre(() => {
		columnEl = null;
		let el: HTMLElement | null = headEl ?? null;
		while (el) {
			if (el.dataset.testid === 'panel-column') {
				columnEl = el;
				break;
			}
			el = el.parentElement;
		}
	});

	let {
		onRefresh,
		onCollapseAll,
		activeTab = 'explorer',
		onTabChange
	}: {
		/** Refresh intent — the panel re-fetches its levels and re-probes. */
		onRefresh: () => void;
		/** Collapse-all intent — the owner empties the expanded list. */
		onCollapseAll: () => void;
		/** Which tab is active — the PANEL owns this state (remount ⇒ explorer). */
		activeTab?: 'explorer' | 'changes';
		/** Tab-switch intent — the panel swaps the view below the toolbar. */
		onTabChange?: (tab: 'explorer' | 'changes') => void;
	} = $props();
</script>

<div class="explorer-toolbar" bind:this={headEl} data-testid="explorer-toolbar">
	<div class="tabs" role="tablist" data-testid="explorer-tabs">
		<button
			role="tab"
			class="tab"
			class:active={activeTab === 'explorer'}
			aria-selected={activeTab === 'explorer'}
			data-testid="git-tab-explorer"
			onclick={() => onTabChange?.('explorer')}
		>
			{t(m.gitEyeTabExplorer)}
		</button>
		<button
			role="tab"
			class="tab"
			class:active={activeTab === 'changes'}
			aria-selected={activeTab === 'changes'}
			data-testid="git-tab-changes"
			onclick={() => onTabChange?.('changes')}
		>
			{t(m.gitEyeTabChanges)}
		</button>
	</div>
	<WorkspaceExplorerButtons {onRefresh} {onCollapseAll} />
</div>

<style>
	/* In-flow toolbar lane (Git Eye D4): the FIRST row of .explorer, the
	   full width, left-aligned — the two-tab surface needs a lane; the
	   tree-scroll box below keeps its own scroll. */
	.explorer-toolbar {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.25rem;
		width: 100%;
		flex-shrink: 0;
		background: var(--color-surface-primary, var(--color-surface-elevated));
	}
	.tabs {
		display: inline-flex;
		align-items: center;
		/* Same gap as the toolbar row: flex gap does not inherit, so the
		   tab chips restate it (2026-10-27 operator request — uniform
		   gaps and heights across the explorer toolbar). */
		gap: 0.25rem;
		margin-right: 0.375rem;
	}
	.tab {
		/* One uniform control height for the whole toolbar row — the tab
		   chips and the action buttons share it (2026-10-27 operator
		   request). */
		height: 1.5rem;
		display: inline-flex;
		align-items: center;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		font: inherit;
		font-size: 0.75rem;
		padding: 0 0.4rem;
		cursor: pointer;
	}
	.tab.active {
		border-color: var(--color-border, #d0d7de);
		background: var(--color-surface-secondary, #f1f3f5);
		color: var(--color-text-primary, #212529);
		font-weight: 600;
	}
</style>

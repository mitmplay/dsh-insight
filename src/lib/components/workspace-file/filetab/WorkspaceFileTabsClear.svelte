<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * WorkspaceFileTabsClear — the sticky clear control at the strip's
	 * right edge (extracted from WorkspaceFileTabs; ADR 2026-09-17 D3/D5,
	 * D5c amendment 2026-11-03). Owns the blanket-confirm popover: one
	 * local open flag; Esc and an outside click both land on Cancel
	 * (nothing is cleared). The verbs emit the onClear intent and close —
	 * the PANEL resolves scope.
	 *
	 * PRESENTATION ONLY: no tab list, no fetching — a single intent
	 * callback leaves.
	 */

	let {
		onClear
	}: {
		/** Clear intent with scope (ADR D5c amendment 2026-11-03; 'other'
		 *  added 2026-11-13) — 'all' closes every tab, 'non-dirty' keeps
		 *  dirty drafts, 'other' keeps the active tab. */
		onClear: (scope: 'all' | 'non-dirty' | 'other') => void;
	} = $props();

	function clear(scope: 'all' | 'non-dirty' | 'other'): void {
		clearOpen = false;
		onClear(scope);
	}
	function onClearKeydown(e: KeyboardEvent): void {
		if (clearOpen && e.key === 'Escape') clearOpen = false;
	}
	// Plain window listener (not svelte:window): the jsdom test harness
	// dispatches on window directly and the plain listener is the contract
	// both the browser and the tests observe.
	$effect(() => {
		window.addEventListener('keydown', onClearKeydown);
		return () => window.removeEventListener('keydown', onClearKeydown);
	});

	let clearOpen = $state(false);
</script>

<div class="clear-slot" data-testid="workspace-file-tabstrip-clear-slot">
	<button
		type="button"
		class="clear-btn"
		data-testid="workspace-file-tabstrip-clear"
		aria-label={t(m.workspaceFileTabsClear)}
		title={t(m.workspaceFileTabsClear)}
		aria-expanded={clearOpen}
		onclick={() => (clearOpen = !clearOpen)}
	>×</button>
	{#if clearOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span class="backdrop" onclick={() => (clearOpen = false)}></span>
		<div class="clear-pop" data-testid="workspace-file-tabstrip-clear-pop" role="menu">
			<button type="button" role="menuitem" data-testid="workspace-file-tabstrip-clear-all" onclick={() => clear('all')}>
				{t(m.workspaceFileTabsClearAll)}
			</button>
			<button type="button" role="menuitem" data-testid="workspace-file-tabstrip-clear-other" onclick={() => clear('other')}>
				{t(m.workspaceFileTabsClearOther)}
			</button>
			<button type="button" role="menuitem" data-testid="workspace-file-tabstrip-clear-nondirty" onclick={() => clear('non-dirty')}>
				{t(m.workspaceFileTabsClearNonDirty)}
			</button>
		</div>
	{/if}
</div>

<style>
	/* The sticky clear: fixed-width slot after the scroller; the popover
	   anchors under it. Same chip grammar as the toolbar's controls. */
	.clear-slot {
		position: relative;
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		padding: 2px 4px 0;
	}
	.clear-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 1px solid var(--color-border, #ddd);
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		background: transparent;
		font-size: 0.8rem;
		line-height: 1;
		color: var(--color-text-muted, #888);
		cursor: pointer;
	}
	.clear-btn:hover {
		background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
		color: var(--color-text-primary);
	}
	/* The invisible click-catcher: any click outside the popover = Cancel. */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.clear-pop {
		position: absolute;
		top: 100%;
		right: 4px;
		z-index: 41;
		display: flex;
		flex-direction: column;
		min-width: 11rem;
		border: 1px solid var(--color-border, #ddd);
		border-radius: 6px;
		background: var(--color-surface-elevated, #fff);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		overflow: hidden;
	}
	.clear-pop button {
		text-align: left;
		padding: 5px 10px;
		border: none;
		background: transparent;
		font-size: 0.75rem;
		color: var(--color-text-primary);
		cursor: pointer;
		white-space: nowrap;
	}
	.clear-pop button:hover {
		background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
	}
</style>

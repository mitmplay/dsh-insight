<script lang="ts">
	/**
	 * WorkspaceExplorerButtons — the toolbar's action cluster, extracted
	 * from WorkspaceExplorerToolbar (2026-09-13): Refresh and
	 * Collapse-all. INTENT ONLY (Module
	 * Communication Map): the buttons emit onRefresh / onCollapseAll —
	 * the panel owns the state the intents act on.
	 */
	import { ChevronsDownUp, RefreshCw } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		onRefresh,
		onCollapseAll
	}: {
		/** Refresh intent — the panel re-fetches its levels and re-probes. */
		onRefresh: () => void;
		/** Collapse-all intent — the owner empties the expanded list. */
		onCollapseAll: () => void;
	} = $props();
</script>

	<div class="actions">
		<button
			class="head-btn"
			data-testid="explorer-refresh"
			aria-label={t(m.refresh)}
			title={t(m.refresh)}
			onclick={onRefresh}
		>
			<RefreshCw size={12} aria-hidden="true" />
		</button>
		<button
			class="head-btn"
			data-testid="explorer-collapse-all"
			aria-label={t(m.collapseAll)}
			title={t(m.collapseAll)}
			onclick={onCollapseAll}
		>
			<ChevronsDownUp size={12} aria-hidden="true" />
		</button>
	</div>

<style>
	/* Right-aligned cluster (user, 2026-09-13): the toolbar is a flex row
	   with the tab strip leading — margin-left: auto pushes the action
	   buttons to the far edge without touching the tabs. */
	.actions {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.head-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
	}
	.head-btn:hover,
	.head-btn:focus-visible {
		background: var(--color-surface-secondary, #f1f3f5);
		color: var(--color-text-primary, #212529);
	}
</style>

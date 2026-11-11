<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { ChevronDown } from '@lucide/svelte';

	/**
	 * RowButtonMoveDown â the panel row's move-down chevron (extracted
	 * from SidebarOpenPanels, 2026-08-27): reorders the panel one
	 * slot down the floor via the registry (the vertical twin of the
	 * panel header's left/right chevrons). Hidden at the list's BOTTOM
	 * edge â the row list IS the floor order â the host computes `can`
	 * (row.canMoveDown ?? floor-index fallback) and `can === false`
	 * renders nothing.
	 *
	 * FRAGMENT BY DESIGN: the button IS the root and ships no styles
	 * here — the host's :global `.row-btn` rules (base, paneled
	 * violet, dead red) reach it under the local row ancestors.
	 */
	let {
		can,
		onmove
	}: {
		/** Whether the panel can move down; false renders nothing. */
		can: boolean;
		/** Move invocation â the host moves the panel one slot down. */
		onmove: () => void;
	} = $props();
</script>

{#if can}
	<button
		type="button"
		class="row-btn move"
		data-testid="sidebar-panel-move-down"
		aria-label={t(m.movePanelDown)}
		title={t(m.movePanelDown)}
		onclick={(e) => {
			e.stopPropagation();
			onmove();
		}}
	>
		<ChevronDown size={12} aria-hidden="true" />
	</button>
{/if}

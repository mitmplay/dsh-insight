<script lang="ts">
	import { SquareChevronRight, SquareChevronDown } from '@lucide/svelte';

	/**
	 * RowButtonFold — the panel row's children fold chevron (extracted
	 * from SidebarOpenPanels, 2026-08-27): collapses a session's
	 * WHOLE child subtree — child panels and ghosts alike (no
	 * discrimination by panel-ness, 2026-08-28), pure visibility (the
	 * interleaved order never shuffles). DEFAULT FOLDED: children ship
	 * hidden; this chevron reveals them. The one exception is the
	 * host's fold-on-add (2026-09-02): a panel ADDED while the list is
	 * mounted starts UNFOLDED — the host passes `folded={false}` for it.
	 * Carries the honest count in
	 * both label and title — `Show/Hide <clusterCount> spawned
	 * sessions` — and `aria-expanded` tracks the open state. The host
	 * computes the count (every descendant row that hides) and owns the
	 * fold CHOICE (keyed by session id, so re-adopting panels keep it);
	 * this button only stops the row's select click and fires
	 * `ontoggle`.
	 *
	 * FRAGMENT BY DESIGN: the button IS the root and ships no styles
	 * here — the host's :global `.row-btn` rules (base, paneled
	 * violet, dead red) reach it under the local row ancestors.
	 */
	let {
		clusterCount,
		folded,
		ontoggle
	}: {
		/** The session's descendant count — every row that hides on fold;
		 *  0 renders nothing (no children, no chevron). */
		clusterCount: number;
		/** Whether the session's child subtree is folded. */
		folded: boolean;
		/** Toggle invocation — the host flips its fold state. */
		ontoggle: () => void;
	} = $props();
</script>

{#if clusterCount > 0}
	<button
		type="button"
		class="row-btn fold"
		data-testid="sidebar-panel-fold"
		aria-expanded={!folded}
		aria-label={folded
			? `Show ${clusterCount} spawned sessions`
			: `Hide ${clusterCount} spawned sessions`}
		title={folded
			? `Show ${clusterCount} spawned sessions`
			: `Hide ${clusterCount} spawned sessions`}
		onclick={(e) => {
			e.stopPropagation();
			ontoggle();
		}}
	>
		{#if folded}<SquareChevronRight size={12} aria-hidden="true" />{:else}<SquareChevronDown size={12} aria-hidden="true" />{/if}
	</button>
{/if}

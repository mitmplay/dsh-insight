<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	/**
	 * OpenBrowserButton — the conversation header's browser chip
	 * (extracted from ConversationHeader, 2026-10-20): the singleton
	 * browser panel's opener (The Glass Browser spec W2). Presentational
	 * like its header siblings — the click intent reports upward through
	 * the onOpenBrowser prop; the floor owns the actual open.
	 *
	 * Hidden entirely when no handler is passed — a host surface without
	 * a browser floor renders no chip.
	 */
	let {
		onOpenBrowser
	}: {
		/** Browser-chip click intent — the singleton browser panel's
		 *  opener; absent hides the chip. */
		onOpenBrowser: () => void;
	} = $props();
</script>

<button
	type="button"
	class="rounded border border-surface-border px-1.5 py-0.5 text-xs hover:bg-surface-active"
	data-testid="open-browser"
	title={m.browserOpenTitle()}
	onclick={onOpenBrowser}
>{m.browserChipLabel()}</button>

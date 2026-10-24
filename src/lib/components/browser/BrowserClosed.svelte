<!--
	BrowserClosed — the header's CLOSE (🗑) button, extracted from
	BrowserHeader. Amendment 1 (Glass Close Ladder ADR 2026-10-24, operator
	ruling): the header verb is a FULL CLOSE — the same as a close-panel:
	the route kills the Playwright browser (wire close) AND removes the
	panel from the floor. The old fold (ADR-0037 D1) is retired for this
	surface. Dumb seam: reports the kill intent upward (ADR-0031 D8 — the
	panel/route performs the actual close); disabled while the panel
	mirrors a closing session.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let {
		/** Double-invocation guard mirrored from the panel while closing. */
		closing = false,
		/** Kill intent click (D8): the panel reports upward; the route
		 *  performs the wire close + panel removal. */
		onclose
	}: {
		closing?: boolean;
		onclose?: () => void;
	} = $props();
</script>

<button
	class="rounded hover:bg-surface-active"
	data-testid="browse-close"
	aria-label={m.browserCloseDelete()}
	title={m.browserCloseDelete()}
	disabled={closing}
	onclick={() => onclose?.()}
>
	<!-- trashbin: the verb is DELETE, not hide (Amendment 1) -->
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="red"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M3 6h18" />
		<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
		<path d="M10 11v6" />
		<path d="M14 11v6" />
	</svg>
</button>
<style>
	button {
		display: inline-flex;
		align-items: center;
	}
</style>

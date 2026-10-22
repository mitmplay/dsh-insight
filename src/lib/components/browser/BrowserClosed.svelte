<!--
	BrowserClosed — the header's close (✕) button, extracted from
	BrowserHeader. Dumb seam: reports the owner-release click upward
	(ADR-0031 D8 — the panel performs the actual close); disabled while
	the panel mirrors a closing session.
-->
<script lang="ts">
	let {
		/** Double-invocation guard mirrored from the panel while closing. */
		closing = false,
		/** Owner-release click (D8): the panel performs the actual close. */
		onclose
	}: {
		closing?: boolean;
		onclose?: () => void;
	} = $props();
</script>

<button
	class="rounded px-1 hover:bg-surface-active"
	data-testid="browse-close"
	disabled={closing}
	onclick={() => onclose?.()}
>✕</button>

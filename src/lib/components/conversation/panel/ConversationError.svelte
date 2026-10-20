<script lang="ts">
	import type { UiError } from '$lib/services/conversation/store.svelte';

	/**
	 * ConversationError — the transcript-top error banner (extracted from
	 * ConversationPanel, 2026-08-27): every non-attachment submit failure
	 * (agent-busy, transport, load errors) reports here, message verbatim;
	 * attachment refusals render at the composer instead (BC-A3 — one home
	 * per error, the drafts they rejected sit right there). Presentational:
	 * the banner hides while `error` is null.
	 */
	let {
		error
	}: {
		/** The panel's top-facing error (the store-error split); null renders nothing. */
		error: UiError | null;
	} = $props();
</script>

{#if error !== null}
	<div
		data-testid="conversation-error"
		class="border-b border-status-pending/30 bg-status-pending/10 px-4 py-2 text-sm text-status-pending"
	>
		{error.message}
	</div>
{/if}

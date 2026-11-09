<script lang="ts">
	/**
	 * MarkdownPanel — the .md member's read surface (The Loadinjected ADR
	 * D1): the transcript's own markdown renderer over the LOGGED payload.
	 * A thin wrapper — MarkdownContent is REUSED unchanged (BC-12: the
	 * byte-exact surface stays the transcript's chips; here prose may
	 * reflow, the accepted give-up).
	 */
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

	let {
		content,
		allowHtml = false
	}: {
		/** The logged document text (never a live-file read). */
		content: string;
		/** Preview HTML Allow-List (ADR-0055 D4): the FILE preview surface
		 *  declares trust at its host — the read-tab file preview passes true;
		 *  transcript/logged-payload hosts keep the default false (strict
		 *  BC-12 output). */
		allowHtml?: boolean;
	} = $props();
</script>

<div class="markdown-panel" data-testid="markdown-panel">
	<MarkdownContent {content} {allowHtml} />
</div>

<style>
	.markdown-panel {
		height: 100%;
		overflow: auto;
		padding: 1rem 1.25rem;
	}
</style>

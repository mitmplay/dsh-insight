<!--
	CopyButton — copy-to-clipboard icon button with 2s ✓ feedback (OCI port,
	2026-08-22). Presentational: takes a string value, delegates the write
	to copyWithFeedback; onclick prop lets hosts chain extra behavior.

	KISS refactor (2026-11-26): the per-surface inline copy buttons
	(panel-header-copy-id, agent-chip-copy-id,
	conversation-header-copy-path) now render THROUGH this component —
	testid/ariaLabel props keep their pinned automation names.
-->
<script lang="ts">
	import { Copy, Check } from '@lucide/svelte';
	import { copyWithFeedback } from '$lib/utils/clipboard';

	let {
		value,
		title = 'Copy',
		/** Accessible name — defaults to the title. */
		ariaLabel,
		/** Testid override — e2e/page tests pin per-surface names
		 *  (panel-header-copy-id, agent-chip-copy-id, …). */
		testid = 'copy-text-button',
		size = 12,
		class: className = '',
		onclick
	}: {
		value: string;
		title?: string;
		ariaLabel?: string;
		testid?: string;
		size?: number;
		class?: string;
		onclick?: (e: MouseEvent) => void;
	} = $props();

	let copied = $state(false);
</script>

<button
	type="button"
	class="{className}"
	{title}
	aria-label={ariaLabel ?? title}
	data-testid={testid}
	onclick={async (e) => {
		e.stopPropagation();
		if (onclick) onclick(e);
		await copyWithFeedback(value, (v) => (copied = v));
	}}
>
	{#if copied}
		<Check {size} class="text-status-pass" />
	{:else}
		<Copy {size} />
	{/if}
</button>

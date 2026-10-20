<script lang="ts">
	/**
	 * TitleHost — test fixture feeding ConversationPanel a REACTIVE title
	 * prop (2026-08-24 live-title-healing tests): runes props flow parent
	 * → child, and the mount instance cannot write them, so the healing
	 * tests drive the prop through this host the same way the page does
	 * (title={panelTitleFor(...)} re-renders on every spine tick).
	 */
	import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
	import type { DsiEntry } from '$lib/types';

	let {
		sessionId,
		title: seedTitle = null,
		agent = null,
		entries = [],
		lastSeq = -1,
		running = false
	}: {
		sessionId: string;
		title?: string | null;
		agent?: string | null;
		entries?: DsiEntry[];
		lastSeq?: number;
		running?: boolean;
	} = $props();

	// Intentional initial capture: the seed is an init-time fact.
	// svelte-ignore state_referenced_locally
	let title = $state<string | null>(seedTitle);

	/** Test handle: flip the external title like a spine refresh would. */
	export function setExternalTitle(next: string | null): void {
		title = next;
	}
</script>

<ConversationPanel {sessionId} {title} {agent} {entries} {lastSeq} {running} />

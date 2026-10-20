<script lang="ts">
	/**
	 * A2aRowsHost — test fixture feeding ConversationPanel REACTIVE a2aRows
	 * props (Task 4.2-T): the page updates rows on every spine tick; runes
	 * props flow parent→child, and the mount instance cannot write them, so
	 * the live-update test drives the prop through this host the same way
	 * the page does (a2aRows={a2aRowsFor(...)} re-renders each tick).
	 */
	import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
	import type { DsiA2aExchangeView } from '$lib/types';

	let {
		a2aRows = [],
		a2aTitles = {}
	}: {
		a2aRows?: DsiA2aExchangeView[];
		a2aTitles?: Record<string, string | null>;
	} = $props();

	// Intentional initial capture: the seed is an init-time fact.
	// svelte-ignore state_referenced_locally
	let rows = $state<DsiA2aExchangeView[]>(a2aRows);

	/** Test handle: replace the rows like a spine refresh would. */
	export function setRows(next: DsiA2aExchangeView[]): void {
		rows = next;
	}
</script>

<ConversationPanel
	sessionId="session-sender"
	agent={null}
	entries={[]}
	lastSeq={-1}
	running={false}
	{a2aTitles}
	a2aRows={rows}
/>

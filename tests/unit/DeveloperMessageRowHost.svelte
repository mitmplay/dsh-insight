<script lang="ts">
	// ADR-0027b task 2.2-T: mounts the REAL ConversationScrollArea branch
	// for a developer-message group, fed exactly the way the page does
	// (entries in, groupTurns over them, groups handed down page-owned).
	import ConversationScrollArea from '$lib/components/conversation/panel/ConversationScrollArea.svelte';
	import { groupTurns } from '$lib/utils/turn-grouping';
	import type { DsiEntry } from '$lib/types';

	let { entries }: { entries: DsiEntry[] } = $props();
	const groups = $derived(groupTurns(entries));
</script>

<div style="height: 400px; position: relative;">
	<ConversationScrollArea
		entries={entries}
		groups={groups}
		hasMore={false}
		loadingOlder={false}
		olderError={null}
		onloadolder={() => {}}
		openChipId={null}
		ontogglechip={() => {}}
		peekOpenRunKey={null}
		ontogglepeek={() => {}}
		pendingCards={[]}
		settledCards={[]}
		onanswer={() => {}}
		sessionId="test-session"
	/>
</div>

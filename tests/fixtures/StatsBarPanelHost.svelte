<script lang="ts">
	/**
	 * StatsBarPanelHost — test fixture mounting the REAL ConversationPanel
	 * with seeded entries and a subagent switch (spec task 3.1-T): asserts
	 * the stats bar's fence placement — above composer-area on agent
	 * panels, bottom in-flow row on sub-agent panels (ADR "The Stats
	 * Bar" D4). Same pattern as A2aRowsHost.
	 */
	import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
	import type { DsiEntry } from '../../src/lib/types';

	let { entries = [], subagent = false }: { entries?: DsiEntry[]; subagent?: boolean } = $props();
</script>

<ConversationPanel
	sessionId="session-stats"
	agent={null}
	{entries}
	lastSeq={-1}
	running={false}
	{subagent}
/>

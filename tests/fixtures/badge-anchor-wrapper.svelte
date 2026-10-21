<script lang="ts">
	/**
	 * Test fixture (badge-watch-anchor) — hosts a keyed each of badge rows
	 * and lets the test swap the list for FRESH objects with the same ids,
	 * reproducing the tick's fresh-proxy rebuild (ADR-0033 D1).
	 */
	import RowJobBadge from '../../src/lib/components/sessions/RowJobBadge.svelte';

	let { initial = [] }: { initial: { sessionId: string }[] } = $props();
	let items = $state<{ sessionId: string }[]>(initial);

	export function setList(next: { sessionId: string }[]): void {
		items = next;
	}
</script>

{#each items as s (s.sessionId)}
	<RowJobBadge sessionId={s.sessionId} />
{/each}

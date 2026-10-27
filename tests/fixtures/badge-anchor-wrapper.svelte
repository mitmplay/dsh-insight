<script lang="ts">
	/**
	 * Test fixture (badge-watch-anchor) — hosts a keyed each of badge rows
	 * and lets the test swap the list for FRESH objects with the same ids,
	 * reproducing the tick's fresh-proxy rebuild (ADR-0033 D1).
	 */
	import RowJobBadge from '../../src/lib/components/sessions/RowJobBadge.svelte';

	let { initial = [] }: { initial: { sessionId: string }[] } = $props();
	// Override state + $derived: the prop is read reactively (no
	// state_referenced_locally initial-capture), setList wins once called.
	let override = $state<{ sessionId: string }[] | undefined>(undefined);
	let items = $derived(override ?? initial);

	export function setList(next: { sessionId: string }[]): void {
		override = next;
	}
</script>

{#each items as s (s.sessionId)}
	<RowJobBadge sessionId={s.sessionId} />
{/each}

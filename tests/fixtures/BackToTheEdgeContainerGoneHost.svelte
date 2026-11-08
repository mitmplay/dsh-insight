<script lang="ts">
	/**
	 * BackToTheEdgeButton host whose scroll container PROP detaches after
	 * mount (an owner may tear the pane down without unmounting the
	 * button): the effect's !el arm returns early, overflowed keeps its
	 * last true value, so the button stays visible and a click reaches
	 * jump()'s `if (!container) return` guard — the only path into
	 * that arm.
	 */
	import BackToTheEdgeButton from '$lib/components/common/buttons/BackToTheEdgeButton.svelte';

	let el: HTMLDivElement | undefined = $state();
	let gone = $state(false);
</script>

<div bind:this={el} data-testid="bte-scroll" style="height: 100px; overflow: auto">
	<div style="height: 1000px"></div>
</div>

<BackToTheEdgeButton container={gone ? undefined : el} threshold={10} />

<button data-testid="bte-detach" onclick={() => (gone = true)}>detach</button>

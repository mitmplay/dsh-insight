<!--
	PanelListboxList — the internally-scrolling list pane of the family
	(ADR-0070, R8, D8): flex 1 1 auto + min-height 0 + overflow-y auto.
	The OUTER pane sizing — including any consumer cap (DSI's 50%) — stays
	the consumer's wrapper; this organ owns ONLY its internal scroll
	grammar.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		testid = 'panel-listbox-list',
		id,
		class: className = ''
	}: {
		children?: Snippet;
		testid?: string;
		id?: string;
		class?: string;
	} = $props();
</script>

<div class="panel-listbox-list {className}" data-testid={testid} {id}>
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.panel-listbox-list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
</style>

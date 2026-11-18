<!--
	PanelListbox — the group box + collapse wiring of the listbox family
	(ADR-0070, R8). Presentational only (D1): every fact arrives as a prop,
	every action reports back up. Zero rows + absent emptysnippet renders
	NOTHING (D7 — the whole group vanishes, DSI's no-pane-at-all behavior).
	Box dressing reads --panel-listbox-* custom properties with neutral
	defaults (D5); testid injectable with a neutral default (D6).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		collapsed = false,
		onToggle,
		count = 0,
		emptysnippet,
		header,
		children,
		testid = 'panel-listbox',
		class: className = ''
	}: {
		collapsed?: boolean;
		onToggle?: () => void;
		count?: number;
		emptysnippet?: Snippet;
		header?: Snippet;
		children?: Snippet;
		testid?: string;
		class?: string;
	} = $props();
</script>

{#if count > 0 || emptysnippet}
	<div
		class="panel-listbox {className}"
		class:is-collapsed={collapsed}
		data-testid={testid}
		data-collapsed={collapsed}
	>
		{#if header}
			{@render header()}
		{/if}
		{#if !collapsed && children}
			{@render children()}
		{/if}
		{#if count === 0 && emptysnippet && !collapsed}
			{@render emptysnippet()}
		{/if}
	</div>
{/if}

<style>
	.panel-listbox {
		display: flex;
		flex-direction: column;
		/* the neutral defaults live in theme/tokens.css (D5 — the token
		   set owns them; the component ships no skin) */
		background: var(--panel-listbox-wash);
		border: 1px solid var(--panel-listbox-border);
		border-radius: var(--panel-listbox-radius);
		overflow: hidden;
	}
</style>

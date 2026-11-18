<!--
	PanelListboxListItem — the selectable row shell of the family
	(ADR-0070, R8, D4): selected/hover/focus grammar + onselect + a content
	snippet passthrough. NEVER a verb set — close/move/fold stay in the
	consumer's row interior. linked (D2): when false the row ignores the
	selection fact entirely (no emphasis, no reported selected state);
	when true the emphasis follows the consumer-provided selected prop —
	the consumer owns the selectedId write-through in BOTH directions.
	R9 href (ADR-0071, D2): three renderings of ONE grammar —
	href present → an ANCHOR that STILL fires onselect (the consumer
	decides preventDefault on handled clicks, e.g. the shelf's
	registry click-through); onselect without href → a button;
	neither → an INERT element with no click handler at all.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		selected = false,
		linked = false,
		href,
		onselect,
		testid,
		class: className = '',
		children
	}: {
		selected?: boolean;
		linked?: boolean;
		/** Present → the row renders an anchor (that still fires onselect). */
		href?: string;
		/** The click event forwards so the consumer may preventDefault a handled
		 *  anchor click (the shelf's registry click-through, ADR-0071 D2). */
		onselect?: (event: MouseEvent) => void;
		testid?: string;
		class?: string;
		children?: Snippet;
	} = $props();

	const active = $derived(linked && selected);
	const inert = $derived(href === undefined && onselect === undefined);
</script>

{#if href !== undefined}
	<!-- the href spreads through: it is a consumer-supplied opaque
	string (DSI's seed deep links), not a route id — resolve() would
	import SvelteKit into the base, which D1 forbids -->
	<a
		class="panel-listbox-item {className}"
		class:is-active={active}
		aria-current={active ? 'true' : undefined}
		data-testid={testid}
		data-selected={linked ? selected : undefined}
		{...{ href }}
		onclick={(event) => onselect?.(event)}
	>
		{#if children}
			{@render children()}
		{/if}
	</a>
{:else if inert}
	<div
		class="panel-listbox-item {className}"
		class:is-active={active}
		aria-current={active ? 'true' : undefined}
		data-testid={testid}
		data-selected={linked ? selected : undefined}
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
{:else}
	<button
		type="button"
		class="panel-listbox-item {className}"
		class:is-active={active}
		aria-current={active ? 'true' : undefined}
		data-testid={testid}
		data-selected={linked ? selected : undefined}
		onclick={(event) => onselect?.(event)}
	>
		{#if children}
			{@render children()}
		{/if}
	</button>
{/if}

<style>
	.panel-listbox-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 4px 8px;
		border: none;
		background: none;
		text-align: left;
		font: inherit;
		font-size: 12px;
		color: inherit;
		text-decoration: none;
		cursor: pointer;
		min-width: 0;
	}
	.panel-listbox-item:hover {
		background: var(--panel-listbox-item-hover);
	}
	.panel-listbox-item.is-active {
		background: var(--panel-listbox-item-active);
		font-weight: 600;
	}
	.panel-listbox-item:focus-visible {
		outline: 1px solid var(--panel-listbox-item-focus);
		outline-offset: -1px;
	}
</style>

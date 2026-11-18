<!--
	PanelListboxFilter — the search-input organ of the listbox family
	(ADR-0071, R9, D1): PLUMBING ONLY — value in, keystrokes out. It
	never learns what matched: the match pipeline is the consumer's pure
	module (the shelf's name→date→view, the playground's title filter).
	The stretch/navy-ring/placeholder-tone/height grammar arrives from
	the two DSI copies it retires, painted through --panel-listbox-*
	tokens with neutral defaults (D5 — tokens.css owns the skin).
-->
<script lang="ts">
	let {
		value = '',
		oninput,
		placeholder = 'Filter',
		testid = 'panel-listbox-filter',
		ariaLabel
	}: {
		/** The consumer-owned filter text (the organ never holds state). */
		value?: string;
		/** Keystrokes out — the raw input value, nothing interpreted. */
		oninput?: (value: string) => void;
		placeholder?: string;
		testid?: string;
		ariaLabel?: string;
	} = $props();
</script>

<input
	class="panel-listbox-filter"
	data-testid={testid}
	type="search"
	{placeholder}
	aria-label={ariaLabel ?? placeholder}
	value={value}
	oninput={(event) => oninput?.((event.currentTarget as HTMLInputElement).value)}
/>

<style>
	/* The retired DSI grammar, shipped once: the input stretches across
	   the header row's free width (flex 1 1 10rem) while the trailing
	   controls shrink-0; secondary-tone placeholder; ring on focus. */
	.panel-listbox-filter {
		flex: 1 1 10rem;
		min-width: 0;
		height: 1.375rem;
		padding: 0 0.35rem;
		/* no inline color fallbacks — the base ships no skin (W6 ground
		   rule, boundary.test): the neutral defaults live in tokens.css and
		   the consumer voices them (DSI defines all five, 2026-11-18) */
		border: 1px solid var(--panel-listbox-filter-border);
		border-radius: 0.375rem;
		background: var(--panel-listbox-filter-bg);
		font: inherit;
		font-size: 0.6875rem;
		color: var(--panel-listbox-filter-fg);
	}

	.panel-listbox-filter::placeholder {
		color: var(--panel-listbox-filter-placeholder);
	}

	.panel-listbox-filter:focus-visible {
		outline: 2px solid var(--panel-listbox-filter-ring);
		outline-offset: -1px;
	}
</style>

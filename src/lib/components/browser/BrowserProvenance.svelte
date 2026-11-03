<script lang="ts">
	import ZoomSlider from './buttons/ZoomSlider.svelte';

	/**
	 * BrowserProvenance — the lineage chip row (ADR-0036 D3): who asked for
	 * this glass. The title rides the spine merge the route resolved; a
	 * pruned opener degrades to the raw session id. Depth tint like the
	 * transcript. Owns the live zoom slider when the knob is enabled.
	 */
	let {
		openedBy,
		parentTitle,
		focusedTitle,
		depth,
		zoomKnobEnabled,
		zoom,
		zoomLabel,
		onzoom
	}: {
		openedBy: string;
		parentTitle: string | null;
		focusedTitle: string | null;
		depth: number;
		zoomKnobEnabled: boolean;
		zoom: number | null;
		zoomLabel: string;
		onzoom: (fraction: number) => void;
	} = $props();
</script>

<div
	class="browser-provenance flex items-center gap-1 border-b border-surface-border px-2 py-0.5 text-[10px] text-surface-muted"
	class:depth-tinted={depth > 0}
	data-testid="browser-provenance"
	title={openedBy}
>
	<span class="opacity-70">⌥</span>
	<span class="flex min-w-0 items-center gap-1 truncate text-[12px] font-bold">
		<span class="text-[color:var(--color-accent-purple)]">{parentTitle ?? openedBy}</span>{#if focusedTitle}<span class="text-text-muted"> | </span><span class="text-[color:var(--color-accent-blue)]">{focusedTitle}</span>{/if}
	</span>
	{#if depth > 0}<span class="opacity-60">·d{depth}</span>{/if}
	{#if zoomKnobEnabled && zoom !== null}
		<!-- Live zoom slider: right-aligned in the provenance row; on
		     input it POSTs (debounced) and the registry applies the
		     zoom to every attached tab instantly — no reload. -->
		<ZoomSlider
			class="ml-auto"
			{zoom}
			label={zoomLabel}
			testid="browser-zoom-slider"
			onchange={(pct) => onzoom(pct / 100)}
		/>
	{/if}
</div>

<style>
	/* Depth tint, self-contained (ADR-0036 D3): the conversation surface's
	   depth-tint is scoped there; the chip carries its OWN tone. */
	.depth-tinted {
		background-color: color-mix(in srgb, var(--color-surface-active, transparent) 30%, transparent);
	}
</style>

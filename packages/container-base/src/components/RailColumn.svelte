<script lang="ts">
	import type { Snippet } from 'svelte';
	/**
	 * RailColumn — a fixed-width LEADING column inside the zoom row
	 * (generalized from DSI's StickyColumnContainer, OCI ControlRail port;
	 * ADR-0062 W4, D6: the i18n gutter label arrives as a PROP — the full
	 * sidebar container is an R2 exception, the rail ships in R1).
	 *
	 * "Rail" = the width is TRIPLE-LOCKED (width/min/max all the same
	 * px), unlike pane columns whose widths live in [MIN, MAX]: the rail
	 * never flexes when the row measures itself at max-content. The
	 * column's background paints the full column height — the rail inside
	 * fills it (align-items: stretch).
	 *
	 * The trailing resize gutter is included BY DEFAULT (OCI parity) but
	 * only when pane columns actually follow (showGutter) — a rail alone
	 * on the floor has nothing to resize against. The gutter is the
	 * column's flex SIBLING (the rail's overflow must never clip its hit
	 * area) and reports mousedown through onResizeStart — the host owns
	 * the drag math and the single clamp.
	 */
	let {
		width,
		label,
		showGutter = true,
		onResizeStart,
		children
	}: {
		/** Sticky (fixed) column width in px — triple-locked, never flexes. */
		width: number;
		/** Accessible label for the trailing gutter (consumer-localized). */
		label: string;
		/** Trailing resize gutter — only when pane columns follow (OCI). */
		showGutter?: boolean;
		/** Gutter mousedown — the host runs the drag and owns the clamp. */
		onResizeStart?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

<div
	class="rail-column"
	data-testid="sidebar-column"
	style="width: {width}px; min-width: {width}px; max-width: {width}px;"
>
	{@render children()}
</div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions — mouse-drag
     resize handle; keyboard-driven resize is a known gap, not a silent
     omission (filed per ADR-0062 §7) -->
{#if showGutter}
	<div
		class="rail-gutter"
		data-testid="sidebar-gutter"
		role="separator"
		aria-orientation="vertical"
		aria-label={label}
		title={label}
		onmousedown={(e) => onResizeStart?.(e)}
	></div>
{/if}

<style>
	/* Column-geometry essentials (OCI StickyColumnContainer .rail-column):
	   the triple-locked width arrives INLINE (width/min/max); this rule
	   carries the flex-column shell + the surface paint. */
	.rail-column {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-elevated, var(--color-surface-elevated));
		position: relative;
		overflow: visible;
	}

	/* Resize gutter — 6px column right of the locked column (same seam
	   as the app sidebar's own gutter in the out-of-zoom placement: one
	   visual contract, two host sites). */
	.rail-gutter {
		width: 6px;
		flex-shrink: 0;
		cursor: col-resize;
		transition: background-color 0.15s ease;
	}

	.rail-gutter:hover {
		background: var(--color-accent-blue);
		opacity: 0.25;
	}
</style>

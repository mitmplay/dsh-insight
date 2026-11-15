<script lang="ts">
	import type { Snippet } from 'svelte';
	/**
	 * PaneBase — one pane's fixed-width column shell (split from DSI's
	 * PanelColumn, ADR-0062 W4, D8): the GENERIC chrome — the inline
	 * triple width lock, the selection ring, the narrow-container query,
	 * the activate/loupe gestures — lives here; the consumer supplies its
	 * own vocabulary as SNIPPETS (header / toolbar / content / footer).
	 * The package never reads a consumer store, type, or translation.
	 *
	 * Gestures (owner contract, carried verbatim from the split):
	 * - pointerdown/focusin anywhere INSIDE the column fire onactivate
	 *   (interacting with a pane focuses its floor slot).
	 * - click with Alt held, target outside a control, fires onloupe —
	 *   evaluated on the CLICK phase (never pointerdown: a dialog under
	 *   an in-flight press eats its own compatibility mousedown), with
	 *   ONE closest() exclusion instead of per-control stopPropagation.
	 */
	let {
		width,
		paneId,
		sessionTag = null,
		selected = false,
		onactivate,
		onloupe,
		header,
		toolbar,
		children,
		footer
	}: {
		/** Column width in px — triple-locked inline (width/min/max). */
		width: number;
		/** The pane's id — data-panel-id (the zoom's selection-follow hook). */
		paneId: string;
		/** Opaque session-ish tag — data-session-id (null when the pane
		 *  carries no session; the value is never interpreted here). */
		sessionTag?: string | null;
		/** Selection cue — the ring on the selected column. */
		selected?: boolean;
		/** Activate (select) this pane — pointerdown/focusin inside. */
		onactivate?: () => void;
		/** Loupe trigger — Alt+Click release outside a control. */
		onloupe?: () => void;
		/** Header strip slot (the consumer's floor chrome). */
		header: Snippet;
		/** Toolbar slot under the header (badges, controls). */
		toolbar?: Snippet;
		/** Content slot — the pane body. */
		children: Snippet;
		/** Footer slot (after the content). */
		footer?: Snippet;
	} = $props();

	/** The loupe trigger: Alt held, target not inside a control —
	 *  evaluated on click release (see the props doc). */
	function handleLoupeTrigger(event: MouseEvent): void {
		if (!event.altKey) return;
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('button, a, input, textarea, [role="button"]') !== null
		) {
			return;
		}
		onloupe?.();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events — the column is a
     LAYOUT container, not a control: pointerdown is a passive
     selection-follow, focusin is the keyboard parity for the same
     selection, every real control inside stays itself, and the
     click-phase Alt+Click is the loupe trigger. -->
<div
	class="column"
	class:selected
	data-testid="panel-column"
	data-panel-id={paneId}
	data-session-id={sessionTag}
	style="width: {width}px; min-width: {width}px; max-width: {width}px;"
	onpointerdown={() => onactivate?.()}
	onfocusin={() => onactivate?.()}
	onclick={handleLoupeTrigger}
>
	{@render header()}
	{#if toolbar}
		{@render toolbar()}
	{/if}
	<div class="body">
		{@render children()}
	</div>
	{#if footer}
		{@render footer()}
	{/if}
</div>

<style>
	.column {
		position: relative; /* the width badge's absolute anchor */
		/* Size container: the column's inline size is the narrow-header
		   trigger — header children query it instead of receiving width
		   as props. */
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface-primary, var(--color-surface-elevated));
		border-right: 1px solid var(--color-surface-border);
		flex-shrink: 0;
	}

	/* Selection ring — a rounded gradient drawn OUTSIDE the column (same
	   geometry the flat outline had: the band sits in the resize seam, so
	   it never paints over any child component; the floor row carries
	   matching breathing room so the ring's segments are not clipped by
	   the viewport's overflow; both live inside the zoom transform, so
	   they scale in lockstep at any zoom). The ring is a masked
	   pseudo-element, not an outline: outlines cannot take a gradient or
	   a radius. The content-box + exclude mask carves the band; the
	   corners round without touching the column's own square seams. */
	.column.selected::after {
		content: '';
		position: absolute;
		inset: -3px;
		z-index: 5;
		pointer-events: none; /* the gutter and header own their pointers */
		border-radius: 0.75rem;
		padding: 5px;
		/* Theme vars only (D7): the consumer's theme re-points them. */
		background: linear-gradient(
			135deg,
			var(--color-accent-blue) 0%,
			var(--color-accent-purple) 45%,
			var(--color-accent-rose) 100%
		);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		mask-composite: exclude;
	}

	/* Narrow columns (<530px): header text hides, icons carry identity.
	   :global because the text spans live in child components — Svelte
	   scoping stops at this component's own elements, and the container
	   query must reach the descendants. */
	@container (max-width: 529px) {
		.column :global(.narrow-hide) {
			display: none;
		}
	}

	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>

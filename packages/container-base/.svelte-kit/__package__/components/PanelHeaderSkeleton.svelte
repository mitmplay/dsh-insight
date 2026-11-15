<script lang="ts">
	import type { Snippet } from 'svelte';
	/**
	 * PanelHeaderSkeleton — a pane column's header-strip LAYOUT skeleton
	 * (split from DSI's PanelHeader, ADR-0062 W4, D8): the strip carries
	 * the geometry — flex row, label side + actions side, the bottom
	 * border, the selected wash — and the consumer renders its own
	 * controls INTO the slots (labels, copy buttons, chevrons, close).
	 * No consumer vocabulary: no stores, no icons, no translation.
	 *
	 * The element ref is BINDABLE: a consumer whose verbs need the strip's
	 * geometry (e.g. a canvas-capture button aiming at the strip's
	 * PARENT — the column) binds it back.
	 */
	let {
		title,
		selected = false,
		labelTestId,
		headerEl = $bindable(undefined),
		leading,
		actions
	}: {
		/** Tooltip for the whole strip (the consumer's label text). */
		title?: string;
		/** Selection cue — the selected column's header carries the wash. */
		selected?: boolean;
		/** The label span's testid — the consumer's DOM hook (its own
		 *  variants override; the default hook is the consumer's choice). */
		labelTestId?: string;
		/** The strip element — bind back for geometry-aimed verbs. */
		headerEl?: HTMLDivElement | undefined;
		/** Leading slot: the identity (label, copy control). */
		leading: Snippet;
		/** Actions slot: the verbs (chevrons, capture, close). */
		actions: Snippet;
	} = $props();
</script>

<div class="panel-header" class:selected data-testid="panel-header" {title} bind:this={headerEl}>
	<span class="label" data-testid={labelTestId ?? 'panel-header-label'}>
		{@render leading()}
	</span>
	<span class="actions">
		{@render actions()}
	</span>
</div>

<style>
	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		min-height: 1.75rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		border-bottom: 1px solid var(--color-surface-border);
		background: var(--color-surface-primary, var(--color-surface-elevated));
		flex-shrink: 0;
	}

	/* Focus tint: the selected column's floor strip carries the same tint
	   as the conversation header/footer below it — the column you would
	   type into reads as one tinted frame. */
	.panel-header.selected {
		background: var(--color-header-wash);
	}

	.label {
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		overflow: hidden;
		white-space: nowrap;
	}

	.actions {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
	}
</style>

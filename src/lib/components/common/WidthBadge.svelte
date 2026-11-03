<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * WidthBadge — the resize chip (Movable Rail ADR, amendment 2026-10-30
	 * D1): one home for the live px readout that used to live inline in
	 * PanelColumn (2026-08-28). Presentational ONLY — the owner's drag
	 * machine writes the phase; this renders it and intercepts no pointer
	 * (the drag owns the pointer; the afterglow must not block clicks).
	 * The floor badge (PanelColumn) and the sidebar rail badge
	 * (AppSidebar standalone) share this grammar; the embedded rail gets
	 * no badge at all (zoom-scaled px would misreport — ADR D3).
	 */
	let {
		phase,
		width,
		testid = 'panel-width-badge'
	}: {
		/** 'live' while the drag moves, 'fading' through the 10s afterglow. */
		phase: 'live' | 'fading';
		width: number;
		testid?: string;
	} = $props();
</script>

<!-- Visual aid for a pointer drag: duplicates no unique info to AT (the
     width is a layout fact), and never intercepts pointers. -->
<span
	class="width-badge"
	class:fading={phase === 'fading'}
	data-testid={testid}
	data-badge-phase={phase}
	aria-hidden="true"
>
	{Math.round(width)}px
</span>

<style>
	/* Width badge (2026-08-28, extracted 2026-10-30): the drag's live
	   width readout at the owner's top right, BELOW the header row so it
	   never covers controls. The OWNER must be position:relative. Chip
	   grammar (border + 10% tint + deepened text, tabular-nums — the
	   title-chip family; its mix measured AA 4.94:1 on white). */
	.width-badge {
		position: absolute;
		top: 2.5rem;
		right: 0.875rem;
		z-index: 5;
		pointer-events: none;
		padding: 0.125rem 0.375rem;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 10%, var(--color-surface-elevated));
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 30%, var(--color-navy-focus));
		font-size: 0.6875rem;
		line-height: 1.25;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		opacity: 1;
	}

	/* Afterglow: after mouseup the badge fades out over 10s. The
	   transition rides ONLY this class — a new drag snapping the badge
	   back to live (or re-showing it) is instant, never a 10s fade-in. */
	.width-badge.fading {
		opacity: 0;
		transition: opacity 10s linear;
	}

	@media (prefers-reduced-motion: reduce) {
		.width-badge.fading {
			transition: none; /* honor the preference: hide at once */
		}
	}
</style>

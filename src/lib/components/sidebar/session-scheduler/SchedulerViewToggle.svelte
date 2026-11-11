<script lang="ts">
	/**
	 * SchedulerViewToggle (Filter Cluster ADR D2, task 2.1; S amended by
	 * operator SC#1 2026-11-11) — the shelf's tri-state delivery view as
	 * ONE joined pill: no segment pressed = all rows; S pressed = rows
	 * still awaiting delivery (scheduledAt present, no receipt yet); D
	 * pressed = only ended rows with a delivery receipt. Tapping the lit
	 * segment again returns to all. Fully presentational: value in,
	 * onchange out — this component owns no state (ADR D1 contract).
	 *
	 * Grammar: the SessionFilterToggle joined-pill segmented pair as
	 * copied by NewChatButton's verb toggle — zero gap, outer curves
	 * only, yellowgreen .on engaged fill (dark text #212529 = 8.19:1 AA
	 * on yellowgreen; white is ~2:1 and never used here).
	 */
	import { CheckCheck, Clock } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { SchedulerViewMode } from '$lib/utils/scheduler-prefs';

	let {
		value,
		onchange
	}: {
		/** The active view ('all' | 'scheduled' | 'delivered'). */
		value: SchedulerViewMode;
		/** Reports the next view ('all' when the lit segment is re-tapped). */
		onchange: (next: SchedulerViewMode) => void;
	} = $props();

	/** Tapping the selected segment unselects it (mutual exclusion). */
	function pick(next: 'scheduled' | 'delivered'): void {
		onchange(value === next ? 'all' : next);
	}
</script>

<div class="seg-group" role="group" aria-label={t(m.schedulerDeliveryView)} data-testid="scheduler-view-toggle">
	<button
		type="button"
		class="seg left"
		class:on={value === 'scheduled'}
		aria-pressed={value === 'scheduled'}
		title={t(m.schedulerShowPending)}
		data-testid="scheduler-view-toggle-s"
		onclick={() => pick('scheduled')}
	>
		<Clock size={12} aria-hidden="true" />
	</button>
	<button
		type="button"
		class="seg right"
		class:on={value === 'delivered'}
		aria-pressed={value === 'delivered'}
		title={t(m.schedulerShowDelivered)}
		data-testid="scheduler-view-toggle-d"
		onclick={() => pick('delivered')}
	>
		<CheckCheck size={12} aria-hidden="true" />
	</button>
</div>

<style>
	/* Joined pill (self-contained — the parent's scoped rules cannot
	   reach into this component's DOM): one capsule, zero gap, the right
	   segment drops its left border, outer curves only. */
	.seg-group {
		display: flex;
		align-items: stretch;
		flex-shrink: 0;
	}

	.seg {
		display: inline-flex;
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		background: transparent;
		color: var(--color-slate-neutral, #495057);
		line-height: 1;
		padding: 0.15rem 0.3rem;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.seg.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}

	.seg.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}

	.seg:hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, var(--color-surface-elevated));
	}

	/* Keyboard focus gets the navy RING (WCAG 2.4.7), the header family's
	   one keyboard indicator. */
	.seg:focus-visible {
		outline: 2px solid var(--color-navy-focus);
		outline-offset: 1px;
	}

	/* Engaged segment — the SessionFilterToggle .on contract: yellowgreen
	   field, dark text (#212529 on yellowgreen = 8.19:1 AA). */
	.seg.on {
		background: yellowgreen;
		border-color: color-mix(in srgb, yellowgreen 65%, black);
		color: var(--color-text-primary, #212529);
	}

	.seg.on:hover {
		background: color-mix(in srgb, yellowgreen 85%, black);
		border-color: color-mix(in srgb, yellowgreen 55%, black);
		color: var(--color-text-primary, #212529);
	}

	.seg :global(svg) {
		flex-shrink: 0;
	}

	.seg.on :global(svg) {
		color: inherit;
	}
</style>

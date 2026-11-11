<script lang="ts">
	/**
	 * SchedulerShelf header (extracted 2026-11-11 from
	 * SidebarSessionScheduler): the fold toggle + the armed-count pill,
	 * following the SidebarSessionOpenHeader row grammar — a wrapping
	 * flex row whose right side will host more buttons beside the pill,
	 * so the count sits OUTSIDE the toggle button as its sibling.
	 * All state arrives from the owning host; the fold returns as a
	 * callback — this header owns no state.
	 */
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { ChevronDown, ChevronRight, Clock } from '@lucide/svelte';

	let {
		collapsed,
		count,
		ontoggle
	}: {
		collapsed: boolean;
		count: number;
		ontoggle: () => void;
	} = $props();
</script>

<div class="head-row">
	<button
		class="head"
		type="button"
		data-testid="scheduler-shelf-toggle"
		aria-expanded={!collapsed}
		onclick={ontoggle}
	>
		{#if collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown size={12} aria-hidden="true" />{/if}
		<Clock size={12} aria-hidden="true" />
		<span class="label">{t(m.schedulerShelf)}</span>
	</button>
	<!-- The armed-count pill rides OUTSIDE the toggle button — the row's
	     right side will host more buttons beside it. -->
	<span class="pill" data-testid="scheduler-shelf-count">{count}</span>
</div>

<style>
	/* Header row: the fold toggle (flex 1) + the count pill beside it —
	   the SidebarSessionOpenHeader sibling grammar: one flex row, the
	   pill never squeezed (shrink 0) while the label ellipsizes inside
	   its button. */
	.head-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}

	.head {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.3rem;
		border: none;
		background: transparent;
		border-radius: 0.375rem;
		cursor: pointer;
		/* The sidebar's 11px coherence rule (RowSessionItem 2026-11-06). */
		font-size: 0.6875rem;
		color: var(--color-text-primary, #212529);
		text-align: left;
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pill {
		flex-shrink: 0;
		padding: 0 0.35rem;
		border-radius: 999px;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		background: color-mix(in srgb, var(--color-accent-purple) 14%, transparent);
	}
</style>

<script lang="ts">
	/**
	 * SchedulerShelf header (extracted 2026-11-11 from
	 * SidebarSessionScheduler; filter cluster added per Filter Cluster
	 * ADR D1/D4/D7, amended 2026-11-11): the fold toggle (chevron only), the name
	 * filter input, the merged count pill (pending/delivered), then
	 * FilterDateButton + SchedulerViewToggle — following the
	 * SidebarSessionOpenHeader row grammar (a wrapping flex row).
	 *
	 * All state arrives from the owning host; every interaction returns
	 * as a callback — this header owns no state (D1 contract: no
	 * localStorage, no prefs, no fetch).
	 */
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import FilterDateButton from '$lib/components/common/buttons/FilterDateButton.svelte';
	import SchedulerViewToggle from './SchedulerViewToggle.svelte';
	import type { SchedulerViewMode } from '$lib/utils/scheduler-prefs';

	let {
		collapsed,
		pendingCount,
		deliveredCount,
		nameFilter,
		dateFilter,
		viewMode,
		sessionDates = new Set<string>(),
		ontoggle,
		onfilterinput,
		ondatechange,
		onviewchange
	}: {
		collapsed: boolean;
		/** Rows in the filtered view still awaiting a delivery receipt — the pending pill (D4). */
		pendingCount: number;
		/** Ended-with-receipt rows within the same filtered view (D4). */
		deliveredCount: number;
		nameFilter: string;
		dateFilter: string;
		viewMode: SchedulerViewMode;
		/** Days holding at least one scheduled task — the calendar's dot set (D3). */
		sessionDates?: Set<string>;
		ontoggle: () => void;
		onfilterinput: (event: Event) => void;
		ondatechange: (date: string) => void;
		onviewchange: (next: SchedulerViewMode) => void;
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
		<span class="label">{t(m.schedulerShelf)}</span>
	</button>
	<!-- The filter input rides directly after the fold toggle — the
	     spine header's search-first grammar (operator amendment
	     2026-11-11). -->
	<input
		class="filter-input"
		data-testid="sidebar-scheduler-filter"
		type="search"
		placeholder={t(m.schedulerFilterByTaskName)}
		aria-label={t(m.schedulerFilterByTaskName)}
		value={nameFilter}
		oninput={onfilterinput}
	/>
	<!-- The count pills re-reflect the engaged filter (D4 — honest
	     counts, honest 0): pending = no delivery receipt yet, delivered
	     = ended-with-receipt. -->
	<span class="pill" data-testid="scheduler-counts">({pendingCount}/{deliveredCount})</span>
	<FilterDateButton value={dateFilter} dates={sessionDates} onchange={ondatechange} />
	<SchedulerViewToggle value={viewMode} onchange={onviewchange} />
</div>

<style>
	/* Header row: the fold toggle + pills + the filter row — the
	   SidebarSessionOpenHeader sibling grammar: one flex row, nothing
	   squeezed (shrink 0) while the label ellipsizes inside its button. */
	.head-row {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		min-width: 0;
	}

	.head {
		/* Content-sized: the search input owns the row's free width
		   (operator amendment 2026-11-11 — no dead space in the header). */
		flex: 0 0 auto;
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

	/* Name filter (the spine header's grammar): the input stretches
	   across the row's free width; secondary-tone placeholder; navy ring
	   on focus. */
	.filter-input {
		flex: 1 1 10rem;
		min-width: 0;
		height: 1.375rem;
		padding: 0 0.35rem;
		border: 1px solid color-mix(in srgb, var(--color-surface-border, #dee2e6) 75%, transparent);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated, #ffffff);
		/* 0.6875rem coherence with the shelf row/header text. */
		font-size: 0.6875rem;
		color: var(--color-text-primary, #212529);
	}

	.filter-input::placeholder {
		color: var(--color-text-secondary, #6c757d);
	}

	.filter-input:focus-visible {
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -1px;
	}
</style>

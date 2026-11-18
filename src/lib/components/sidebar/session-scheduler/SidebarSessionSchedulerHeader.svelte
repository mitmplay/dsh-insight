<script lang="ts">
	/**
	 * SchedulerShelf header (extracted 2026-11-11; filter cluster added
	 * per Filter Cluster ADR D1/D4/D7). R9 re-point (ADR-0071 D4/D6):
	 * the row is the PanelListboxHeader organ now — chevron toggle +
	 * label + a trailing snippet holding the PanelListboxFilter organ
	 * (the retired hand-drawn input died same commit), the count pills,
	 * FilterDateButton + SchedulerViewToggle. Label-click folding stays
	 * retired (the chevron folds — the R8 anatomy, same as every other
	 * re-pointed surface).
	 *
	 * All state arrives from the owning host; every interaction returns
	 * as a callback — this header owns no state (D1 contract: no
	 * localStorage, no prefs, no fetch).
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { PanelListboxFilter, PanelListboxHeader } from '@deepseek-insight/container-base';
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
		onfilterinput: (value: string) => void;
		ondatechange: (date: string) => void;
		onviewchange: (next: SchedulerViewMode) => void;
	} = $props();

	const filterLabel = $derived(t(m.schedulerFilterByTaskName));
</script>

<!-- The filter input rides inside the trailing cluster — the spine
     header's search-first grammar (operator amendment 2026-11-11),
     the testid preserved via the organ prop (ADR-0071 D6). -->
<PanelListboxHeader
	expanded={!collapsed}
	onToggle={ontoggle}
	label={t(m.schedulerShelf)}
	testid="scheduler-shelf-header"
	toggleTestid="scheduler-shelf-toggle"
>
	<!-- R9 UX amendment (operator 2026-11-18): title and search share the
	     header's ONE title container — the input owns the row's free width; -->
	{#snippet search()}
		<PanelListboxFilter
			value={nameFilter}
			oninput={onfilterinput}
			placeholder={filterLabel}
			ariaLabel={filterLabel}
			testid="sidebar-scheduler-filter"
		/>
	{/snippet}
	{#snippet trailing()}
		<!-- The count pills re-reflect the engaged filter (D4 — honest
		     counts, honest 0): pending = no delivery receipt yet, delivered
		     = ended-with-receipt. -->
		<span class="pill" data-testid="scheduler-counts">({pendingCount}/{deliveredCount})</span>
		<FilterDateButton value={dateFilter} dates={sessionDates} onchange={ondatechange} />
		<SchedulerViewToggle value={viewMode} onchange={onviewchange} />
	{/snippet}
</PanelListboxHeader>

<style>
	/* (R9: the retired .head-row/.head/.label hand-rolled row grammar is
	   the PanelListboxHeader organ's, and the retired .filter-input rule
	   block is the PanelListboxFilter organ's — both deleted same commit,
	   ADR-0071 D9. The pills keep the shelf's chip voice.) */
	.pill {
		flex-shrink: 0;
		padding: 0 0.35rem;
		border-radius: 999px;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		background: color-mix(in srgb, var(--color-accent-purple) 14%, transparent);
	}
</style>

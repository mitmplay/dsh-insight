<script lang="ts">
	/**
	 * SidebarSessionList header (extracted 2026-11-11 from
	 * SidebarSessionList): the pinned group-head line — chevron+title
	 * toggle, session-name filter input, date badge, sub-agent toggle.
	 * All view state arrives from the owning host (the spine prefs
	 * owner applies + persists); every interaction returns as a
	 * callback — this header owns no state.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Bot, BotOff } from '@lucide/svelte';
	import { PanelListboxFilter, PanelListboxHeader } from '@deepseek-insight/container-base';
	import FilterDateButton from '$lib/components/common/buttons/FilterDateButton.svelte';

	let {
		collapsed,
		nameFilter,
		subagentsHidden,
		dateFilter,
		sessionDates = new Set<string>(),
		ontoggle,
		onfilterinput,
		ondatechange,
		ontogglesubagents
	}: {
		collapsed: boolean;
		nameFilter: string;
		subagentsHidden: boolean;
		dateFilter: string;
		/** Days holding at least one session — the date button's calendar
		 *  dots (2026-09-04). Absent = a dot-less calendar. */
		sessionDates?: Set<string>;
		ontoggle: () => void;
		onfilterinput: (value: string) => void;
		ondatechange: (date: string) => void;
		ontogglesubagents: () => void;
	} = $props();
</script>

<!-- R8 re-point (ADR-0070 D9): the chevron + label row is the PACKAGE
     organ now — the retired .group-head/.group-toggle hand-rolled
     grammar was deleted in the same commit. The filter input, the date
     badge, and the sub-agent toggle are DOMAIN controls injected through
     the trailing snippet (D3); the view-state owner is unchanged. -->
<PanelListboxHeader
	expanded={!collapsed}
	onToggle={ontoggle}
	label={t(m.sessions)}
	testid="sidebar-spine-group-header"
	toggleTestid="sidebar-spine-group-toggle"
	controls="sidebar-spine-group-rows"
	class="group-head"
>
	{#snippet children()}
		<span class="head-title" data-testid="sidebar-spine-group-title">{t(m.sessions)}</span>
	{/snippet}
	{#snippet search()}
		<!-- R9 re-point (ADR-0071 D9): the hand-drawn input is the
		     PanelListboxFilter organ now — the retired .filter-input rule
		     block was deleted in the same commit. R9 UX amendment (operator
		     2026-11-18): title and search share ONE container, the input
		     owns the free width; testid preserved via the organ prop (D6). -->
		<PanelListboxFilter
			value={nameFilter}
			oninput={onfilterinput}
			placeholder={t(m.filterBySessionName)}
			ariaLabel={t(m.filterBySessionNameLabel)}
			testid="sidebar-spine-filter"
		/>
	{/snippet}
	{#snippet trailing()}
		<!-- Date filter (2026-09-04, the OCI FilterDateButton port): the
		     badge sits directly AFTER the name-filter input — same pinned
		     header, same view-state contract (spine.dateFilter). -->
		<FilterDateButton value={dateFilter} dates={sessionDates} onchange={ondatechange} />
		<button
			type="button"
			class="subagents-btn"
			class:active={subagentsHidden}
			data-testid="sidebar-spine-subagents"
			aria-pressed={subagentsHidden}
			title={subagentsHidden ? 'Show sub-agents' : 'Hide sub-agents'}
			onclick={ontogglesubagents}
		>
			{#if subagentsHidden}<BotOff size={12} aria-hidden="true" />{:else}<Bot
					size={12}
					aria-hidden="true"
				/>{/if}
		</button>
	{/snippet}
</PanelListboxHeader>

<style>
	/* (R8: the retired .group-head row layout + .group-toggle chevron
	   grammar is the PanelListboxHeader organ's — deleted same commit,
	   ADR-0070 D9. R9: the retired .filter-input rule block is the
	   PanelListboxFilter organ's — deleted same commit, ADR-0071 D9. The
	   input keeps the header's free width through the organ's trailing
	   cluster; DSI voices the organ's ring/tones via its theme vars.) */

	.head-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: blueviolet;
	}

	/* Sub-agent toggle (2026-10-29): the row-btn ghost glyph never read
	   as a button — 18px, transparent, 60% opacity. It now wears the
	   header's chip grammar (FilterDateButton sibling): a bordered pill,
	   full opacity, that FILLS with the spine's green when the filter is
	   engaged so the pressed state is never only a glyph swap. */
	.subagents-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.25rem;
		min-width: 1.375rem;
		padding: 0 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated, #ffffff);
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.subagents-btn:hover {
		background: var(--color-surface-hover, #e9ecef);
		color: var(--color-text-primary, #212529);
	}

	.subagents-btn:focus-visible {
		outline: 2px solid var(--color-navy-focus);
		outline-offset: 1px;
	}

	/* Engaged = sub-agents HIDDEN: the SessionAccess chip tint family —
	   green fill, green ink (AA on the tint), green border. */
	.subagents-btn.active {
		border-color: color-mix(in srgb, var(--color-status-pass) 40%, transparent);
		background: color-mix(in srgb, var(--color-status-pass) 15%, transparent);
		color: var(--color-success-ink, #1a7f37);
	}

	.subagents-btn.active:hover {
		background: color-mix(in srgb, var(--color-status-pass) 24%, transparent);
	}
</style>

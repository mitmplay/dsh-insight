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
	import { Bot, BotOff, ChevronDown, ChevronRight } from '@lucide/svelte';
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
		onfilterinput: (event: Event) => void;
		ondatechange: (date: string) => void;
		ontogglesubagents: () => void;
	} = $props();
</script>

<div class="group-head">
	<button
		type="button"
		class="group-toggle"
		data-testid="sidebar-spine-group-toggle"
		aria-expanded={!collapsed}
		aria-controls="sidebar-spine-group-rows"
		onclick={ontoggle}
	>
		{#if collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown
				size={12}
				aria-hidden="true"
			/>{/if}
		<span class="head-title" data-testid="sidebar-spine-group-title">{t(m.sessions)}</span>
	</button>
	<input
		class="filter-input"
		data-testid="sidebar-spine-filter"
		type="search"
		placeholder={t(m.filterBySessionName)}
		aria-label={t(m.filterBySessionNameLabel)}
		value={nameFilter}
		oninput={onfilterinput}
	/>
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
</div>

<style>
	/* Header row (2026-09-01): chevron+title toggle, name filter input,
	   [x] clear, sub-agent toggle — one pinned line; the input owns the
	   free width. Never scrolls (the rows pane below does). */
	.group-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}

	/* Title toggle — the Panels .group-head grammar (small, weight 600,
	   hover field, navy keyboard ring); the chevron leads. */
	.group-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		min-width: 0;
		padding: 0.1875rem 0.375rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		font-size: 0.6875rem;
		line-height: 1.25;
		font-weight: 600;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.group-toggle:hover {
		background: var(--color-surface-hover, #e9ecef);
	}

	/* Keyboard focus gets a RING, not just the hover field (WCAG 2.4.7),
	   the same navy the Panels header rings with. */
	.group-toggle:focus-visible {
		background: var(--color-surface-hover, #e9ecef);
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -2px;
	}

	.group-toggle :global(svg) {
		flex-shrink: 0;
		color: var(--color-text-secondary, #6c757d);
	}

	.head-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: blueviolet;
	}

	/* Name filter (2026-09-01): the input owns the header's free width;
	   secondary-tone placeholder (#6c757d on white ≈ 4.6:1), navy ring on
	   focus — the group's one keyboard indicator family. */
	.filter-input {
		flex: 1;
		min-width: 0;
		height: 1.375rem;
		padding: 0 0.375rem;
		border: 1px solid color-mix(in srgb, var(--color-surface-border, #dee2e6) 75%, transparent);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated, var(--color-surface-elevated));
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

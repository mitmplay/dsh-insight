<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SidebarSessionsList — the sidebar's filtered session rows (extracted
	 * from SidebarSessionContainer, 2026-08-24): the recency spine below
	 * the filter pills — empty-state hints or one RowSessionItem per
	 * visible session, workspace chip always in its column.
	 * Presentational: the rows arrive filtered from the owner; each
	 * row's own grammar (href, floor verbs, indent, interior, time)
	 * lives in RowSessionItem since 2026-08-28.
	 *
	 * Panel Floor W3 (task 3.4-T wiring, formalized in W4 4.2): on the
	 * workspace floor the rows act on PANELS through the panel registry —
	 * plain click adds a panel, Shift+click replaces the selected panel
	 * (R5 verbs reversed 2026-08-28). The registry's graceful no-op
	 * keeps the real <a> navigation as the
	 * fallback everywhere else (no floor mounted → navigate, ADR-0006 R5).
	 *
	 * Spine group (2026-09-01): the rows live inside a collapse/expand
	 * group box (the Panels-group grammar, SidebarOpenPanels — in a
	 * NEUTRAL surface voice: the accent-blue wash stays the floor's live
	 * set marker). The header carries, beside the chevron + `Sessions`
	 * title, the session-name filter input (type="search" — the browser
	 * owns the clear affordance, the 2026-09-25 button removal), and the
	 * sub-agent visibility toggle (Bot / BotOff). All three are VIEW state owned by
	 * SidebarSessions (the owner applies + persists them via
	 * spine-group-prefs); this component only renders and reports.
	 * Typing while collapsed auto-expands — a filter that invisibly does
	 * nothing is a trap.
	 *
	 * Scroll restructure (2026-09-01): the pane no longer scrolls — the
	 * header must stay pinned while the rows scroll, so the scroll pane
	 * moved DOWN one level into .group-rows. The parent list column
	 * (SidebarSessionContainer's .list) still owns the never-grow rule;
	 * this pane absorbs its height either way.
	 */
	import { Bot, BotOff, ChevronDown, ChevronRight } from '@lucide/svelte';
	import FilterDateButton from '$lib/components/common/buttons/FilterDateButton.svelte';
	import { defaultSpineGroupPrefs, type SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { heartbeatScope } from '$lib/services/jobs/heartbeat-scope.svelte';
	import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
	import RowSessionItem from './RowSessionItem.svelte';

	let {
		current,
		visible,
		depthById = {},
		workspaces,
		sessionDates = new Set<string>(),
		spine = defaultSpineGroupPrefs(),
		onspinechange
	}: {
		/** Pinned current session — decides WHICH empty hint applies. */
		current: DsiSessionSummary | null;
		/** Filtered rows (the owner's list WITHOUT the current session). */
		visible: DsiSessionSummary[];
		/** Nesting depths by sessionId (W4 task 4.1, ADR D6): sub-agents
		 *  that STAY in the spine (off-floor parent) indent under their
		 *  family head — same anchor grammar, inline indent; absent = 0. */
		depthById?: Record<string, number>;
		/** Host workspace registry — the authority for chip ghost styling. */
		workspaces: DsiWorkspaceSummary[];
		/** Days holding at least one session — the date button's calendar
		 *  dots (2026-09-04). Absent = a dot-less calendar. */
		sessionDates?: Set<string>;
		/** The owner's spine view state (collapse, name filter, sub-agent
		 *  toggle, date filter) — persisted per profile there; defaulted
		 *  for direct mounts. */
		spine?: SpineGroupPrefs;
		/** Reports a partial spine state change; the owner applies + persists. */
		onspinechange?: (partial: Partial<SpineGroupPrefs>) => void;
	} = $props();

	// ADR-0034 — the heartbeat scope's viewport feed. One observer over the
	// row anchors reports the on-screen ids; mode + spine set feed here too.
	// BC-7: everything is event-driven — no timers of any kind.
	let rowsEl: HTMLElement | undefined = $state(undefined);

	$effect(() => {
		// tracked read: a mode flip rebuilds the scope's wanted set
		heartbeatScope.setMode(appConfig().conversation.heartbeatType);
	});

	$effect(() => {
		// ticker-cap: the watched population is the whole rendered spine
		if (appConfig().conversation.heartbeatType !== 'ticker-cap') return;
		heartbeatScope.setSpine(visible.map((s) => s.sessionId));
	});

	$effect(() => {
		// viewport-cap: observe the rendered anchors; report on-screen ids.
		// Tracked reads of the mode + the rendered id list re-run this effect
		// each tick — re-observe() on a known anchor is a no-op, so the only
		// real work is observing genuinely new rows.
		// No IntersectionObserver (unit DOM) → degrade to ticker-like: feed
		// the rendered ids so fixtures can assert data arrival; the real
		// browser always has the observer and never fetches offscreen.
		if (appConfig().conversation.heartbeatType !== 'viewport-cap') return;
		const ids = visible.map((s) => s.sessionId);
		const report = (onScreen: string[]) => heartbeatScope.setViewport(onScreen);
		if (typeof IntersectionObserver === 'undefined' || !rowsEl) {
			report(ids);
			return;
		}
		const onScreen = new Map<string, boolean>();
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const id = (e.target as HTMLElement).dataset.sessionId;
					if (id) onScreen.set(id, e.isIntersecting);
				}
				report([...onScreen].filter(([, on]) => on).map(([id]) => id));
			},
			{ rootMargin: '200px 0px' } // hysteresis: watch ±200px past the edge
		);
		for (const a of rowsEl.querySelectorAll('a[data-session-id]')) io.observe(a);
		return () => io.disconnect();
	});

	/** Chevron/title click — the whole rows block folds or unfolds. */
	function toggle(): void {
		onspinechange?.({ collapsed: !spine.collapsed });
	}

	/** Filter keystroke — the live query, plus the collapsed group's
	 *  auto-expand (both facts in ONE report so the owner persists once). */
	function onFilterInput(event: Event): void {
		const value = (event.currentTarget as HTMLInputElement).value;
		onspinechange?.(
			spine.collapsed ? { collapsed: false, nameFilter: value } : { nameFilter: value }
		);
	}

	/** Sub-agent toggle — hide or re-show origin-'subagent' rows. */
	function toggleSubagents(): void {
		onspinechange?.({ subagentsHidden: !spine.subagentsHidden });
	}

	/** Date pick/clear — the spine's date filter, with the same collapsed
	 *  auto-expand a name keystroke carries (a filter that invisibly does
	 *  nothing is a trap). Clearing never expands: the unfiltered view is
	 *  the default state, nothing to reveal. */
	function onDateFilter(date: string): void {
		onspinechange?.(
			spine.collapsed && date !== ''
				? { collapsed: false, dateFilter: date }
				: { dateFilter: date }
		);
	}
</script>

<div class="pane" data-testid="sidebar-spine-pane">
	<div class="spine-group" data-testid="sidebar-spine-group">
		<div class="group-head">
			<button
				type="button"
				class="group-toggle"
				data-testid="sidebar-spine-group-toggle"
				aria-expanded={!spine.collapsed}
				aria-controls="sidebar-spine-group-rows"
				onclick={toggle}
			>
				{#if spine.collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown
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
				value={spine.nameFilter}
				oninput={onFilterInput}
			/>
			<!-- Date filter (2026-09-04, the OCI FilterDateButton port): the
			     badge sits directly AFTER the name-filter input — same pinned
			     header, same view-state contract (spine.dateFilter). -->
			<FilterDateButton value={spine.dateFilter} dates={sessionDates} onchange={onDateFilter} />
			<button
				type="button"
				class="row-btn"
				class:active={spine.subagentsHidden}
				data-testid="sidebar-spine-subagents"
				aria-pressed={spine.subagentsHidden}
				title={spine.subagentsHidden ? 'Show sub-agents' : 'Hide sub-agents'}
				onclick={toggleSubagents}
			>
				{#if spine.subagentsHidden}<BotOff size={12} aria-hidden="true" />{:else}<Bot
						size={12}
						aria-hidden="true"
					/>{/if}
			</button>
		</div>
		{#if !spine.collapsed}
			<div class="group-rows" id="sidebar-spine-group-rows" bind:this={rowsEl} data-testid="sidebar-spine-group-rows">
				{#if visible.length === 0 && !current}
					<p class="hint" data-testid="sidebar-sessions-empty">{t(m.noSessionsMatch)}</p>
				{:else if visible.length === 0}
					<p class="hint" data-testid="sidebar-sessions-empty">{t(m.noOtherSessionsMatch)}</p>
				{:else}
					{#each visible as s (s.sessionId)}
						<RowSessionItem session={s} depth={depthById[s.sessionId] ?? 0} {workspaces} />
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* Scroll restructure (2026-09-01): this pane ABSORBS every rem of
	   height the blocks above leave (the panel pane and pills live in
	   the body column since the 2026-08-26 move) but no longer scrolls —
	   the header must stay pinned, so the scroll pane is .group-rows
	   below. Taller content scrolls INTERNALLY there; the pair's combined
	   height is always exactly the column's height, never a shared
	   scrollbar. */
	.pane {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* Group box (2026-09-01): the Panels box grammar — border, radius,
	   quiet padding — under a green diagonal wash fading to transparent
	   (the filter row's purple wash reads as its sibling). Accent-blue
	   stays the floor's live set marker (SidebarOpenPanels), so the
	   spine marks itself in green. */
	.spine-group {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--color-surface-border, #dee2e6) 75%, transparent);
		border-radius: 0.5rem;
		background: linear-gradient(45deg, color-mix(in srgb, var(--color-status-pass) 26%, transparent), transparent);
		/* NO margins — the parent column's gap spaces this box; a margin
		   here would count as scrollable overflow inside the column. */
	}

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

	/* Header buttons ([x] clear, sub-agent toggle) — the row-btn grammar
	   the sidebar's row actions share (quiet, revealed to full opacity on
	   hover/focus). `active` = the sub-agent filter is ON: full opacity +
	   navy so the engaged state is never only a glyph swap. */
	.row-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		opacity: 0.6;
		transition:
			background-color 0.15s ease,
			opacity 0.15s ease;
	}

	.row-btn:hover,
	.row-btn:focus-visible {
		opacity: 1;
		background: var(--color-surface-hover, #e9ecef);
		outline: none;
	}

	.row-btn.active {
		opacity: 1;
		color: var(--color-navy-focus);
	}

	/* Rows scroll pane (moved down one level, 2026-09-01): owns the
	   internal scrolling the pane root used to — the inter-row gap moved
	   with it. Collapsed, the whole rows block unmounts and the header
	   alone is the group. */
	.group-rows {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.hint {
		padding: 0.5rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
	}
</style>

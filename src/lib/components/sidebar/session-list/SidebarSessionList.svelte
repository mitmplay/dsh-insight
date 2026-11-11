<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SidebarSessionList — the sidebar's filtered session rows (extracted
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
	import SidebarSessionListHeader from './SidebarSessionListHeader.svelte';
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
		<SidebarSessionListHeader
			collapsed={spine.collapsed}
			nameFilter={spine.nameFilter}
			subagentsHidden={spine.subagentsHidden}
			dateFilter={spine.dateFilter}
			{sessionDates}
			ontoggle={toggle}
			onfilterinput={onFilterInput}
			ondatechange={onDateFilter}
			ontogglesubagents={toggleSubagents}
		/>
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

<script lang="ts">
	/**
	 * SidebarSessionContainer — the sidebar's session-rows shell: the
	 * scrolling column assembling the separator and the filtered recency
	 * spine (SidebarSessionsList). The pinned panel group
	 * (SidebarOpenPanels) moved OUT to SessionsList (2026-08-26) —
	 * it now renders above the SessionFilterRow pills, outside this
	 * column. Purely presentational: data loading and filter derivation
	 * live in SidebarSessions (the owner).
	 *
	 * The workspace chip column ALWAYS renders, workspace filter or not
	 * (2026-08-24 revision): a spine row may sit in a DIFFERENT
	 * workspace than the active filter — its chip is the one cue saying
	 * where that conversation lives. A row without a workspace renders
	 * the empty alignment slot so the column never breaks.
	 *
	 * Split scroll (2026-08-24, revised 2026-08-26): the column's whole
	 * height goes to the spine — it scrolls INTERNALLY past its own
	 * limit, never growing a scrollbar of its own. The panel pane that
	 * once lived here is a sibling ABOVE (inside SessionsList's body
	 * column, over the pills); the body column itself never scrolls as
	 * one, so a combined scrollbar still cannot exist.
	 */
	import type { SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
	import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
	import SidebarSessionsList from './SidebarSessionsList.svelte';

	let {
		/** Pinned current session — rendered first, never filtered away. */
		current,
		/** Filtered rows (the owner's list WITHOUT paneled sessions). */
		visible,
		depthById = {},
		/** Host workspace registry — the authority for chip ghost styling. */
		workspaces,
		/** Open floor panels (W4) — paneled sessions leave the spine. */
		paneledSessionIds = [],
		/** Days holding at least one session — the date button's calendar
		 *  dots (2026-09-04, FilterDateButton port). */
		sessionDates,
		/** Spine view state (collapse, name filter, sub-agent toggle, date
		 *  filter) — relayed to the list; the owner applies + persists. */
		spine,
		onspinechange
	}: {
		current: DsiSessionSummary | null;
		visible: DsiSessionSummary[];
		/** Nesting depths by sessionId (W4 task 4.1) — pass-through. */
		depthById?: Record<string, number>;
		workspaces: DsiWorkspaceSummary[];
		paneledSessionIds?: string[];
		sessionDates?: Set<string>;
		spine: SpineGroupPrefs;
		onspinechange: (partial: Partial<SpineGroupPrefs>) => void;
	} = $props();

</script>

<div class="list" data-testid="sidebar-sessions-list">
	<hr/>
	<SidebarSessionsList {current} {visible} {depthById} {workspaces} {sessionDates} {spine} {onspinechange} />
</div>

<style>
	/* Separator above the spine — the filter pills end here and the
	   recency rows begin (moved with the panel group's departure,
	   2026-08-26). The app's border token at 75% strength: a touch
	   lighter than .footer's full-tone section border, still clearly
	   a line. Zero margin, 1px. */
	hr {
		border: none;
		border-top: 1px solid color-mix(in srgb, var(--color-surface-border, #dee2e6) 75%, transparent);
		margin: 0;
		flex-shrink: 0;
	}

	/* No combined scrolling, ever: the spine pane owns its scroll and
	   scrolls internally past its own limit, so this wrapper must never
	   grow a scrollbar of its own. */
	.list {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

</style>

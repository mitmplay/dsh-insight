<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * SessionsList — the sidebar body's rendering shell (extracted from
	 * SidebarSessions, 2026-08-24): the phase branches (loading / error /
	 * ready), the pinned panel group (SidebarOpenPanels, moved here
	 * 2026-08-26 — above the pills, so the floor's live set stays visible
	 * without scrolling past the filter controls), the SessionFilterRow
	 * pills, the rows (SidebarSessionContainer), and the "+ New chat"
	 * footer (SidebarFooter, extracted 2026-09-04). Purely presentational:
	 * data loading, the refresh cadence, and filter derivation stay in
	 * SidebarSessions (the owner); this component receives resolved state
	 * and reports writes upward.
	 */
	import type { SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
	import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
	import type { FilterOption, SessionFilterState } from '$lib/utils/session-filters';
	import SidebarOpenPanels from './SidebarOpenPanels.svelte';
	import SessionFilterRow from './SessionFilterRow.svelte';
	import SidebarSessionContainer from './SidebarSessionContainer.svelte';
	import SidebarFooter from './SidebarFooter.svelte';
	import { heartbeatScope } from '$lib/services/jobs/heartbeat-scope.svelte';

	// ADR-0034 D2 — the heartbeat's ALWAYS set: paneled sessions plus the
	// current conversation, watched in every mode regardless of viewport.
	$effect(() => {
		heartbeatScope.setAlways([...paneledSessionIds, ...(current ? [current.sessionId] : [])]);
	});

	let {
		phase,
		message = '',
		current,
		visible,
		depthById = {},
		workspaces,
		paneledSessionIds = [],
		sessionDates,
		wsPills,
		presets,
		filter,
		spine,
		onspinechange,
		onfilterchange,
		oncreated,
		onreplace,
	}: {
		phase: 'loading' | 'ready' | 'error';
		message?: string;
		current: DsiSessionSummary | null;
		visible: DsiSessionSummary[];
		/** Nesting depths by sessionId (W4 task 4.1) — rows indent under
		 *  their family head; absent = depth 0 (plain row). */
		depthById?: Record<string, number>;
		workspaces: DsiWorkspaceSummary[];
		/** Open floor panels (W4) — paneled sessions leave the spine. */
		paneledSessionIds?: string[];
		/** Days holding at least one session — the spine date button's
		 *  calendar dots (2026-09-04). */
		sessionDates?: Set<string>;
		/** Workspace pills (existence from cwd, status from the registry). */
		wsPills: FilterOption[];
		presets: FilterOption[];
		/** Effective (self-healed) filter state. */
		filter: SessionFilterState;
		/** Spine view state (collapse, name filter, sub-agent toggle) —
		 *  owned + persisted by SidebarSessions; relayed to the rows. */
		spine: SpineGroupPrefs;
		onspinechange: (partial: Partial<SpineGroupPrefs>) => void;
		onfilterchange: (next: SessionFilterState) => void;
		/** Fresh session created via the footer's + New chat — owner adds
		 *  it to the floor (the preset rides along for the panel chip). */
		oncreated: (sessionId: string, agentPreset: string | null) => void;
		/** Replace chat (2026-08-31) — owner swaps the focused floor panel
		 *  onto the fresh session; absent = no Replace button renders. */
		onreplace?: (sessionId: string, agentPreset: string | null) => void;
	} = $props();
</script>

<div class="sessions" data-testid="sidebar-sessions">
	{#if phase === 'loading'}
		<p class="hint" data-testid="sidebar-sessions-loading">{t(m.loading)}</p>
	{:else if phase === 'error'}
		<p class="hint error" data-testid="sidebar-sessions-error" role="alert">{message}</p>
	{:else}
		<SidebarOpenPanels {workspaces} />
		<SessionFilterRow workspaces={wsPills} {presets} {filter} onchange={onfilterchange} {oncreated} registry={workspaces} />

		<!-- ADR-0034 D2 — the ALWAYS set (panels + current) is fed to the
		     heartbeat scope from the script effect below, not from markup. -->


		<SidebarSessionContainer
			{current}
			{visible}
			{depthById}
			{workspaces}
			{paneledSessionIds}
			{sessionDates}
			{spine}
			{onspinechange}
		/>
	{/if}

	<!-- The footer renders in EVERY phase (W0 e2e-net fix, 2026-10-09):
	     the version strip and the LanguageMenu are wire-independent — an
	     unreachable spine must not strip the locale switcher (the bare-/
	     locale e2e regressed when the footer sat inside the ready branch
	     only). New chat hosts its own dead-wire alert. -->
	<SidebarFooter
		preset={filter.preset}
		workspace={filter.workspace}
		{oncreated}
		{onreplace}
	/>
</div>

<style>
	.sessions {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.hint {
		padding: 0.5rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
	}

	.hint.error {
		color: var(--color-status-fail, var(--color-status-fail));
	}
</style>

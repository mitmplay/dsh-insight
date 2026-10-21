<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * SessionFilterRow — pill filters over a session list, now a thin
	 * composition (2026-09-04): SessionFilterHeader — the always-visible
	 * line carrying the collapse button, the `Filter by` summary, and
	 * the right-pinned meta controls (SessionFilterMeta: `All` + the
	 * count/workspace toggle) — over the folded dimension pills
	 * (Workspaces, Agents — workspaces lead since the 2026-09-04
	 * manual reorder; the divider trails the workspace group). Purely
	 * presentational — options arrive
	 * derived (session-filters), state lives in the parent, changes
	 * report back.
	 *
	 * The fold is the row's own state: EXPANDED on every load, never
	 * persisted — reload expands it again. The header line (summary +
	 * meta controls) stays visible folded or not; folding hides only
	 * the dimension pills. Header/chip/tooltip semantics live in
	 * SessionFilterHeader; the meta verbs (`All` reset, count view +
	 * the ghost-lift rule) live in SessionFilterMeta.
	 *
	 * Pills render only for dimensions that actually discriminate: one
	 * workspace or one preset in the data shows no pills for it (an "All"
	 * filter over a single value is decoration).
	 */
	import type { FilterOption, SessionFilterState } from '$lib/utils/session-filters';
	import type { DsiWorkspaceSummary } from '$lib/types';
	import SessionFilterHeader from './SessionFilterHeader.svelte';
	import Agents from '../common/layout/Agents.svelte';
	import Workspaces from '../common/layout/Workspaces.svelte';

	let {
		workspaces,
		presets,
		filter,
		onchange,
		oncreated,
		registry
	}: {
		workspaces: FilterOption[];
		presets: FilterOption[];
		filter: SessionFilterState;
		onchange: (next: SessionFilterState) => void;
		/** Pass-through: the header's meta postfix AddWorkspaceButton
		 *  reports the fresh session created in an adopted workspace. */
		oncreated: (sessionId: string, agentPreset: string | null, path: string) => void;
		/** Raw registry rows — threaded for the header's chip menu (ADR D4). */
		registry: DsiWorkspaceSummary[];
	} = $props();

	/** Expanded by default; never persisted — every load starts open. */
	let collapsed = $state(false);

	function pickWorkspace(key: string): void {
		onchange({ ...filter, workspace: filter.workspace === key ? null : key });
	}

	function pickPreset(key: string): void {
		onchange({ ...filter, preset: filter.preset === key ? null : key });
	}
</script>

<div class="filters" data-testid="session-filter-row">
	<SessionFilterHeader
		{workspaces}
		{presets}
		{filter}
		{collapsed}
		ontoggle={() => (collapsed = !collapsed)}
		{onchange}
		{oncreated}
		{registry}
	/>
	{#if !collapsed}
		<div class="pills" id="filter-pills" role="group" aria-label={t(m.filterSessions)}>
			<Workspaces
				{workspaces}
				selected={filter.workspace}
				onpick={pickWorkspace}
				divider={presets.length > 0}
				hideGhosts={filter.blankMode === 'workspace'}
			/>
			<Agents {presets} selected={filter.preset} onpick={pickPreset} />
		</div>
	{/if}
</div>

<style>
	/* Restyled 2026-08-26 — the SAME box grammar as the pinned panel
	   group above (SidebarOpenPanels .panel-group): purple
	   diagonal wash fading to transparent, accent-tinted border,
	   radius. The two collapsed headers read as siblings —
	   `Focused - X` over `Filter by - Y`.
	   Margins (not padding) separate the boxes: this row is NOT inside
	   a capped scroll pane, so margins are safe here.
	   Flipped 2026-09-06: 135deg runs top-left to bottom-right, so the
	   wash is light at the top-left and pools dark at the bottom-right. */
	.filters {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		padding: 0.25rem;
		min-width: 0;
		margin: 0.125rem 0;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		border-radius: 0.5rem;
		background: linear-gradient(135deg, transparent, color-mix(in srgb, var(--color-accent-purple) 26%, transparent));
	}

	.pills {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
		min-width: 0;
	}

	/* Every pill now lives in an extracted component — the header line
	   (SessionFilterHeader: collapse + summary + SessionFilterMeta's
	   `All`/count controls) and the dimension groups (Agents,
	   Workspaces) — each carrying its own self-contained styles:
	   scoped CSS here cannot reach their DOM. */
</style>

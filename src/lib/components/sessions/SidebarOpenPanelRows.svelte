<script module lang="ts">
	import { CornerDownRight } from '@lucide/svelte';
	import type { DsiWorkspaceSummary } from '$lib/types';
	import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
	import { familyRenderOrder, type FamilyRenderEntry } from '$lib/services/lineage/lineage';
	import RowButtonFold from './RowButtonFold.svelte';
	import RowButtonClose from './RowButtonClose.svelte';
	import RowButtonMoveDown from './RowButtonMoveDown.svelte';
	import RowButtonMoveUp from './RowButtonMoveUp.svelte';
	import WorkspaceRowItem from './WorkspaceRowItem.svelte';

	/** The member shape the host adapts the published rows to (both
	 *  kinds — panel and ghost rows carry the same PanelRow payload). */
	export type RowsRenderMember = {
		id: string;
		parent: string | null;
		order?: number;
		depth: number;
		row: PanelRow;
	};
	export type RowsRenderEntry = FamilyRenderEntry<RowsRenderMember, RowsRenderMember>;
</script>

<script lang="ts">
	/**
	 * SidebarOpenPanelRows — the expanded body of the sidebar's
	 * pinned-panel group (extracted from SidebarOpenPanels 2026-09-02):
	 * ONE interleaved sequence (familyRenderOrder, W6b) of panel rows at
	 * their floor positions and ghost adopt-views after the real ones.
	 * Purely presentational — every fact arrives as a prop (the derived
	 * lineage maps, the fold state, the floor length) and every action
	 * leaves as a callback; the host owns the registry, the fold state,
	 * and the workspace context.
	 *
	 * Mount-gated by the host's collapsed flag — collapsed, the host
	 * renders only its header and this component renders nothing.
	 */
	let {
		visibleRender,
		panelIndex,
		subtreeCount,
		directChildren,
		rowsLength,
		selectedPanelId,
		unfoldedParents,
		workspaces,
		onselect,
		onmove,
		ontogglefold,
		onclose,
		onadopt
	}: {
		/** The interleaved render sequence (familyRenderOrder over the
		 *  host's panel + ghost members). */
		visibleRender: RowsRenderEntry[];
		/** Panel index in floor order — the canMove fallback's i. */
		panelIndex: Map<string, number>;
		/** Descendants per session — the fold chevron's honest N. */
		subtreeCount: Map<string, number>;
		/** Direct children per session — the chevron renders when ≥1. */
		directChildren: Map<string, number>;
		/** Floor length — the canMove fallback's upper bound. */
		rowsLength: number;
		/** The focused panel's id — the selected row's field/ring/testid. */
		selectedPanelId: string | null | undefined;
		/** Fold state (read-only here): unfolded sessions keyed by id;
		 *  the chevron flips it through `ontogglefold`. */
		unfoldedParents: Record<string, boolean>;
		/** Host workspace registry — the authority for chip ghost styling. */
		workspaces: DsiWorkspaceSummary[];
		/** Row click — the host selects through the registry. */
		onselect: (row: PanelRow) => void;
		/** Move chevron — the host invokes the registry. */
		onmove: (panelId: string, dir: 'up' | 'down') => void;
		/** Fold chevron — the host flips its fold state. */
		ontogglefold: (parentSessionId: string) => void;
		/** Row X — the host removes the panel (workspace context write). */
		onclose: (panelId: string) => void;
		/** Ghost click — the host adopts the ghost as a real panel. */
		onadopt: (ghost: PanelRow) => void;
	} = $props();
</script>

<div class="group-rows" id="sidebar-panel-group-rows">
	<!-- One interleaved sequence (familyRenderOrder, W6b): panel rows
		     at their floor positions with REAL child panels directly
		     below their spawner (ADR worked example: s.agent 1 (✕) above
		     s.agent 2 (>)) and ghost clusters after the real ones — a
		     ghost sibling never wedges between a parent and its real
		     child (the 2026-08-27 adopt-order bug). -->
			{#each visibleRender as entry (entry.member.id)}
				{#if entry.kind === 'panel'}
					{@const row = entry.member.row}
					{@const i = panelIndex.get(row.panel.id) ?? 0}
					{@const sid = row.panel.kind === 'conversation' ? row.panel.sessionId : null}
					{@const kidN = sid === null ? 0 : (subtreeCount.get(sid) ?? 0)}
					{@const hasKids = sid !== null && (directChildren.get(sid) ?? 0) > 0}
					{@const canUp = row.canMoveUp ?? i > 0}
					{@const canDown = row.canMoveDown ?? i < rowsLength - 1}
					<div
						class="row panel-row"
						class:current={selectedPanelId === row.panel.id}
						class:dead={row.dead}
						class:doc-child={row.panel.kind === 'injected-doc'}
						role="button"
						tabindex="0"
						aria-current={selectedPanelId === row.panel.id ? 'page' : undefined}
						data-testid={selectedPanelId === row.panel.id ? 'sidebar-session-current' : 'sidebar-panel-row'}
						data-panel-id={row.panel.id}
						data-session-id={sid}
						data-depth={row.depth ?? 0}
						title={row.workspace ?? undefined}
						onclick={() => onselect(row)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onselect(row);
							}
						}}
					>
						<WorkspaceRowItem
							running={row.running}
							delegated={(row.runningDescendants ?? 0) > 0}
							count={row.runningDescendants ?? 0}
							depth={row.depth ?? 0}
							fork={row.fork === true}
							docChild={row.panel.kind === 'injected-doc'}
							wsChild={row.wsChild === true}
							workspace={row.workspace}
							{workspaces}
							label={row.title ?? sid ?? row.panel.id}
						/>
						{#if row.spawnerTitle}
							<!-- Orphan hint (ADR D4): the spawner exists on the host but
							     holds no panel here — the relation survives as text. -->
							<span class="spawned-by" data-testid="spawned-by">
								<CornerDownRight size={9} aria-hidden="true" />spawned by {row.spawnerTitle}
							</span>
						{/if}
						<span class="row-actions">
							<!-- Root-only controls (operator spec, 2026-08-28): the
							     family HEAD owns fold and order — a sub-agent row
							     (depth > 0, pinned under its open spawner) carries
							     ONLY its close button. Orphans render depth 0 (their
							     spawner left the floor) — they are their own root and
							     keep the full set. -->
							{#if (row.depth ?? 0) === 0}
								<RowButtonMoveUp can={canUp} onmove={() => onmove(row.panel.id, 'up')} />
								<RowButtonMoveDown can={canDown} onmove={() => onmove(row.panel.id, 'down')} />
								{#if hasKids}
									<RowButtonFold
										clusterCount={kidN}
										folded={sid === null || unfoldedParents[sid] !== true}
										ontoggle={() => ontogglefold(sid ?? '')}
									/>
								{/if}
							{/if}
							<RowButtonClose
								label={row.title ?? sid ?? row.panel.id}
								onclose={() => onclose(row.panel.id)}
							/>
						</span>
					</div>
				{:else}
					<!-- Ghost row (ADR D5): a spawned-session VIEW — no close, no
					     move; click adopts as a real panel (the route's doAdd pins
					     it below its spawner). Nested under its ghost parent at its
					     own published depth (I4 — never invisible). -->
					{@const g = entry.member.row}
					<div
						class="row ghost-row"
						class:dead={g.dead}
						role="button"
						tabindex="0"
						data-testid="sidebar-ghost-row"
						data-session-id={g.panel.kind === 'conversation' ? g.panel.sessionId : null}
						data-depth={g.depth ?? 1}
						title={g.workspace
							? `${g.workspace} — Open as a panel below its spawner`
							: 'Open as a panel below its spawner'}
						onclick={() => onadopt(g)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onadopt(g);
							}
						}}
					>
						<WorkspaceRowItem
							running={g.running}
							browser={g.panel.id.startsWith('glass-')}
							depth={g.depth ?? 1}
							workspace={g.workspace}
							{workspaces}
							label={g.title ?? (g.panel.kind === 'conversation' ? g.panel.sessionId : g.panel.id)}
						/>
						<span class="adopt-hint" aria-hidden="true">adopt</span>
					</div>
				{/if}
			{/each}
	</div>

<style>
	/* Rows wrapper (the aria-controls target) — same column grammar the
	   rows had as direct children, so wrapping changed nothing visually. */
	.group-rows {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	/* Row base — the GROUP's tightened padding (0.25rem/0.375rem): the
	   rows only ever render inside the host's group box, so the tighten-
	   one-notch rule IS the base (the spine rows below keep their
	   roomier 0.375rem/0.5rem padding, another cue that the two lists
	   are different things). */
	.row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.25rem 0.375rem;
		border-radius: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-text-primary, #212529);
		transition: background-color 0.15s ease;
	}

	/* Selected row (restyled 2026-08-26, LIGHT): accent field at 30%
	   over white (#c4dafc) + text-primary label + weight 600 + an
	   inset accent-deep ring. The old deep-navy inversion is GONE: its
	   white 12px label measured only ~4.3:1 (AA fail) and forced
	   per-state dot/chip overrides that each needed their own audit.
	   On this light field the row interior keeps its normal colors —
	   WorkspaceRowItem's defaults already clear every threshold here (label
	   #212529 10.86:1, run glyph 3.86:1, idle 4.54:1, chip 6.66:1;
	   calibrated script, 2026-08-26) — and selection is NEVER carried
	   by color alone: field + weight + ring + aria-current="page". */
	.row.current {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 30%, var(--color-surface-elevated));
		font-weight: 600;
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		/* Ring contrast (WCAG 1.4.11): 4.26:1 against the selected
		   field, 5.17:1 against the wash — visible from both sides. */
	}

	.row.panel-row {
		cursor: pointer;
	}

	/* Paneled-session NAME + WORKSPACE CHIP (2026-08-27 operator
	   request): a session holding a REAL panel renders its name AND its
	   workspace chip in darkviolet — one glance separates floor members
	   from ghost views (ghosts keep the default colors). The chip keeps
	   its grammar — ONE color per chip, the Folder icon follows the text
	   (WorkspaceRowItem's 2026-08-26 rule), so the override lands on .ws
	   itself, not .ws-label. var(--color-ws-violet) calibrated: name 6.56 white / 5.61
	   wash / 4.62 light-selected; chip 5.72 on its 10% blue tint and
	   5.64 on the grey ghost chip — AA 4.5:1 on every field the group
	   paints. Dead outranks paneled (the row says dead in red-800, the
	   same priority the idle dot takes). */
	.row.panel-row :global(.label),
	.row.panel-row :global(.ws) {
		color: var(--color-ws-violet);
	}

	.row.panel-row.dead:not(.current) :global(.label),
	.row.panel-row.dead:not(.current) :global(.ws) {
		color: var(--color-danger-wash-ink);
	}

	/* Paneled-session ROW BUTTONS (move up/down, close, fold — one
	   cluster, one color): darkviolet at opacity 0.7 — violet at the
	   default 0.6 fails WCAG 1.4.11's 3:1 on the light selected field
	   (2.89); 0.7 holds 3.39 worst-case (white 4.14 / wash 3.80 /
	   selected 3.39, calibrated 2026-08-27). The existing hover/focus
	   rules lift opacity to 1 (6.56/5.67/4.62). Dead rows keep the
	   red-800 inherit. The buttons live in the RowButton* children
	   (extracted 2026-08-27) as class-only roots, so every `.row-btn`
	   compound below is :global under the local row ancestors — the
	   WorkspaceRowItem :global(.label) precedent; one home for the palette. */
	.row.panel-row :global(.row-btn) {
		color: var(--color-ws-violet);
		opacity: 0.7;
	}

	.row.panel-row.dead:not(.current) :global(.row-btn) {
		color: var(--color-danger-wash-ink);
	}



	/* ── Lineage rows (2026-08-27 W3, ADR D4/D5) ─────────────────────────
	   Ghost: a spawned-session VIEW under its open spawner — same row
	   grammar, quieter voice (opacity, smaller label) + the adopt hint.
	   The row never indents (the Aligned Spine rule, 2026-09-01): the
	   depth cue is WorkspaceRowItem's branch slot in the workspace
	   column, so every column after it stays x-aligned across rows. */
	.row.ghost-row {
		cursor: pointer;
		font-size: 0.6875rem;
		opacity: 0.88;
	}

	.row.ghost-row:hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 20%, var(--color-surface-elevated));
		opacity: 1;
	}

	.row.ghost-row:focus-visible {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 20%, var(--color-surface-elevated));
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -2px;
	}

	.adopt-hint {
		flex-shrink: 0;
		font-size: 0.5625rem;
		font-style: italic;
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 30%, var(--color-navy-focus));
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.row.ghost-row:hover .adopt-hint,
	.row.ghost-row:focus-visible .adopt-hint {
		opacity: 1;
	}

	/* Orphan hint (ADR D4): a child panel whose spawner holds no panel —
	   the relation survives as text. Navy mix for AA at 9px (WorkspaceRowItem
	   chip grammar's measured family). */
	.spawned-by {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		max-width: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.5625rem;
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 30%, var(--color-navy-focus));
	}

	.spawned-by :global(svg) {
		flex-shrink: 0;
	}

	.row.panel-row:hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 20%, var(--color-surface-elevated));
	}

	/* Focus ring (WCAG 2.4.7) — the hover field alone is too close to
	   the wash to be a keyboard cue; the navy ring is the indicator
	   (8.86:1 on the wash — see the host header's focus ring). */
	.row.panel-row:focus-visible {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 20%, var(--color-surface-elevated));
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -2px;
	}

	.row.current.panel-row:hover,
	.row.current.panel-row:focus-visible {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 34%, var(--color-surface-elevated));
	}

	/* Honest 404 tint (commitment 7): the session died on the host — the
	 * row stays selectable/closeable, the tint says so. var(--color-danger-wash-ink)
	 * (red-800): 7.11:1 on the wash (the old 55/45 mix measured 2.08:1
	 * — its documented 5.28:1 never survived re-computation). The idle
	 * dot follows via the --si-idle custom property (it inherits
	 * through the WorkspaceRowItem boundary; scoped selectors cannot). */
	.row.dead:not(.current) {
		color: var(--color-danger-wash-ink);
		--si-idle: var(--color-danger-wash-ink);
	}

	/* Row interior (status glyph, workspace chip, label) lives in
	   WorkspaceRowItem — shared with the spine since 2026-08-26; its
	   defaults are contrast-verified on this wash and on the light
	   selected field, so no dot/chip overrides remain here. */

	/* Per-row action cluster (W4 close + move up/down): a tight button
	   group at the row's end — the row's 0.5rem flex gap would space
	   three sibling buttons apart; the cluster packs them at 0.125rem.
	   The -0.25rem optical bleed once lived on the close button; the
	   cluster owns it now (the last button's right edge). */
	.row-actions {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		margin-right: -0.25rem;
	}

	/* Row buttons — a quiet control revealed on hover/focus; the row's
	   select click and any button never collide (stopPropagation).
	   Opacity floor 0.6: the icons inherit the row's dark text color,
	   compositing to 3.61:1 on the wash and 3.37:1 on the selected
	   field (WCAG 1.4.11 3:1) — no per-state override needed since the
	   selected row went light (2026-08-26). */
	:global(.row-btn) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.6;
	}

	.row.panel-row:hover :global(.row-btn),
	:global(.row-btn:focus-visible) {
		opacity: 1;
	}

	:global(.row-btn:hover),
	:global(.row-btn:focus-visible) {
		background: var(--color-surface-hover, rgb(0 0 0 / 0.1));
		outline: none;
	}

	.row.current :global(.row-btn:hover),
	.row.current :global(.row-btn:focus-visible) {
		background: rgb(0 0 0 / 0.08);
	}
</style>

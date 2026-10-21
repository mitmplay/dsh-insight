<script lang="ts">
	/**
	 * RowSessionItem — ONE spine row: the anchor a session gets on
	 * the recency list (extracted from SidebarSessionsList,
	 * 2026-08-28). Owns everything a row IS: the seed href, the
	 * floor verbs (plain click adds a panel, Shift+click replaces the
	 * selected panel — ADR-0006 R5 verbs, reversed 2026-08-28), the
	 * workspace-path tooltip,
	 * the lineage depth (ADR D6 — forwarded to the interior; the row
	 * itself never indents, so every column after the workspace starts
	 * at the same x on every row), the shared interior
	 * (WorkspaceRowItem), and the trailing relative time.
	 *
	 * Presentational per row: no list logic lives here — the owner
	 * filters and maps sessions in. The anchor's default navigation
	 * is the fallback everywhere a floor is NOT mounted (the
	 * registry's graceful no-op lets the <a> navigate).
	 */
	import { relativeTime } from '$lib/utils/time';
	import WorkspaceRowItem from './WorkspaceRowItem.svelte';
	import RowJobBadge from './RowJobBadge.svelte';
	import {
		addPanelFromSidebar,
		replaceSelectedFromRegistry,
		panelRegistryActive
	} from '$lib/services/panels/panel-registry';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { conversationSeedUrl } from '$lib/utils/seed-url';
	import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

	let {
		session,
		depth = 0,
		workspaces
	}: {
		/** The session this row renders. */
		session: DsiSessionSummary;
		/** Nesting depth (ADR D6): 0 = flat row, N = sub-agent depth cue
		 *  rendered by the interior's workspace slot (never row padding). */
		depth?: number;
		/** Host workspace registry — the authority for chip ghost styling. */
		workspaces: DsiWorkspaceSummary[];
	} = $props();

	/** Seed deep link (?sessionKey=, ADR-0006 R1) — the agent chip rides
	 *  the session row, never the URL (R3); the ACTIVE profile rides
	 *  along so a middle-click opens the same desk, not the default one. */
	function conversationHref(): string {
		return conversationSeedUrl(session.sessionId, getWorkspaceState()?.profile ?? null);
	}

	/** Tooltip (W4 4.2): workspace path + affordance when on the floor.
	 *  (Row attribute — no props, no state: pure function of the row.
	 *  The cwd cue is EXTENDED, never replaced — commitment 5 — and
	 *  the floor hint only shows when a floor is actually mounted, so
	 *  the home-page spine and the pre-floor title contract stay
	 *  byte-identical.) */
	function rowTitle(): string | undefined {
		if (!panelRegistryActive()) return session.workspace ?? undefined;
		return session.workspace
			? `${session.workspace} — Shift+click to replace panel`
			: 'Shift+click to replace panel';
	}

	/** Row click — plain click adds a panel, Shift+click replaces the
	 *  selected panel (ADR-0006 R5 verbs, reversed 2026-08-28); with no
	 *  floor mounted the registry's no-op lets the anchor navigate. */
	function onRowClick(e: MouseEvent): void {
		const verb = e.shiftKey ? replaceSelectedFromRegistry : addPanelFromSidebar;
		const handled = verb({
			sessionId: session.sessionId,
			agentPreset: session.agentPreset
		});
		if (handled) {
			e.preventDefault();
		}
	}
</script>

<a
	class="row"
	class:child={depth > 0}
	href={conversationHref()}
	data-testid="sidebar-session-card"
	data-session-id={session.sessionId}
	data-depth={depth}
	title={rowTitle()}
	onclick={onRowClick}
>
	<WorkspaceRowItem
		running={session.running}
		workspace={session.workspace}
		{workspaces}
		label={session.title ?? 'untitled'}
		{depth}
		fork={session.parentSessionId != null && session.origin !== 'subagent'}
	/>
	<!-- The Job Badge (ADR-0026 D2): state ON the owner row, never a new
	     row. The badge's root stops propagation, so a badge or popover
	     click never fires the row's open/replace verbs. -->
	<RowJobBadge sessionId={session.sessionId} />
	<span class="time">{relativeTime(session.updatedAt)}</span>
</a>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.3rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-primary, #212529);
		transition: background-color 0.15s ease;
	}

	/* Nested sub-agent row (W4 task 4.1, ADR D6): same anchor grammar,
	   quieter voice — smaller label, same hover/click contract. The row
	   itself never indents (columns after the workspace stay x-aligned
	   across rows); the depth cue is WorkspaceRowItem's branch slot. */
	.row.child :global(.label) {
		font-size: 0.6875rem;
	}

	a.row:hover,
	a.row:focus-visible {
		background: var(--color-surface-hover, #e9ecef);
		outline: none;
	}

	/* Row interior (status glyph, workspace chip, label) lives in
	   WorkspaceRowItem — shared with the panel group since 2026-08-26. */

	.time {
		flex-shrink: 0;
		font-size: 0.625rem;
		color: var(--color-text-muted, #adb5bd);
		font-variant-numeric: tabular-nums;
	}
</style>

/**
 * floor-reads — the floor's READ-side views (ADR-0019 W3): the spine
 * joins, lineage/row derivations, and per-session lookup helpers that
 * the route template consumes. NO runes here: every getter is plain
 * re-computation over the reactive singletons (spineFeed, pageFeeds,
 * floor); reactivity comes from the ROUTE wrapping these getters in
 * its own $derived — the compile gate forbids exporting derived state
 * from a module, and the getters keep the read names identical.
 *
 * Write authority stays in floor-registry (D2); this module never
 * mutates floor state — it only reads it.
 */
import { SvelteMap } from 'svelte/reactivity';
import { spineFeed } from '$lib/services/conversation/spine-feed.svelte';
import { pageFeeds, type ColdLoad } from '$lib/services/workspace/page-feeds.svelte';
import { deriveLineage } from '$lib/services/lineage/lineage';
import { moveFactsFrom } from '$lib/services/lineage/lineage-move';
import type { DsiA2aExchangeView, DsiConversationPanel, DsiEntry } from '$lib/types';
import { floor } from './floor-registry.svelte';
import { sessionWorkspaceExplorer } from './floor-registry.svelte';
import {
	ghostPanelRowsFor,
	openSessionIdsOf,
	panelRowsFor,
	rowFactsByPanelId as rowFactsOf,
	type PanelRowsCold
} from './panel-rows';

/** The read views, one getter each — the route's $derived wrappers
 *  cache per tick exactly like the old in-component deriveds did. */
export const floorReads = {
	get spineRows() {
		return spineFeed.rows;
	},
	get spinePresets() {
		return spineFeed.presets;
	},
	get spineWorkspaces() {
		return spineFeed.workspaces;
	},
	get spineTitles() {
		const t: Record<string, string | null> = {};
		for (const s of this.spineRows) t[s.sessionId] = s.title;
		return t;
	},
	/** Conversation branch of the floor (ADR D6): a manager slot never
	 *  reaches lineage, the spine joins, or the cold ladder by type. */
	get conversationPanels() {
		return floor.panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation');
	},
	get lineageFacts() {
		return deriveLineage(this.spineRows, this.conversationPanels);
	},
	get moveFacts() {
		return moveFactsFrom(this.lineageFacts, openSessionIdsOf(floor.panels));
	},
	get rowInputs() {
		return {
			panels: floor.panels,
			spineRows: this.spineRows,
			coldCache: pageFeeds.coldCache as Readonly<Record<string, PanelRowsCold | undefined>>,
			deadSessions: pageFeeds.deadSessions,
			edgeCache: pageFeeds.edgeCache,
			lineageFacts: this.lineageFacts,
			moveFacts: this.moveFacts
		};
	},
	get panelRows() {
		return panelRowsFor(this.rowInputs);
	},
	get rowFactsByPanelId() {
		return rowFactsOf(this.panelRows);
	},
	get ghostRows() {
		return ghostPanelRowsFor(this.rowInputs);
	},
	/** Per-panel width-badge phase — 'live' while its width leaves the
	 *  drag snapshot, 'fading' through the 10s afterglow. Reads BOTH
	 *  state inputs UNCONDITIONALLY before any early return: a $derived
	 *  only tracks what an executed path reads. */
	get badgeByPanelId() {
		const row = floor.panels;
		const drag = floor.drag;
		const map = new SvelteMap<string, 'live' | 'fading'>();
		if (drag !== null) {
			for (let i = 0; i < row.length; i++) {
				if (row[i].width !== drag.widths[i]) map.set(row[i].id, 'live');
			}
			return map;
		}
		if (floor.widthBadgeFading) {
			for (const id of floor.widthBadgeIds) map.set(id, 'fading');
		}
		return map;
	}
};

/** Live panel title (2026-08-24 header bug): spine (host truth, 5s
 *  refresh) first, cold-load fallback — the SAME merge the sidebar rows
 *  use; a session the host names only AFTER its panel opened still heals
 *  on the next spine tick. */
export function panelTitleFor(sessionId: string): string | null {
	return spineFeed.rows.find((s) => s.sessionId === sessionId)?.title ?? pageFeeds.coldCache[sessionId]?.title ?? null;
}

/** Live panel workspace (2026-08-25): the SAME spine-first merge — the
 *  runtime dual fetch carries no session row, so the spine heals the
 *  workspace chip for restored/sidebar-added panels. */
export function panelWorkspaceFor(sessionId: string): string | null {
	return spineFeed.rows.find((s) => s.sessionId === sessionId)?.workspace ?? pageFeeds.coldCache[sessionId]?.workspace ?? null;
}

/** Live parent session id (2026-09-01 fork lineage): spine-only plus
 *  the add-time edge cache for the first ticks (fork child). */
export function panelParentFor(sessionId: string): string | null {
	return spineFeed.rows.find((s) => s.sessionId === sessionId)?.parentSessionId ?? pageFeeds.edgeCache[sessionId] ?? null;
}

/** Live agent preset for a session — panel entry first, spine row
 *  fallback (ADR-0006 R3: the agent rides the session). */
export function agentFor(panel: DsiConversationPanel): string | null {
	return panel.agentPreset ?? spineFeed.rows.find((s) => s.sessionId === panel.sessionId)?.agentPreset ?? null;
}

/** Agent chip label (DSH picker parity): the host's display name when
 *  the catalog carries one, else the raw id. Display ONLY. */
export function agentLabelFor(panel: DsiConversationPanel): string | null {
	const id = agentFor(panel);
	if (id === null) return null;
	return spineFeed.presets.find((p) => p.id === id)?.name ?? id;
}

/** One panel's sender-side ledger rows, newest first (W4 4.2). */
export function a2aRowsFor(sessionId: string): DsiA2aExchangeView[] {
	return spineFeed.a2aRows.filter((r) => r.fromSession === sessionId);
}

/** The file panel's root (the copy fallback): its explorer's root when
 *  open (Shared Tree D1), else the session's workspace. */
export function filePanelRoot(sessionId: string): string {
	return sessionWorkspaceExplorer(sessionId)?.root ?? panelWorkspaceFor(sessionId) ?? '';
}

/** Seed cold data — validated out of the seed route's server load
 *  synchronously at init, BEFORE the seed-strip replaceState can empty
 *  page.data (SSR parity for the seed path). */
export function seedColdOf(data: unknown): ColdLoad | undefined {
	const d = data as
		| {
				sessionId?: string;
				title?: string | null;
				workspace?: string | null;
				agentPreset?: string | null;
				entries?: DsiEntry[];
				lastSeq?: number;
				running?: boolean;
				hasMore?: boolean;
				pendingAnswers?: ColdLoad['pendingAnswers'];
				settledAnswers?: ColdLoad['settledAnswers'];
				permission?: ColdLoad['permission'];
				imageLimits?: ColdLoad['imageLimits'];
				knobEvents?: ColdLoad['knobEvents'];
				deliverables?: ColdLoad['deliverables'];
		  }
		| undefined;
	return d && typeof d.sessionId === 'string' && Array.isArray(d.entries)
		? {
				title: d.title ?? null,
				workspace: d.workspace ?? null,
				agentPreset: d.agentPreset ?? null,
				entries: d.entries,
				lastSeq: d.lastSeq ?? -1,
				running: d.running ?? false,
				hasMore: d.hasMore ?? false,
				pendingAnswers: d.pendingAnswers ?? [],
				settledAnswers: d.settledAnswers ?? [],
				permission: d.permission ?? null,
				imageLimits: d.imageLimits ?? null,
				knobEvents: d.knobEvents ?? [],
				deliverables: d.deliverables ?? []
		  }
		: undefined;
}

/**
 * panel-rows.ts — the sidebar's panel-row derivations, extracted verbatim
 * from the workspace route (KB "The Floor Decomposition" E1, 2026-09-06;
 * ADR "The Manager in the Panel" D6/D10). PURE functions over plain
 * inputs — the route feeds the floor state and renders what comes out; no
 * `$state`, no fetch, no component imports (S7: this is a plain .ts).
 *
 * KIND (ADR D6): a manager panel derives a kind-honest row — title
 * 'Prompt Manager', never running, never dead, depth 0, no lineage keys — and
 * conversely never joins a session-keyed lookup: every spine/cold join is
 * guarded to the conversation branch.
 */
import type { DsiConversationPanel, DsiPanelEntry, DsiSessionSummary } from '$lib/types';
import type { LineageFacts } from '$lib/services/lineage/lineage';
import { ghostRowsFor } from '$lib/services/lineage/lineage';
import { movePanelLineage, type MoveFacts } from '$lib/services/lineage/lineage-move';
import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
import { SYSTEM_PROMPT_DISPLAY_PATH } from '$lib/services/conversation/injected-shelf';

/** The manager row's label — the ADR §8 pinned string (W5 renders it as
 *  the sidebar row text and the `Focused - Prompt Manager` chip). */
export const MANAGER_ROW_TITLE = 'Prompt Manager';

/** The settings row's label per target — the editor row's pinned strings
 *  (Settings Panel ADR D3; sidebar row text and the focused chip). */
export const SETTINGS_ROW_TITLE: Record<'dsi' | 'dsh', string> = {
	dsi: 'DSI Settings',
	dsh: 'DSH Settings'
};

/** The document child's lineage paint (Loadinjected ADR D3): MAROON
 *  #800000 — the third depth-paint color, distinct from the fork branch's
 *  GREEN and the spawned-child VIOLET (#9400d3). Render-side only: the
 *  sidebar derives the paint from the row's kind; no panel entry stores it. */
export const DOC_CHILD_PAINT = 'var(--color-doc-child)';

/** The workspace child's lineage paint (2026-09-10): BLUE #0066cc — the
 *  fourth depth-paint color, distinct from the fork GREEN, the spawned
 *  VIOLET, and the doc MAROON, so an explorer/file row reads as the
 *  workspace pair, never as a sub-agent. Blue ≈ 5.4:1 on white clears the
 *  3:1 non-text floor on every field the row paints (the fork calibration
 *  applies). Render-side only, like the other paints. */
export const WORKSPACE_CHILD_PAINT = '#0066cc';

/**
 * The row/column title for an injected-doc member (ADR D7): the synthetic
 * system-prompt member reads 'system prompt — latest epoch' so it is never
 * confused with a real file; every other member shows its display path.
 * @param displayPath the member's shelf name.
 * @returns the honest title.
 */
export function injectedDocTitle(displayPath: string): string {
	return displayPath === SYSTEM_PROMPT_DISPLAY_PATH
		? 'system prompt — latest epoch'
		: displayPath;
}

/**
 * The explorer row/column title (Workspace Explorer W3, ADR D4): the
 * workspace NAME — the root's basename; a separator-only root shows the
 * root itself (the DSH FilesBody title pattern, 4 lines by design).
 */
export function workspaceExplorerTitle(root: string): string {
	return root.split(/[\\/]/).filter((p) => p.length > 0).pop() ?? root;
}

/** The file panel's row title (W4 ADR D2): the path's basename. */
export function workspaceFileTitle(path: string): string {
	return path.split('/').filter((p) => p.length > 0).pop() ?? path;
}

/**
 * The floor/lens header label per panel kind — the ONE source both the
 * column and the loupe read (The Loupe for Every Panel, 2026-09-08;
 * extracted from PanelColumn's inline ternary). The manager, settings,
 * and injected-doc kinds get their pinned variant titles; the
 * conversation branch gets undefined — its header is the session id +
 * copy button verbatim.
 * @param panel any floor panel entry.
 * @returns the variant title, or undefined for a conversation header.
 */
export function panelHeaderLabel(panel: DsiPanelEntry): string | undefined {
	if (panel.kind === 'terminal') return 'Terminal';
	if (panel.kind === 'browser') return 'Browser';
	if (panel.kind === 'prompt-manager') return MANAGER_ROW_TITLE;
	if (panel.kind === 'skill-shelf') return 'Skill Shelf';
	if (panel.kind === 'plugin-rack') return 'Plugin Rack';
	if (panel.kind === 'settings-editor') return SETTINGS_ROW_TITLE[panel.target];
	if (panel.kind === 'injected-doc') return injectedDocTitle(panel.displayPath);
	// The explorer variant (2026-09-11): the column header labels the
	// WORKSPACE NAME (the body renders no title of its own).
	// The Settings Tree ADR 2026-09-18 D3: a titled explorer (the settings
	// home) prints its title instead of the root's basename.
	if (panel.kind === 'workspace-explorer') return panel.title ?? workspaceExplorerTitle(panel.root);
	// The file variant (2026-09-11): same rule — the header labels the
	// FILE NAME (basename); the full path rides the copy button.
	if (panel.kind === 'workspace-file') return workspaceFileTitle(panel.path);
	return undefined;
}

/** Cold-row facts the derivations read — structural: the route's ColdLoad
 *  satisfies it without importing the route's local interface. */
export interface PanelRowsCold {
	title: string | null;
	workspace: string | null;
	running: boolean;
}

/** Everything the row derivations need — the route's per-tick inputs. */
export interface PanelRowsInput {
	panels: readonly DsiPanelEntry[];
	spineRows: readonly DsiSessionSummary[];
	coldCache: Readonly<Record<string, PanelRowsCold | undefined>>;
	deadSessions: Readonly<Record<string, string>>;
	edgeCache: Readonly<Record<string, string>>;
	lineageFacts: LineageFacts;
	moveFacts: MoveFacts;
}

/** Open-panel session ids — floor membership for display facts AND the
 *  move facts: parent edges only count while the spawner holds a panel
 *  (an orphan child heads its own unit — ADR §8 "free"). Conversation
 *  branch only (ADR D6: a manager panel carries no session). */
export function openSessionIdsOf(panels: readonly DsiPanelEntry[]): Set<string> {
	return new Set(
		panels
			.filter((p): p is DsiConversationPanel => p.kind === 'conversation')
			.map((p) => p.sessionId)
	);
}

/**
 * One sidebar row per open panel (W4 4.1/4.3) — title/workspace from the
 * spine summary (live) falling back to cold load; dead/running honest.
 * Lineage display facts (W3): depth degrades to 0 when the immediate
 * parent is not on the floor (orphan — the hint carries the relation,
 * D4); move-button visibility rides movePanelLineage (null = not
 * offered). Manager rows (ADR D6/D10): the pinned manager facts above.
 * Derived every tick, never stored (ADR D2).
 */
export function panelRowsFor(input: PanelRowsInput): PanelRow[] {
	const { panels, spineRows, coldCache, deadSessions, edgeCache, lineageFacts, moveFacts } = input;
	const openSessionIds = openSessionIdsOf(panels);
	return panels.map<PanelRow>((p, index) => {
		if (p.kind === 'browser') {
			// ADR-0036 Amendment 2: the glass is FAMILY — the roster row paints
			// the sub-agent lineage costume: parent edge = openedBy, depth one
			// below the opener (degrades to 0 if the opener's panel is gone —
			// transient at worst, the D5 cascade kills the glass with it). NO
			// positional move verbs: the glass travels with the opener's family
			// block (the injected-doc grammar — moves are the family head's
			// verbs, lineage-move's browser branches carry it).
			const parentOpen = p.openedBy !== undefined && openSessionIds.has(p.openedBy);
			const openerDepth =
				p.openedBy !== undefined ? (lineageFacts.depthById.get(p.openedBy) ?? 0) : 0;
			return {
				panel: p,
				title: 'Browser',
				workspace: null,
				dead: false,
				running: false,
				depth: parentOpen ? openerDepth + 1 : 0,
				runningDescendants: 0,
				kind: 'panel' as const,
				parentSessionId: p.openedBy ?? null,
				fork: false,
				spawnerTitle: null,
				// ADR-0037 D4's wire slot, panel half (2026-10-22): the folded
				// glass ghost ships siblingIndex -1, so the SUMMONED glass
				// must too — without it the sibling merge reads the missing
				// order as Infinity and the roster drops the browser BELOW
				// the sub-agent ghosts the moment it flips kind (the
				// reported summon-reorder bug).
				siblingIndex: -1,
				canMoveUp: false,
				canMoveDown: false
			};
		}
		if (p.kind === 'terminal' || p.kind === 'prompt-manager' || p.kind === 'settings-editor' || p.kind === 'skill-shelf' || p.kind === 'plugin-rack') {
			// Kind-honest non-session facts (ADR §8 required case; the
			// settings-editor branch rides the same rule — Settings Panel
			// ADR D3): never running/dead, depth 0, no lineage keys; move
			// verbs are positional (neither belongs to a family).
			const title =
				p.kind === 'terminal'
					? 'Terminal'
					: p.kind === 'prompt-manager'
						? MANAGER_ROW_TITLE
					: p.kind === 'skill-shelf'
						? 'Skill Shelf'
						: p.kind === 'plugin-rack'
						? 'Plugin Rack'
						: p.kind === 'settings-editor'
							? SETTINGS_ROW_TITLE[p.target]
							: '';
			return {
				panel: p,
				title,
				workspace: null,
				dead: false,
				running: false,
				depth: 0,
				runningDescendants: 0,
				kind: 'panel',
				parentSessionId: null,
				fork: false,
				spawnerTitle: null,
				canMoveUp: index > 0,
				canMoveDown: index < panels.length - 1
			};
		}
		if (p.kind === 'workspace-explorer' || p.kind === 'workspace-file') {
			// Kind-honest live-workspace facts (Workspace Explorer W3), with
			// the Shared Tree ADR (2026-09-17, D3) applied: the explorer is a
			// NON-family panel — the row reads exactly like a root (non-fork)
			// conversation row: depth 0, no parent edge, no wsChild branch
			// line, move verbs from the SAME movePanelLineage grammar every
			// conversation row uses (the explorer's block is its explorer
			// unit — the file still travels with it, the below-explorer slot
			// rule stands). Never running/dead: it renders a workspace.
			return {
				panel: p,
				title:
					p.kind === 'workspace-file'
						? workspaceFileTitle(p.path)
						: (p.title ?? workspaceExplorerTitle(p.root)), // Settings Tree D3: titled explorer
				workspace: null,
				dead: false,
				running: false,
				depth: 0,
				runningDescendants: 0,
				kind: 'panel',
				parentSessionId: null,
				fork: false,
				spawnerTitle: null,
				canMoveUp: movePanelLineage(panels, p.id, 'up', moveFacts) !== null,
				canMoveDown: movePanelLineage(panels, p.id, 'down', moveFacts) !== null
			};
		}
		if (p.kind === 'injected-doc') {
			// Document child (Loadinjected ADR D3): row-level lineage —
			// parentSessionId = sourceSessionId, depth 1, fork false,
			// spawnerTitle null — WITHOUT joining the session family map.
			// Flat depth 1 (the ADR pins it; the conversation orphan degrade
			// does not apply). The maroon paint (DOC_CHILD_PAINT) rides the
			// kind at render time; it is never stored here. Never dead or
			// running: the panel renders a record, not a live session.
			return {
				panel: p,
				title: injectedDocTitle(p.displayPath),
				workspace: null,
				dead: false,
				running: false,
				depth: 1,
				runningDescendants: 0,
				kind: 'panel',
				parentSessionId: p.sourceSessionId,
				fork: false,
				spawnerTitle: null,
				// The FAMILY grammar (consolidated 2026-09-07): a document
				// child travels with its source — moves are not offered (the
				// manager's positional verbs are not this row's grammar).
				canMoveUp: false,
				canMoveDown: false
			};
		}
		const summary = spineRows.find((s) => s.sessionId === p.sessionId);
		const cold = coldCache[p.sessionId];
		const parentSessionId = summary?.parentSessionId ?? edgeCache[p.sessionId] ?? null;
		const parentOpen = parentSessionId !== null && openSessionIds.has(parentSessionId);
		const spawnerTitle =
			parentSessionId !== null && !parentOpen
				? (spineRows.find((s) => s.sessionId === parentSessionId)?.title ?? parentSessionId)
				: null;
		return {
			panel: p,
			title: summary?.title ?? cold?.title ?? null,
			workspace: summary?.workspace ?? cold?.workspace ?? null,
			dead: deadSessions[p.sessionId] !== undefined,
			running: summary?.running ?? cold?.running ?? false,
			depth: parentOpen ? (lineageFacts.depthById.get(p.sessionId) ?? 0) : 0,
			runningDescendants: lineageFacts.runningDescendants.get(p.sessionId) ?? 0,
			kind: 'panel' as const,
			parentSessionId,
			fork: parentSessionId !== null && (summary?.origin ?? null) !== 'subagent',
			spawnerTitle,
			siblingIndex:
				parentSessionId !== null
					? lineageFacts.childrenByParent
							.get(parentSessionId)
							?.findIndex((k) => k.sessionId === p.sessionId)
					: undefined,
			canMoveUp: movePanelLineage(panels, p.id, 'up', moveFacts) !== null,
			canMoveDown: movePanelLineage(panels, p.id, 'down', moveFacts) !== null
		};
	});
}

/**
 * Row facts keyed by panel id — the floor header's move-chevron
 * visibility rides the SAME canMoveUp/Down facts the sidebar rows use
 * (ADR D4: a cross-family move is not OFFERED, not merely blocked —
 * left≡up, right≡down per doMovePanel). Index-based visibility offered
 * chevrons that movePanelLineage silently no-oped (probe-verified
 * 2026-08-27: a pinned first child mid-floor, an orphan before W6).
 */
export function rowFactsByPanelId(rows: readonly PanelRow[]): Map<string, PanelRow> {
	return new Map(rows.map((r) => [r.panel.id, r]));
}

/**
 * Ghost rows (ADR D5): sub-agents visible under their OPEN parent
 * panels — views, never panels; a ghost's PanelRow carries a SYNTHETIC
 * panel entry (id `ghost-<sessionId>`) that no registry action resolves
 * to (select/remove no-ops). Published beside rows; the panel group
 * renders them in W3. Ghosts are always conversation-shaped.
 */
export function ghostPanelRowsFor(input: PanelRowsInput): PanelRow[] {
	const { panels, spineRows, coldCache, deadSessions, lineageFacts } = input;
	const cold = (sessionId: string) => coldCache[sessionId];
	return ghostRowsFor(
		panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation'),
		spineRows,
		lineageFacts
	).map<PanelRow>((g) => ({
		panel: {
			id: `ghost-${g.sessionId}`,
			kind: 'conversation',
			sessionId: g.sessionId,
			agentPreset: null,
			width: 0
		},
		title: g.title ?? cold(g.sessionId)?.title ?? null,
		workspace: spineRows.find((s) => s.sessionId === g.sessionId)?.workspace ?? null,
		dead: deadSessions[g.sessionId] !== undefined,
		running: g.running,
		depth: g.depth,
		runningDescendants: lineageFacts.runningDescendants.get(g.sessionId) ?? 0,
		kind: 'ghost' as const,
		parentSessionId: g.parentSessionId,
		siblingIndex: lineageFacts.childrenByParent
			.get(g.parentSessionId)
			?.findIndex((k) => k.sessionId === g.sessionId)
	}));
}
/**
 * The folded-glass ghost rows (ADR-0037 D4, extracted 2026-10-24 — the
 * Glass Close Ladder task 2.2): the ONE derivation the route renders.
 * Pure over the slot mirror — a removeBrowserSlot prune drops the ghost
 * (roster) and the spine nest in the same stroke (Ladder ADR D4).
 */
export function foldedGlassRowsFor(
	slots: readonly { index: number; sessionId?: string; openedBy?: string; folded?: boolean }[],
	depthOf: (sessionId: string) => number,
	titleFor: (sessionId: string) => string | null
): PanelRow[] {
	return slots
		.filter((s) => s.folded && s.sessionId && s.openedBy)
		.map<PanelRow>((s) => ({
			panel: {
				id: 'glass-' + s.sessionId,
				kind: 'conversation',
				sessionId: s.sessionId as string,
				agentPreset: null,
				width: 0
			},
			title: 'Browser — ' + (titleFor(s.openedBy as string) ?? (s.openedBy as string)),
			workspace: null,
			dead: false,
			running: true,
			depth: depthOf(s.openedBy as string) + 1,
			runningDescendants: 0,
			kind: 'ghost' as const,
			parentSessionId: s.openedBy as string,
			siblingIndex: -1 // ADR-0037 D4: the glass flushes FIRST under its opener
		}));
}
/**
 * Workspace context — the ONLY root→descendants STATE channel of the panel
 * floor (ADR-0006 R6, Panel Floor W3 task 3.3; consumed by the sidebar tree
 * in W4). Actions flow up through panel-registry (leaf→root); this module
 * carries the reactive workspace state DOWN: the open panels and the
 * selected panel id, plus the state operations the panel list needs
 * (select / remove — selection and removal ARE state operations, not
 * registry actions).
 *
 * Svelte 5 module-level $state in a .svelte.ts file is reactive for every
 * consumer that reads it (the same mechanism DSI's store/orchestrator
 * already use). The workspace route calls setWorkspaceState at mount and
 * null on destroy; any component reads getWorkspaceState().
 *
 * Plain data + functions — no component imports, no Svelte component
 * coupling: the sidebar tree imports only this module.
 */
import type { DsiPanelEntry } from '$lib/types';

/** One sidebar panel row's display state, derived by the floor owner. */
export interface PanelRow {
	/** The open panel (id, sessionId, agentPreset, width). For ghost rows
	 *  (kind 'ghost') this is a SYNTHETIC carrier — id `ghost-<sessionId>`,
	 *  never a floor panel id; select/remove are no-ops for it. */
	panel: DsiPanelEntry;
	/** Session title — the row's label, ?? id when unknown. */
	title: string | null;
	/** Session cwd — the row's chip + title tooltip. */
	workspace: string | null;
	/** The host no longer knows this session (honest 404 tint). */
	dead: boolean;
	/** Live dot — the poller's running flag, false when unknown. */
	running: boolean;
	/** Lineage indent depth (2026-08-27, ADR D4): root 0, child 1,
	 *  grandchild 2 — OPTIONAL so existing publishers/factories keep
	 *  compiling (svelte-check covers tests/**); consumers default 0. */
	depth?: number;
	/** Live running DESCENDANTS count (ADR D3's color channel ×N badge);
	 *  optional for the same reason; consumers default 0. */
	runningDescendants?: number;
	/** Row species (ADR D5): 'panel' = a real floor panel (default);
	 *  'ghost' = a spawned-session view under its open parent — renders
	 *  indented, click adopts, never closeable/movable. */
	kind?: 'panel' | 'ghost';
	/** Immediate spawner's session id (2026-08-27 W3): the ghost's
	 *  ANCHOR — which parent row it nests under — and the panel row's
	 *  orphan signal (parent set but no open panel carries it). Optional
	 *  display fact; consumers default null. */
	parentSessionId?: string | null;
	/** Spawner's resolved title for the orphan hint ("spawned by …"),
	 *  pre-resolved by the route (components never read the spine).
	 *  Absent on non-orphans; consumers default null. */
	spawnerTitle?: string | null;
	/** Wire position among the parent's children (lineage order,
	 *  2026-08-28) — the sidebar's sibling-merge key: children render in
	 *  wire order (panels and ghosts interleaved), so an adoption flips
	 *  a row's kind in place. Route-derived; absent → legacy order. */
	siblingIndex?: number;
	/** Move-button visibility (ADR D4 clamp): the route derives these
	 *  from movePanelLineage (null = not offered); the component only
	 *  renders. Defaults fall back to positional logic (pre-lineage
	 *  publishers keep today's behavior). */
	canMoveUp?: boolean;
	canMoveDown?: boolean;
	/** Fork child (2026-09-01): a parent edge without origin 'subagent'.
	 *  Depth > 0 + fork paints the branch tree line GREEN — one glance
	 *  separates fork children from spawned children in the same slot.
	 *  Optional; absent/false keeps the muted spawn line. */
	fork?: boolean;
	/** Workspace child (2026-09-10): an explorer/file row — the branch
	 *  tree line paints WORKSPACE BLUE, separating the workspace pair
	 *  from a spawned sub-agent (VIOLET) or a fork (GREEN). Optional;
	 *  absent/false keeps the muted spawn line. */
	wsChild?: boolean;
	/** Coarse origin passthrough (ADR-0057 D1, Scheduled Mark): the
	 *  spine summary's origin — CLOSED union, mirroring DsiSessionSummary
	 *  (the synthetic 'browser' is the folded-glass spine species; ghost
	 *  and glass rows stay null). DISPLAY ONLY — the row-item layer
	 *  derives a boolean for the SCH pill; no behavior keys to it
	 *  (ADR-0057 D3). Optional; consumers default null. */
	origin?: 'subagent' | 'scheduled' | 'browser' | null;
}

/** The state the floor owner publishes to descendants. */
export interface WorkspaceState {
	/** Sidebar rows — one per open panel, derived in the owner. */
	rows: PanelRow[];
	/** Ghost rows (2026-08-27, ADR D5) — sub-agents visible under their
	 *  OPEN parent panels, derived by the owner on every spine tick.
	 *  OPTIONAL so every pre-lineage publisher/test harness keeps
	 *  compiling; consumers read `ghosts ?? []`. Rendered by the panel
	 *  group (W3), never the spine. */
	ghosts?: PanelRow[];
	/** Selected panel's `id`; null when no panels are open. */
	selectedPanelId: string | null;
	/** The active workspace profile (?profile=, sanitized) — keys the
	 *  localStorage desk (`dsi-panels_<profile>`); null = default desk.
	 *  Sidebar components append it to seed URLs they build so a full
	 *  navigation (new chat, adopt workspace, middle-click) stays on the
	 *  SAME desk instead of silently dropping to the default one. */
	profile: string | null;
	/** Select a panel by id (panel-list row click lands here). */
	select: (panelId: string) => void;
	/** Remove a panel by id (panel-list row close + panel 404 card close). */
	remove: (panelId: string) => void;
}

/** Module-level reactive state — null until the workspace route mounts. */
let workspaceState = $state<WorkspaceState | null>(null);

/**
 * Publish (or withdraw, on destroy) the workspace state. The route owns the
 * arrays; publishing here only exposes references — mutations stay in the
 * route's handlers, so there is exactly one owner.
 */
export function setWorkspaceState(next: WorkspaceState | null): void {
	workspaceState = next;
}

/**
 * Read the workspace state.
 * @returns the published state, or null when no workspace route is mounted
 *          (null-safe by design — a sidebar rendered outside the floor
 *          simply sees no panels; commitment: graceful, never a crash).
 */
export function getWorkspaceState(): WorkspaceState | null {
	return workspaceState;
}

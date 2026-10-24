/**
 * Panel registry — the ONLY leaf→root action channel of the panel floor
 * (ADR-0006, 2026-08-24). Sidebar rows, panel-list rows, and resize gutters
 * are deeply nested leaves that must not carry callback props up through
 * AppSidebar/SidebarSessions/SessionsList — instead they invoke a module-
 * level action here, and the workspace route (the floor owner) has
 * registered the real handler.
 *
 * Shape follows the OCI ControlRail precedent: register*(fn|null) setters
 * owned by the route's mount/destroy lifecycle, invoke functions returning
 * boolean (false = no handler → graceful no-op, never a crash in a leaf).
 *
 * Plain TS, no Svelte imports: the registry is a mutable action table, not
 * reactive state. Root→descendants STATE flows through workspace-context
 * (added in Wave 3); this module carries ACTIONS only, one direction.
 */

/** What the route needs to open a panel for a sidebar session row.
 *
 * KIND UNION (2026-09-06, ADR The Manager in the Panel D6/D7): the request
 * is kind-tagged like the floor slot it creates. The conversation branch is
 * the legacy shape — `kind` stays OPTIONAL there so every pre-D6 caller
 * literal (sidebar rows, chips, ControlBar, /new, fork) compiles unchanged
 * and narrows to the session path; the manager branch REQUIRES
 * `kind: 'prompt-manager'` and carries no sessionId — the type makes the
 * session path unreachable for it. */
export type PanelAddRequest =
	| ConversationPanelAddRequest
	| TerminalPanelAddRequest
	| ManagerPanelAddRequest
	| SettingsHomePanelAddRequest
	| InjectedDocAddRequest
	| SkillShelfPanelAddRequest
	| PluginRackPanelAddRequest;

export interface ConversationPanelAddRequest {
	/** 'conversation' (default when absent — the pre-D6 legacy shape). */
	kind?: 'conversation';
	sessionId: string;
	/** Preset chip shown in the panel header; null when the row carries none. */
	agentPreset: string | null;
	/** True when the action wants the fresh panel's composer FOCUSED when
	 *  the panel mounts (the /new successor swap — the typed cursor lands
	 *  where the operator is about to type). One-shot: the floor consumes
	 *  it at that panel's first mount; a restored floor (page reload)
	 *  never sets it, so a reload never steals focus. Default false. */
	focus?: boolean;
	/** AFTER-SOURCE placement (the fork child, 2026-09-01): land the new
	 *  panel directly BELOW the panel showing THIS session id — the
	 *  anchor source keeps its slot, the newcomer takes the next index.
	 *  Anchoring rides the request, never the global selection, so a
	 *  click during the caller's async gap cannot move the anchor. The
	 *  plain branch anchors here; when the anchor holds no panel (or the
	 *  field is absent) the focused-slot default applies. Lineage
	 *  placement (pinned/adopt-family) ignores this: the pin is the
	 *  stronger invariant. */
	afterSessionId?: string;
	/** KEEP the current selection after the insert (the /new --add
	 *  request, 2026-09-06): the newcomer lands to the right of its
	 *  anchor but the focused panel STAYS focused — insertPanel's
	 *  select-the-newcomer default is undone for this request only.
	 *  Without it every add would yank the highlight (and the operator's
	 *  next keystroke target) onto the fresh panel. Default false. */
	keepSelection?: boolean;
}

/** The /dsi-terminal request (Web Terminal spec Wave 5, 2026-09-24): aims the
 *  operator terminal as a floor panel — the manager-request grammar: ONE
 *  live terminal, a repeat command FOCUSES the open copy. The panel's
 *  content self-gates on terminal.enabled (its own /api/terminal probe),
 *  so the request carries no flag facts. */
export interface TerminalPanelAddRequest {
	kind: 'terminal';
	/** The Terminal Desk ADR (2026-09-24, D2) — the parser-admitted flag:
	 *  'new-tab' appends a desk tab, 'split-down' adds a row to the selected
	 *  tab. Absent for the bare command. With NO desk on the floor all three
	 *  command shapes mean the same thing (create tab[0]/row[0]) — the floor
	 *  (and, from Wave 2, the desk) owns that equivalence. */
	action?: 'new-tab' | 'split-down';
	afterSessionId?: string;
}

/** The /dsi-prompts request (re-aimed 2026-09-17, The Focus Command ADR
 *  D1/D3): aims the prompts-manager content as a floor panel.
 *  `afterSessionId` anchors placement to the composer's panel; ONE live
 *  manager — the floor dedupes and focuses the open copy (D3, retired
 *  Manager-in-the-Panel D3's two-live-managers rule). */
export interface ManagerPanelAddRequest {
	kind: 'prompt-manager';
	afterSessionId?: string;
}

/** The /dsi-settings and /dsh-settings request (re-pointed by The Settings
 *  Tree ADR, 2026-09-18, D2): opens a SESSION-LESS workspace-explorer
 *  over the settings HOME folder (~/.dsi | ~/.dsh), titled — not the
 *  retired single-file settings-editor. Same placement grammar as the
 *  manager request (afterSessionId anchors placement). Dedupe is the
 *  EXPLORER's own: root (Shared Tree D1) — a repeat command FOCUSES. */
export interface SettingsHomePanelAddRequest {
	kind: 'settings-home';
	/** Which settings home the explorer opens. */
	home: 'dsi' | 'dsh';
	afterSessionId?: string;
}

/** The /loadinjected request (The Loadinjected ADR, 2026-09-07, D2):
 *  opens one logged injected document as a floor panel that BELONGS to its
 *  conversation. The pair (sourceSessionId, displayPath) IS the dedupe key
 *  (D5). `afterSessionId` rides for request-grammar parity (D2) — the
 *  floor's placement authority is sourceSessionId itself (D3: below the
 *  source, the fork-child slot rule), never the anchor. */
export interface InjectedDocAddRequest {
	kind: 'injected-doc';
	/** The conversation whose transcript carries the document. */
	sourceSessionId: string;
	/** The document's shelf name (ADR D7). */
	displayPath: string;
	afterSessionId?: string;
}

/** The /dsi-skills request (The Skill Shelf ADR, 2026-09-20, D1):
 *  aims the SettingsSkillsPanel — ONE live shelf, the floor dedupes and
 *  focuses the open copy (the manager-request grammar). No session: the
 *  shelf reads the DSI-local /api/skills routes itself. */
export interface SkillShelfPanelAddRequest {
	kind: 'skill-shelf';
	afterSessionId?: string;
	/** The /dsi-skills --reload verb: the executor has ALREADY rebuilt the
	 *  snapshot server-side; the floor must make the OPEN shelf re-fetch
	 *  (dedupe-to-focus alone would show the stale list — BUG 2026-10-05). */
	reload?: boolean;
}
/** The /dsi-plugins request (The Plugin Rack ADR, 2026-09-27, D1):
 *  aims the PluginManagerPanel - ONE live rack, the floor dedupes and
 *  focuses the open copy (the manager-request grammar). No session: the
 *  rack reads the DSI-local /api/plugins routes itself. */
export interface PluginRackPanelAddRequest {
	kind: 'plugin-rack';
	afterSessionId?: string;
	/** Same contract as the shelf's reload: the open rack must re-fetch. */
	reload?: boolean;
}

export type AddPanelHandler = (request: PanelAddRequest) => void;
export type ReplaceSelectedHandler = (request: PanelAddRequest) => void;
/**
 * Replace ONE panel by id (2026-08-25, the /new command): same shape as
 * replace-selected but addressed — a panel that spawns a successor session
 * swaps ITSELF, never whatever happens to be selected (selection is a click
 * artifact, not the command's intent).
 */
export type ReplacePanelHandler = (panelId: string, request: PanelAddRequest) => void;
export type SelectPanelHandler = (panelId: string) => void;
export type StartPanelResizeHandler = (event: MouseEvent, index: number) => void;

/**
 * Move direction, named in the INVOKING surface's geometry: the panel
 * header's chevrons are horizontal (`left`/`right`), the sidebar's
 * panel rows vertical (`up`/`down`). The floor owner maps both pairs
 * onto one array operation — `left`/`up` toward the start, `right`/
 * `down` toward the end (the OCI ColumnHeader precedent, extended).
 */
export type PanelMoveDir = 'left' | 'right' | 'up' | 'down';
export type MovePanelHandler = (panelId: string, dir: PanelMoveDir) => void;

// Module-level handler slots — set by the workspace route on mount,
// cleared on destroy. Unregistered = null = invoke returns false.
let addPanelHandler: AddPanelHandler | null = null;
let replaceSelectedHandler: ReplaceSelectedHandler | null = null;
let replacePanelHandler: ReplacePanelHandler | null = null;
let replacePanelBySessionHandler: ReplacePanelBySessionHandler | null = null;
let selectPanelHandler: SelectPanelHandler | null = null;
let startPanelResizeHandler: StartPanelResizeHandler | null = null;
let movePanelHandler: MovePanelHandler | null = null;

/**
 * ADR-0037 D4 — the glass summon: bring a FOLDED glass back to the
 * floor, re-binding to its surviving session (openBrowserPanel with the
 * slot entry's index/width/openedBy/sessionId). The browser twin of
 * addPanelFromSidebar — the sidebar's ghost-row adopt verb (ADR-0037 D4).
 */
export interface GlassSummon {
	index?: number;
	width?: number;
	openedBy?: string;
	sessionId?: string;
}
export type SummonGlassHandler = (glass: GlassSummon, opts: { replace: boolean; keepSelection?: boolean }) => void;
let summonGlassHandler: SummonGlassHandler | null = null;

/** Register the glass-summon action (the folded-glass ghost adopt click). */
export function registerSummonGlass(handler: SummonGlassHandler | null): void {
	summonGlassHandler = handler;
}

/**
 * Ask the floor owner to summon a folded glass.
 * @returns true when a handler ran; false when the floor is not mounted.
 */
export function summonGlassFromRegistry(glass: GlassSummon, opts: { replace: boolean }): boolean {
	if (summonGlassHandler === null) return false;
	summonGlassHandler(glass, opts);
	return true;
}

/**
 * Register the add-panel action (spine plain click, ControlBar paste-add).
 * Pass null to unregister — the route does this in its destroy lifecycle.
 */
export function registerAddPanel(handler: AddPanelHandler | null): void {
	addPanelHandler = handler;
}

/** Register the replace-selected action (spine Shift+click). */
export function registerReplaceSelected(handler: ReplaceSelectedHandler | null): void {
	replaceSelectedHandler = handler;
}

/** Register the replace-one-panel action (the /new command's successor swap). */
export function registerReplacePanel(handler: ReplacePanelHandler | null): void {
	replacePanelHandler = handler;
}

/**
 * Session-addressed replace (Sectioned Row W3 2026-08-29): a run that
 * /new-retargets twice holds its context by SESSION — the stable identity
 * across swaps — because the birth panel id dies at the first swap (fresh
 * id + remount) and an id-addressed replace silently no-ops on the dead
 * slot. The floor owner resolves the live panel showing the session and
 * swaps THAT slot; a miss returns false — the caller reports it, never a
 * silent success.
 */
export type ReplacePanelBySessionHandler = (sessionId: string, request: PanelAddRequest) => boolean;

export function registerReplacePanelBySession(handler: ReplacePanelBySessionHandler | null): void {
	replacePanelBySessionHandler = handler;
}

export function replacePanelBySession(sessionId: string, request: PanelAddRequest): boolean {
	if (replacePanelBySessionHandler === null) return false;
	return replacePanelBySessionHandler(sessionId, request);
}

/** Register the select action (panel-list row click in the sidebar). */
export function registerSelectPanel(handler: SelectPanelHandler | null): void {
	selectPanelHandler = handler;
}

/** Register the resize-start action (gutter mousedown). */
export function registerStartPanelResize(handler: StartPanelResizeHandler | null): void {
	startPanelResizeHandler = handler;
}

/** Register the move action (PanelHeader chevrons + sidebar panel rows). */
export function registerMovePanel(handler: MovePanelHandler | null): void {
	movePanelHandler = handler;
}

/**
 * Ask the floor owner to add a panel for a session (dedupe→select is the
 * owner's policy, commitment 7).
 * @returns true when a handler ran; false when the floor is not mounted
 *          (graceful no-op — the leaf shows no error).
 */
export function addPanelFromSidebar(request: PanelAddRequest): boolean {
	if (addPanelHandler === null) return false;
	addPanelHandler(request);
	return true;
}

/** Replace the selected panel's session (spine plain click). No-op false
 *  when no floor is mounted. */
export function replaceSelectedFromRegistry(request: PanelAddRequest): boolean {
	if (replaceSelectedHandler === null) return false;
	replaceSelectedHandler(request);
	return true;
}

/** Replace ONE panel's session by panel id (the /new successor swap).
 *  No-op false when no floor is mounted or the panel id is unknown. */
export function replacePanelFromRegistry(panelId: string, request: PanelAddRequest): boolean {
	if (replacePanelHandler === null) return false;
	replacePanelHandler(panelId, request);
	return true;
}

/** Select an open panel by id (panel-list row click). No-op false when no
 *  floor is mounted. */
export function selectPanelFromRegistry(panelId: string): boolean {
	if (selectPanelHandler === null) return false;
	selectPanelHandler(panelId);
	return true;
}

/** Begin a gutter drag on panel `index` (mousedown on ResizeGutter).
 *  No-op false when no floor is mounted. */
export function startPanelResize(event: MouseEvent, index: number): boolean {
	if (startPanelResizeHandler === null) return false;
	startPanelResizeHandler(event, index);
	return true;
}

/** Move a panel one slot (`left`/`right` from a panel header, `up`/
 *  `down` from a sidebar row). No-op false when no floor is mounted. */
export function movePanelFromRegistry(panelId: string, dir: PanelMoveDir): boolean {
	if (movePanelHandler === null) return false;
	movePanelHandler(panelId, dir);
	return true;
}

/** Is a floor mounted? (any action handler registered). Leaves use this
 *  to gate floor-only presentation (W4 4.2: the spine's affordance
 *  tooltip) without holding a handler reference. */
export function panelRegistryActive(): boolean {
	return addPanelHandler !== null || replaceSelectedHandler !== null;
}

/** Test-only: clear every slot (isolation between unit-test files). */
export function resetPanelRegistryForTests(): void {
	addPanelHandler = null;
	replaceSelectedHandler = null;
	replacePanelHandler = null;
	replacePanelBySessionHandler = null;
	selectPanelHandler = null;
	startPanelResizeHandler = null;
	movePanelHandler = null;
}

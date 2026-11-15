/**
 * Panel preferences — the persisted workspace state of the panel floor
 * (ADR-0006, 2026-08-24): which panels are open, which is selected, the
 * preset width applied to uniform panels, and the floor zoom. One JSON
 * blob under localStorage['dsi-panels'].
 *
 * Defense follows the sidebar-prefs pattern: SSR-safe (no localStorage →
 * defaults), junk payloads fall back without throwing, out-of-range values
 * are clamped on load, and writes are best-effort. This module is the ONLY
 * clamp site for panel width and zoom (commitment 3) — drag math, sliders,
 * and restore all route through clampPanelWidth / clampPanelZoom.
 *
 * Stored-entry tolerance: unknown keys on a panel entry survive, missing
 * known keys are defaulted, entries failing the hard shape check are
 * dropped, and a non-array `panels` value means the whole blob is junk.
 */
import type { DsiPanelEntry, TerminalDeskMirror } from '$lib/types';
import { appConfig } from '$lib/services/config/app-config.svelte';
import type { ReloadFeedback } from './skill-shelf-reload-machine';
import { createPrefsStore, storageKey } from '@deepseek-insight/container-base';

/** localStorage base key — one JSON blob `{ panels, selectedPanelId, panelWidth, zoom }`.
 *  A workspace profile (`?profile=…` on the URL) suffixes EVERY dsi-* key
 *  (see packages/container-base/src/storage/namespace.ts): the default desk lives under `dsi-panels`,
 *  profile `widi` under `dsi-panels_widi`. */
export const PANEL_PREFS_KEY = 'dsi-panels';

/**
 * The storage key for a workspace profile.
 * @param profile sanitized profile segment, or null/undefined for the
 *                default desk (`dsi-panels`).
 */
export function panelPrefsKey(profile?: string | null): string {
	return storageKey(PANEL_PREFS_KEY, profile);
}

/** Uniform-panel default width (px) — also the fallback for missing widths.
 *  Config-tunable (2026-08-25): ~/.dsi/settings.yaml `panel.defaultWidth`
 *  overrides this default at runtime — the constants below are the FALLBACK
 *  defaults (and what unit tests see with no config loaded). */
export const PANEL_DEFAULT_WIDTH = 730;

/** Panel width clamp bounds (px) — the single bound site (commitment 3).
 *  Config-tunable: `panel.minWidth` / `panel.maxWidth` override at runtime. */
export const PANEL_MIN_WIDTH = 480;
export const PANEL_MAX_WIDTH = 860;

/** Workspace-file panels may extend wider (2026-09-12 operator request):
 *  the file/editor surface reads better wide, and a file panel never
 *  steals from a conversation the way a second chat would. 2026-09-13
 *  (updated same day): the band is default 860, floor 850, ceiling
 *  1436 — the slider and gutters clamp inside it. */
export const PANEL_WORKSPACE_FILE_WIDTH = 850;
export const PANEL_WORKSPACE_FILE_MIN_WIDTH = 520;
export const PANEL_WORKSPACE_FILE_MAX_WIDTH = 1436;

/** The workspace explorer (2026-09-13 operator request): a FIXED narrow
 *  lane — 280 default AND floor (the tree reads fine narrow; a file
 *  panel next to it is the wide one). Ceiling stays PANEL_MAX_WIDTH. */
export const PANEL_WORKSPACE_EXPLORER_WIDTH = 280;

/** Floor zoom bounds — 25%..125%, the single bound site (commitment 3).
 *  Config-tunable: `panel.minZoom` / `panel.maxZoom` override at runtime. */
export const PANEL_DEFAULT_ZOOM = 1;
export const PANEL_MIN_ZOOM = 0.25;
export const PANEL_MAX_ZOOM = 1.25;

// ── The Explorer Layout (ADR 2026-09-17 D4) — the explorer panel's
//    in-panel split. A DESK fact (which region is how wide), so it lives
//    beside the floor's other desk state in the dsi-panels blob — NOT a
//    settings.yaml knob (fact 8's split). One bound site: load-side
//    sanitizing AND the panel's own drag math both route through
//    clampTreePct; the default 30 matches the ADR's 30/70 reading split.

/** Explorer tree share of the panel width, in percent. */
export const TREE_PCT_DEFAULT = 30;
export const TREE_PCT_MIN = 15;
export const TREE_PCT_MAX = 70;

/** The terminal base font (ADR-0041 Am.4): the operator's glyph-size
 *  preference in px — zoom multiplies ON TOP of it. A DESK fact, so it
 *  lives in the dsi-panels floor blob beside zoom (not settings.yaml).
 *  One bound site: load-side sanitize AND the slider both route through
 *  clampTermFontSize; the default 12 retires TerminalPanel's literal. */
export const TERM_FONT_DEFAULT = 12;
export const TERM_FONT_MIN = 8;
export const TERM_FONT_MAX = 20;

/** The single terminal-font bound site — load-side sanitizing and the
 *  TermFontSlider both route through here; junk (non-finite) falls back
 *  to TERM_FONT_DEFAULT. Mirrors clampTreePct's discipline. */
export function clampTermFontSize(px: unknown): number {
	if (typeof px !== 'number' || !Number.isFinite(px)) return TERM_FONT_DEFAULT;
	return Math.max(TERM_FONT_MIN, Math.min(TERM_FONT_MAX, Math.round(px)));
}

/** The single treePct bound site — sanitize a stored or dragged value
 *  into [TREE_PCT_MIN, TREE_PCT_MAX]; junk (non-finite) falls back to
 *  TREE_PCT_DEFAULT. Mirrors clampPanelZoom's discipline. */
export function clampTreePct(pct: unknown): number {
	if (typeof pct !== 'number' || !Number.isFinite(pct)) return TREE_PCT_DEFAULT;
	return Math.max(TREE_PCT_MIN, Math.min(TREE_PCT_MAX, Math.round(pct)));
}

/** The workspace state shape persisted by the floor owner route. */
export interface PanelPrefs {
	panels: DsiPanelEntry[];
	/** Selected panel's `id`; null when no panels are open. */
	selectedPanelId: string | null;
	/** Width preset applied to uniform panels (honest-slider source). */
	panelWidth: number;
	/** Floor zoom multiplier, within [PANEL_MIN_ZOOM, PANEL_MAX_ZOOM]. */
	zoom: number;
	/** The Explorer Layout (ADR D4): the explorer panel's tree-region
	 *  share in percent, within [TREE_PCT_MIN, TREE_PCT_MAX]. Optional —
	 *  absent in legacy blobs, defaulted by clampTreePct on read. */
	treePct?: number;
	/** Explorer hide/show (2026-10-31): the tree lane's collapsed state.
	 *  Optional — absent in legacy blobs, defaulted false on read. */
	explorerHidden?: boolean;
	/** Terminal base font in px (ADR-0041 Am.4). Optional — absent in
	 *  legacy blobs, defaulted TERM_FONT_DEFAULT by clampTermFontSize. */
	termFontSize?: number;
}

/**
 * The single panel-width bound site — load-side sanitizing, gutter drags,
 * and the width slider all route through here. Bounds read the config
 * store (layout load has landed them before any mount; defaults before).
 */
export function clampPanelWidth(width: number, kind?: DsiPanelEntry['kind']): number {
	const { minWidth, maxWidth } = appConfig().panel;
	// The File Eye lanes (2026-09-13): each workspace kind clamps in its
	// OWN band — the explorer is a fixed narrow lane (280 floor), the file
	// panel a fixed wide lane (1024 floor, 1280 ceiling) — regardless of
	// the conversation bounds the config tunes.
	if (kind === 'workspace-explorer') {
		// The Explorer Layout (ADR 2026-09-17 D3/D4), made UNCONDITIONAL by
		// The Settings Tree ADR 2026-09-18 D1 (the layout knob is deleted):
		// the panel HOSTS the reading surface — it lives in the WIDE file
		// band, not the narrow tree lane.
		return Math.max(PANEL_WORKSPACE_FILE_MIN_WIDTH, Math.min(PANEL_WORKSPACE_FILE_MAX_WIDTH, width));
	}
	if (kind === 'workspace-file') {
		return Math.max(PANEL_WORKSPACE_FILE_MIN_WIDTH, Math.min(PANEL_WORKSPACE_FILE_MAX_WIDTH, width));
	}
	// The glass band (operator request 2026-10-26): browser.defaultWidth /
	// browser.maxWidth from settings.yaml — the page is the mirror's native
	// scale, so the glass gets its OWN ceiling, not the conversation 860.
	if (kind === 'browser') {
		const { maxWidth: browserMax } = appConfig().browserWidths;
		return Math.max(minWidth, Math.min(browserMax, width));
	}
	return Math.max(minWidth, Math.min(maxWidth, width));
}

/** The single zoom bound site — load-side sanitizing and the zoom slider. */
export function clampPanelZoom(zoom: number): number {
	const { minZoom, maxZoom } = appConfig().panel;
	return Math.max(minZoom, Math.min(maxZoom, zoom));
}

/** Config-driven default width (clamped through the single bound site). */
function defaultPanelWidth(): number {
	return clampPanelWidth(appConfig().panel.defaultWidth);
}
/** The glass panel's config-driven default (browser.defaultWidth, clamped
 *  through the browser band) — chip-spawned glasses mint at this width. */
export function browserPanelWidth(): number {
	return clampPanelWidth(appConfig().browserWidths.defaultWidth, 'browser');
}

/**
 * The skill shelf's born width (The Shelf Chrome ADR, D5): a name list,
 * not a five-column table — the shelf pins 480 (DEFAULT_PANEL_MIN_WIDTH)
 * instead of the 730 conversation default, clamped through the single
 * bound site.
 */
export function shelfPanelWidth(): number {
	return clampPanelWidth(480);
}
/**
 * Clamp a stored explorer `expanded` list to sane paths (Workspace
 * Explorer restore): non-string members drop and a repeated path keeps
 * its FIRST occurrence — the tree treats `expanded` as a set of
 * root-relative directories, and a duplicate would double-render a row.
 */
function clampExpanded(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const member of value) {
		if (typeof member !== 'string' || seen.has(member)) continue;
		seen.add(member);
		out.push(member);
	}
	return out;
}

/** The terminal desk's structure clamp (Terminal Desk ADR D3, Wave 3):
 *  sanitize a stored desk mirror into { tabs, selectedTab } or undefined.
 *  Junk drops FIELD-WISE — non-string sessionIds drop, empty/junk tabs
 *  drop, selectedTab clamps into range — so a stale blob degrades to
 *  "fewer rows remembered", never a phantom row. All tabs dropped (or
 *  junk at the top) ⇒ undefined: the desk falls back to one fresh row. */
export function clampDeskMirror(value: unknown): TerminalDeskMirror | undefined {
	if (value === null || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (!Array.isArray(raw.tabs)) return undefined;
	const tabs: Array<{ sessionIds: string[] }> = [];
	for (const tab of raw.tabs) {
		if (tab === null || typeof tab !== 'object') continue;
		const ids = (tab as Record<string, unknown>).sessionIds;
		if (!Array.isArray(ids)) continue;
		const sessionIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
		if (sessionIds.length === 0) continue;
		tabs.push({ sessionIds });
	}
	// Job Follower Tab amendment: remembered -J tabs survive reload; a
	// shells-only-empty mirror with remembered jobs is still usable.
	const jobs: Array<{ owner: string; jobId: string }> = [];
	if (Array.isArray(raw.jobs)) {
		for (const j of raw.jobs) {
			if (j === null || typeof j !== 'object') continue;
			const owner = (j as Record<string, unknown>).owner;
			const jobId = (j as Record<string, unknown>).jobId;
			if (typeof owner !== 'string' || typeof jobId !== 'string') continue;
			if (owner.length === 0 || jobId.length === 0) continue;
			jobs.push({ owner, jobId });
		}
	}
	if (tabs.length === 0 && jobs.length === 0) return undefined;
	// a job-only mirror rebuilds with ONE fallback self-open shell in front,
	// so the stored selected index may point at tabs.length (first job tab)
	const maxIndex = tabs.length + jobs.length;
	const selected =
		typeof raw.selectedTab === 'number' && Number.isFinite(raw.selectedTab)
			? Math.max(0, Math.min(maxIndex, Math.round(raw.selectedTab)))
			: 0;
	return { tabs, selectedTab: selected, ...(jobs.length > 0 ? { jobs } : {}) };
}

/** Persisted defaults when nothing (usable) is stored. */
export function defaultPanelPrefs(): PanelPrefs {
	return {
		panels: [],
		selectedPanelId: null,
		panelWidth: defaultPanelWidth(),
		zoom: PANEL_DEFAULT_ZOOM,
		treePct: TREE_PCT_DEFAULT,
		explorerHidden: false,
		termFontSize: TERM_FONT_DEFAULT
	};
}

// ── The Panel Contract Registry (ADR-0065, Release 4 Wave 3) ───────────
// TEN declarations — one per kind — replace the per-kind if/else revive
// chain. Each declaration carries the kind's whole contract: the shape
// gate (requiredKeys), the field reconstruction (revive), the lane
// default, a LAZY band (D5 — appConfig is read at clamp time, never at
// declaration), and the two flags (persisted; resizableByPreset — only
// the conversation lane sweeps). This array is DATA: spawn factories
// stay in factories.ts (D4), and the browser kind declares
// persisted:false instead of living outside the law (D6/ADR-0030 A4).

/**
 * One DSI panel kind's whole persisted contract. Semantics mirror the
 * base package's PanelKindDeclaration (lazy band, opt-out flags); the
 * revive signature carries the sanitized width because the width ladder
 * (junk → kind lane default → band clamp) runs BEFORE reconstruction.
 */
export interface DsiPanelKindDeclaration {
	kind: DsiPanelEntry['kind'];
	/** Shape gate: does this raw entry carry the keys the kind requires? */
	requiredKeys: (entry: Record<string, unknown>) => boolean;
	/** Rebuild the typed entry from the raw shape at a sanitized width. */
	revive: (entry: Record<string, unknown>, width: number) => DsiPanelEntry;
	/** The kind lane's default width (static constant or config-driven). */
	laneDefaultWidth: number | (() => number);
	/** The LAZY band clamp — evaluates appConfig at call time (D5). */
	band: (width: number) => number;
	/** false = the kind never survives the reload blob (D6). */
	persisted: boolean;
	/** true = the kind joins the honest-slider resizeAll sweep. */
	resizableByPreset: boolean;
	/**
	 * The Width Preset Chord's per-kind preset pick (ADR-0006a): the
	 * conversation lane follows the agent px, the glass the browser px.
	 * Undefined = the kind never follows a chord preset.
	 */
	presetWidth?: (agentPx?: number, glassPx?: number) => number | undefined;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The ten declarations, in floor-truth order. */
export const PANEL_KIND_DECLARATIONS: readonly DsiPanelKindDeclaration[] = [
	{
		kind: 'conversation',
		// Legacy shape (ADR D6): sessionId required; agentPreset when present
		// must be string|null.
		requiredKeys: (entry) => {
			if (!nonEmpty(entry.sessionId)) return false;
			return entry.agentPreset === undefined || typeof entry.agentPreset === 'string' || entry.agentPreset === null;
		},
		// D7: unknown extra keys survive ONLY here — the spread keeps them.
		revive: (entry, width) =>
			({
				...(entry as object),
				id: entry.id as string,
				kind: 'conversation',
				sessionId: entry.sessionId as string,
				agentPreset: (entry.agentPreset ?? null) as string | null,
				width
			}) as DsiPanelEntry,
		laneDefaultWidth: () => defaultPanelWidth(),
		band: (width) => clampPanelWidth(width, 'conversation'),
		persisted: true,
		resizableByPreset: true,
		presetWidth: (agentPx) => agentPx
	},
	{
		kind: 'prompt-manager',
		requiredKeys: () => true,
		revive: (entry, width) => ({ id: entry.id as string, kind: 'prompt-manager', width }) as DsiPanelEntry,
		laneDefaultWidth: () => defaultPanelWidth(),
		band: (width) => clampPanelWidth(width, 'prompt-manager'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'settings-editor',
		requiredKeys: (entry) => entry.target === 'dsi' || entry.target === 'dsh',
		revive: (entry, width) =>
			({ id: entry.id as string, kind: 'settings-editor', target: entry.target as 'dsi' | 'dsh', width }) as DsiPanelEntry,
		laneDefaultWidth: () => defaultPanelWidth(),
		band: (width) => clampPanelWidth(width, 'settings-editor'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'injected-doc',
		// Loadinjected ADR D2: both dedupe-key fields required and non-empty.
		requiredKeys: (entry) => nonEmpty(entry.sourceSessionId) && nonEmpty(entry.displayPath),
		revive: (entry, width) =>
			({
				id: entry.id as string,
				kind: 'injected-doc',
				sourceSessionId: entry.sourceSessionId as string,
				displayPath: entry.displayPath as string,
				width
			}) as DsiPanelEntry,
		laneDefaultWidth: () => defaultPanelWidth(),
		band: (width) => clampPanelWidth(width, 'injected-doc'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'skill-shelf',
		requiredKeys: () => true,
		revive: (entry, width) => {
			// Reload blob sanitize (the Reload Rememberer ADR D1/D3, shape
			// pinned 2026-09-23): only a well-formed loading (numeric
			// startedAt) or unexpired done (numeric startedAt + doneAt)
			// survives; junk, the legacy state-keyed blob, and expired
			// dones all clear to idle.
			let reload: ReloadFeedback | null = null;
			const r = entry.reload as Partial<ReloadFeedback> | undefined;
			if (r && r.phase === 'loading' && typeof r.startedAt === 'number') {
				reload = { phase: 'loading', startedAt: r.startedAt };
			} else if (
				r &&
				r.phase === 'done' &&
				typeof r.startedAt === 'number' &&
				typeof r.doneAt === 'number' &&
				r.doneAt > Date.now()
			) {
				reload = { phase: 'done', startedAt: r.startedAt, doneAt: r.doneAt };
			}
			return {
				id: entry.id as string,
				kind: 'skill-shelf',
				// Persisted chrome (the explorer-tab pattern): junk
				// sanitizes to the defaults the panel picks itself.
				tab: entry.tab === 'uninstall' ? 'uninstall' : 'install',
				collapsed: clampExpanded(entry.collapsed),
				searchQ: typeof entry.searchQ === 'string' ? entry.searchQ : '',
				reload,
				width
			} as DsiPanelEntry;
		},
		// The Shelf Chrome ADR: the shelf's born 480 lane.
		laneDefaultWidth: () => shelfPanelWidth(),
		band: (width) => clampPanelWidth(width, 'skill-shelf'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'plugin-rack',
		requiredKeys: () => true,
		revive: (entry, width) => {
			// The Plugin Rack ADR (2026-09-27): the tab survives the reload
			// blob (the explorer-tab pattern); junk sanitizes to 'install'.
			return {
				id: entry.id as string,
				kind: 'plugin-rack',
				tab: entry.tab === 'uninstall' ? 'uninstall' : 'install',
				width
			} as DsiPanelEntry;
		},
		// The Plugin Rack ADR: same narrow lane as the shelf.
		laneDefaultWidth: () => shelfPanelWidth(),
		band: (width) => clampPanelWidth(width, 'plugin-rack'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'workspace-explorer',
		// Workspace Explorer (2026-09-10 ADR D2): the root is required; the
		// Settings Tree ADR (2026-09-18 D3): a session-less (settings home)
		// explorer carries sessionId null — legal — but MUST carry its home
		// plane, or it could fetch nothing.
		requiredKeys: (entry) => {
			if (typeof entry.root !== 'string') return false;
			if (entry.sessionId !== null && !nonEmpty(entry.sessionId)) return false;
			if (entry.sessionId === null && entry.home !== 'dsi' && entry.home !== 'dsh') return false;
			return true;
		},
		revive: (entry, width) => {
			const home = entry.home === 'dsi' || entry.home === 'dsh' ? (entry.home as 'dsi' | 'dsh') : undefined;
			return {
				id: entry.id as string,
				kind: 'workspace-explorer',
				// Settings Tree D3: null provenance for a home explorer; junk
				// sessionId on a session explorer drops the entry via requiredKeys.
				sessionId: (entry.sessionId ?? null) as string | null,
				root: entry.root as string,
				// Settings Tree D3: the display title; junk/absent drops it.
				...(typeof entry.title === 'string' && entry.title.length > 0
					? { title: entry.title as string }
					: {}),
				...(home !== undefined ? { home } : {}),
				expanded: clampExpanded(entry.expanded),
				// Git Eye (2026-09-12): the active tab persists across reloads;
				// anything but the two literals sanitizes to 'explorer'.
				tab: entry.tab === 'changes' ? 'changes' : 'explorer',
				// Git Eye (2026-09-13): the Changes tab's collapsed repo set
				// persists too — same clamp rules as expanded (string members,
				// first occurrence wins); absent/empty ⇒ all repos expanded.
				collapsedRepos: clampExpanded(entry.collapsedRepos),
				// Explorer Layout (amendment 2026-09-16): the open file tabs
				// persist (same clamp rules as expanded) with the active tab
				// beside them; junk/absent ⇒ no tabs, no active file.
				openTabs: clampExpanded(entry.openTabs),
				activeFile: typeof entry.activeFile === 'string' ? entry.activeFile : null,
				width
			} as DsiPanelEntry;
		},
		// Settings Tree D1: the wide lane is the only lane.
		laneDefaultWidth: PANEL_WORKSPACE_FILE_WIDTH,
		band: (width) => clampPanelWidth(width, 'workspace-explorer'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'workspace-file',
		// 2026-09-10 ADR D2: BOTH halves of the (sessionId, path) dedupe key
		// are required — half a key is a hard-junk entry.
		requiredKeys: (entry) => nonEmpty(entry.sessionId) && nonEmpty(entry.path),
		revive: (entry, width) =>
			({
				id: entry.id as string,
				kind: 'workspace-file',
				sessionId: entry.sessionId as string,
				path: entry.path as string,
				// The explorer edge (2026-09-10 lineage fix): present on
				// entries written after it existed; a legacy entry (or a
				// non-string value) defaults to null and re-mints on the
				// file's next tree click.
				explorerPanelId:
					typeof entry.explorerPanelId === 'string' && entry.explorerPanelId.length > 0
						? entry.explorerPanelId
						: null,
				// The File Eye (2026-09-13): the diff/edit view persists per
				// panel; anything but the two literals sanitizes to 'edit'.
				view: entry.view === 'diff' ? 'diff' : 'edit',
				width
			}) as DsiPanelEntry,
		laneDefaultWidth: PANEL_WORKSPACE_FILE_WIDTH,
		band: (width) => clampPanelWidth(width, 'workspace-file'),
		persisted: true,
		resizableByPreset: false
	},
	{
		kind: 'terminal',
		requiredKeys: () => true,
		revive: (entry, width) => {
			// The Surviving Shell (ADR 2026-09-24 D3): the terminal slot
			// survives the reload blob — the mount ladder re-attaches the
			// live PTY. Sanitizing it away would resurrect a blank desk
			// while the shell kept running.
			// The Terminal Desk (ADR D3, Wave 3): the desk's tab/row mirror
			// rides along (clamped field-wise); tokens NEVER persist — a
			// lease is re-minted by re-attach on the rebuild ladder.
			const desk = clampDeskMirror(entry.desk);
			return {
				id: entry.id as string,
				kind: 'terminal',
				...(desk ? { desk } : {}),
				width
			} as DsiPanelEntry;
		},
		laneDefaultWidth: () => defaultPanelWidth(),
		band: (width) => clampPanelWidth(width, 'terminal'),
		persisted: true,
		resizableByPreset: false
	},
	{
		// ADR-0030 A4 / ADR-0065 D6: the glass is declared, then excluded
		// from persistence by declaration — NOT by an if/else outside the
		// law. A hand-crafted browser entry in the blob drops on revive.
		kind: 'browser',
		requiredKeys: () => true,
		revive: () => null as unknown as DsiPanelEntry,
		laneDefaultWidth: () => browserPanelWidth(),
		band: (width) => clampPanelWidth(width, 'browser'),
		persisted: false,
		// The chord's glass leg still sweeps the LIVE floor (ADR-0006a).
		resizableByPreset: false,
		presetWidth: (_agentPx, glassPx) => glassPx
	}
];

const DECL_BY_KIND: Map<string, DsiPanelKindDeclaration> = new Map(
	PANEL_KIND_DECLARATIONS.map((d) => [d.kind, d])
);

/**
 * Hard shape check for a stored panel entry (the parse boundary) — now a
 * thin read of the registry: shared gates (id, width) + the kind
 * declaration's own requiredKeys. KIND (2026-09-06, ADR D6): absent kind
 * is the legacy conversation shape; any kind outside the registry is
 * hard junk (entry drops).
 */
export function isPanelEntry(value: unknown): value is DsiPanelEntry {
	if (value === null || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	if (typeof entry.id !== 'string' || entry.id.length === 0) return false;
	if (entry.width !== undefined && (typeof entry.width !== 'number' || !Number.isFinite(entry.width))) {
		return false;
	}
	const kind = (entry.kind === undefined ? 'conversation' : entry.kind) as string;
	const decl = DECL_BY_KIND.get(kind);
	return decl !== undefined && decl.persisted && decl.requiredKeys(entry);
}

/** Drop hard-junk entries; default missing keys; clamp widths. Unknown
 *  keys on surviving entries pass through untouched (conversation only —
 *  every other kind reconstructs field-wise and drops extras).
 *
 *  Duplicate ids (2026-08-24 crash fix): a corrupted blob carrying the
 *  same panel-N twice would reach the keyed each in SidebarOpenPanels
 *  and crash Svelte (each_key_duplicate) at render — the each's key is
 *  the panel id. Duplicates drop to the FIRST occurrence (order is the
 *  floor's left-to-right truth); a selectedPanelId left dangling by the
 *  dedupe re-sanitizes to the first panel in loadPanelPrefs. */
function sanitizePanels(raw: unknown): DsiPanelEntry[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: DsiPanelEntry[] = [];
	for (const value of raw) {
		if (!isPanelEntry(value)) continue;
		const entry = value as unknown as Record<string, unknown>;
		const decl = DECL_BY_KIND.get(entry.kind === undefined ? 'conversation' : (entry.kind as string));
		if (!decl || !decl.persisted) continue;
		// The File Eye lanes: a missing/invalid width defaults to the
		// KIND's lane default, not the conversation default (the ladder
		// each declaration carries; junk widths already dropped by
		// isPanelEntry's shared width gate).
		const lane =
			typeof decl.laneDefaultWidth === 'function' ? decl.laneDefaultWidth() : decl.laneDefaultWidth;
		const width = decl.band(
			typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : lane
		);
		const panel = decl.revive(entry, width);
		if (panel === null) continue;
		if (seen.has(panel.id)) continue;
		seen.add(panel.id);
		out.push(panel);
	}
	return out;
}

/**
 * The honest-slider resize-all sweep, registry-driven: only kinds flagged
 * resizableByPreset join, each clamped through its OWN band. Today only
 * the conversation lane is flagged (the workspace lanes are FIXED,
 * 2026-09-13); adding a flag is a one-line declaration change.
 */
export function resizeAllByRegistry(panels: readonly DsiPanelEntry[], width: number): DsiPanelEntry[] {
	return panels.map((panel) => {
		const decl = DECL_BY_KIND.get(panel.kind);
		return decl !== undefined && decl.resizableByPreset ? { ...panel, width: decl.band(width) } : panel;
	});
}

/**
 * The Width Preset Chord sweep (ADR-0006a), registry-driven: each kind's
 * presetWidth picks its chord leg (conversation → agent px, browser →
 * glass px); the chosen px clamps through the kind's own band at sweep
 * time. drag.svelte.ts names no kinds — the declarations own the policy.
 */
export function applyPresetWidthsByRegistry(
	panels: readonly DsiPanelEntry[],
	agentPx: number | undefined,
	glassPx: number | undefined
): DsiPanelEntry[] {
	return panels.map((panel) => {
		const decl = DECL_BY_KIND.get(panel.kind);
		const preset = decl?.presetWidth?.(agentPx, glassPx);
		return preset === undefined ? panel : { ...panel, width: decl!.band(preset) };
	});
}


/**
 * Revive a parsed blob into PanelPrefs — the primitive's junk boundary.
 * Returns null (⇒ defaults) for a non-object blob or a non-array `panels`
 * (whole-blob junk, spec 1.2-T); field assembly clamps through the single
 * bound sites exactly as before the W2 migration.
 */
function revivePanelPrefs(parsed: unknown): PanelPrefs | null {
	if (parsed === null || typeof parsed !== 'object') return null;
	const raw = parsed as Partial<PanelPrefs>;
	// Non-array panels = junk blob → whole-blob defaults (spec 1.2-T).
	if (!Array.isArray(raw.panels)) return null;
	const panels = sanitizePanels(raw.panels);
	const panelWidth =
		typeof raw.panelWidth === 'number' && Number.isFinite(raw.panelWidth)
			? clampPanelWidth(raw.panelWidth)
			: defaultPanelWidth();
	const zoom =
		typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)
			? clampPanelZoom(raw.zoom)
			: PANEL_DEFAULT_ZOOM;
	// The Explorer Layout (ADR D4): clamp through the single bound site;
	// absent in legacy blobs — only override the default when the stored
	// value is a usable number.
	const treePct =
		typeof raw.treePct === 'number' && Number.isFinite(raw.treePct)
			? clampTreePct(raw.treePct)
			: TREE_PCT_DEFAULT;
	// Explorer hide/show (2026-10-31): strict boolean — junk is false.
	const explorerHidden = raw.explorerHidden === true;
	// Terminal base font (ADR-0041 Am.4): clamp through the single
	// bound site; absent in legacy blobs — only override the default
	// when the stored value is a usable number.
	const termFontSize =
		typeof raw.termFontSize === 'number' && Number.isFinite(raw.termFontSize)
			? clampTermFontSize(raw.termFontSize)
			: TERM_FONT_DEFAULT;
	const selected =
		typeof raw.selectedPanelId === 'string' &&
		panels.some((panel) => panel.id === raw.selectedPanelId)
			? raw.selectedPanelId
			: (panels[0]?.id ?? null);
	return { panels, selectedPanelId: selected, panelWidth, zoom, treePct, explorerHidden, termFontSize };
}

/** The W2 storage primitive (ADR-0062 D4): SSR guard → revive junk-fallback
 *  → best-effort write live in the package; this module keeps only the DSI
 *  vocabulary (entry sanitize, config-driven clamps) and the blob contract. */
const prefsStore = createPrefsStore<PanelPrefs>({
	key: PANEL_PREFS_KEY,
	defaults: defaultPanelPrefs,
	revive: revivePanelPrefs
	// no `clamp` pass: revivePanelPrefs clamps field-wise through the single
	// bound sites, preserving the pre-primitive load behavior byte-for-byte.
	// no `envelope`: the dsi-panels blob shape NEVER changes (D4).
});

/**
 * Read the workspace state from localStorage.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored state when parseable (sanitized), defaults when absent,
 *          junk, or SSR. A `selectedPanelId` pointing at a missing panel
 *          sanitizes to the first panel's id (null when no panels remain).
 */
export function loadPanelPrefs(profile?: string | null): PanelPrefs {
	return prefsStore.load(profile);
}

/**
 * Write the workspace state to localStorage (best-effort).
 * @param prefs the full state; always stored together.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function savePanelPrefs(prefs: PanelPrefs, profile?: string | null): void {
	prefsStore.save(prefs, profile);
}

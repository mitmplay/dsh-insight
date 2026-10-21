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
import { dsiKey } from './storage-profile';

/** localStorage base key — one JSON blob `{ panels, selectedPanelId, panelWidth, zoom }`.
 *  A workspace profile (`?profile=…` on the URL) suffixes EVERY dsi-* key
 *  (see storage-profile.ts): the default desk lives under `dsi-panels`,
 *  profile `widi` under `dsi-panels_widi`. */
export const PANEL_PREFS_KEY = 'dsi-panels';

/**
 * The storage key for a workspace profile.
 * @param profile sanitized profile segment, or null/undefined for the
 *                default desk (`dsi-panels`).
 */
export function panelPrefsKey(profile?: string | null): string {
	return dsiKey(PANEL_PREFS_KEY, profile);
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
		treePct: TREE_PCT_DEFAULT
	};
}

/**
 * Hard shape check for a stored panel entry (the parse boundary).
 * KIND (2026-09-06, ADR D6): absent or 'conversation' is the legacy shape —
 * `sessionId` required; 'prompt-manager' carries no session fields;
 * 'injected-doc' (Loadinjected ADR D2) requires non-empty `sourceSessionId`
 * + `displayPath` — the dedupe key. Any other kind value is hard junk
 * (entry drops). `agentPreset` and `width`
 * may be absent (defaulted later); `agentPreset` when present must be
 * string|null, `width` when present must be a finite number. Unknown
 * extra keys are fine — they survive sanitizing.
 */
export function isPanelEntry(value: unknown): value is DsiPanelEntry {
	if (value === null || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	if (typeof entry.id !== 'string' || entry.id.length === 0) return false;
	if (
		entry.kind !== undefined &&
		entry.kind !== 'conversation' &&
		entry.kind !== 'prompt-manager' &&
		entry.kind !== 'settings-editor' &&
		entry.kind !== 'injected-doc' &&
		entry.kind !== 'skill-shelf' &&
		entry.kind !== 'plugin-rack' &&
		entry.kind !== 'workspace-explorer' &&
		entry.kind !== 'workspace-file' &&
		entry.kind !== 'terminal'
	) {
		return false;
	}
	if (entry.kind === 'settings-editor' && entry.target !== 'dsi' && entry.target !== 'dsh') {
		return false;
	}
	// Workspace Explorer (2026-09-10 ADR D2): the explorer needs its root
	// (the copy control's value); the file panel needs BOTH halves of the
	// (sessionId, path) dedupe key — half a key is a hard-junk entry.
	if (entry.kind === 'workspace-explorer') {
		// The Settings Tree ADR 2026-09-18 D3: a session-less (settings home)
		// explorer carries sessionId null — legal — but MUST carry its home
		// plane, or it could fetch nothing.
		if (entry.sessionId !== null && (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0)) {
			return false;
		}
		if (entry.sessionId === null && entry.home !== 'dsi' && entry.home !== 'dsh') {
			return false;
		}
	}
	if (entry.kind === 'workspace-file') {
		if (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) {
			return false;
		}
	}
	if (entry.kind === 'workspace-explorer' && typeof entry.root !== 'string') {
		return false;
	}
	if (entry.kind === 'workspace-file') {
		if (typeof entry.path !== 'string' || entry.path.length === 0) {
			return false;
		}
	}
	if (entry.kind === 'injected-doc') {
		// Loadinjected ADR D2: both dedupe-key fields are required and
		// non-empty — half a key is a hard-junk entry.
		if (typeof entry.sourceSessionId !== 'string' || entry.sourceSessionId.length === 0) {
			return false;
		}
		if (typeof entry.displayPath !== 'string' || entry.displayPath.length === 0) {
			return false;
		}
	}
	if (
		entry.kind !== 'prompt-manager' &&
		entry.kind !== 'settings-editor' &&
		entry.kind !== 'skill-shelf' &&
		entry.kind !== 'plugin-rack' &&
		entry.kind !== 'injected-doc' &&
		entry.kind !== 'workspace-explorer' &&
		entry.kind !== 'workspace-file' &&
		// The Surviving Shell (ADR 2026-09-24): a terminal slot has no
		// session — like the managers, it must not need one to survive.
		entry.kind !== 'terminal'
	) {
		if (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) return false;
		if (
			entry.agentPreset !== undefined &&
			typeof entry.agentPreset !== 'string' &&
			entry.agentPreset !== null
		) {
			return false;
		}
	}
	if (entry.width !== undefined && (typeof entry.width !== 'number' || !Number.isFinite(entry.width))) {
		return false;
	}
	return true;
}

/** Drop hard-junk entries; default missing keys; clamp widths. Unknown
 *  keys on surviving entries pass through untouched.
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
	return raw
		.filter((entry): entry is Record<string, unknown> => isPanelEntry(entry))
		.map((entry) => {
			// The File Eye lanes: a missing/invalid width defaults to the
			// KIND's lane default, not the conversation default. The
			// Explorer Layout (2026-09-17): the explorer's lane widens when
			// it hosts the reading surface.
			const kindDefault =
				entry.kind === 'skill-shelf'
					? shelfPanelWidth() // The Shelf Chrome ADR: the shelf's born 480 lane
				: entry.kind === 'plugin-rack'
					? shelfPanelWidth() // The Plugin Rack ADR: same narrow lane as the shelf
					: entry.kind === 'workspace-explorer'
					? PANEL_WORKSPACE_FILE_WIDTH // Settings Tree D1: the wide lane is the only lane
					: entry.kind === 'workspace-file'
						? PANEL_WORKSPACE_FILE_WIDTH
						: defaultPanelWidth();
			const width = clampPanelWidth(
				typeof entry.width === 'number' && Number.isFinite(entry.width)
					? entry.width
					: kindDefault,
				entry.kind as DsiPanelEntry['kind'] | undefined
			);
			// KIND (ADR D6): a manager entry sanitizes to the manager branch —
			// session fields never cross kinds; everything else is conversation
			// (the legacy blob default).
			if (entry.kind === 'prompt-manager') {
				return { id: entry.id as string, kind: 'prompt-manager', width } as DsiPanelEntry;
			}
			if (entry.kind === 'terminal') {
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
			}
			if (entry.kind === 'settings-editor') {
				return {
					id: entry.id as string,
					kind: 'settings-editor',
					target: entry.target as 'dsi' | 'dsh',
					width
				} as DsiPanelEntry;
			}
			if (entry.kind === 'skill-shelf') {
				// Reload blob sanitize (the Reload Rememberer ADR D1/D3, shape
				// pinned 2026-09-23): only a well-formed loading (numeric
				// startedAt) or unexpired done (numeric startedAt + doneAt)
				// survives; junk, the legacy `state`-keyed blob, and expired
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
			}
			if (entry.kind === 'plugin-rack') {
				// The Plugin Rack ADR (2026-09-27): the tab survives the reload
				// blob (the explorer-tab pattern); junk sanitizes to 'install'.
				return {
					id: entry.id as string,
					kind: 'plugin-rack',
					tab: entry.tab === 'uninstall' ? 'uninstall' : 'install',
					width
				} as DsiPanelEntry;
			}
			if (entry.kind === 'injected-doc') {
				return {
					id: entry.id as string,
					kind: 'injected-doc',
					sourceSessionId: entry.sourceSessionId as string,
					displayPath: entry.displayPath as string,
					width
				} as DsiPanelEntry;
			}
			if (entry.kind === 'workspace-explorer') {
				const home =
					entry.home === 'dsi' || entry.home === 'dsh' ? (entry.home as 'dsi' | 'dsh') : undefined;
				return {
					id: entry.id as string,
					kind: 'workspace-explorer',
					// Settings Tree D3: null provenance for a home explorer; junk
					// sessionId on a session explorer drops the entry via isPanelEntry.
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
			}
			if (entry.kind === 'workspace-file') {
				return {
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
				} as DsiPanelEntry;
			}
			return {
				...(entry as object),
				id: entry.id as string,
				kind: 'conversation',
				sessionId: entry.sessionId as string,
				agentPreset: (entry.agentPreset ?? null) as string | null,
				width
			} as DsiPanelEntry;
		})
		.filter((entry) => {
			if (seen.has(entry.id)) return false;
			seen.add(entry.id);
			return true;
		});
}

/**
 * Read the workspace state from localStorage.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored state when parseable (sanitized), defaults when absent,
 *          junk, or SSR. A `selectedPanelId` pointing at a missing panel
 *          sanitizes to the first panel's id (null when no panels remain).
 */
export function loadPanelPrefs(profile?: string | null): PanelPrefs {
	if (typeof localStorage === 'undefined') return defaultPanelPrefs();
	try {
		const raw = localStorage.getItem(panelPrefsKey(profile));
		if (!raw) return defaultPanelPrefs();
		const parsed = JSON.parse(raw) as Partial<PanelPrefs> | null;
		if (parsed === null || typeof parsed !== 'object') return defaultPanelPrefs();
		// Non-array panels = junk blob → whole-blob defaults (spec 1.2-T).
		if (!Array.isArray(parsed.panels)) return defaultPanelPrefs();
		const panels = sanitizePanels(parsed.panels);
		const panelWidth =
			typeof parsed.panelWidth === 'number' && Number.isFinite(parsed.panelWidth)
				? clampPanelWidth(parsed.panelWidth)
				: defaultPanelWidth();
		const zoom =
			typeof parsed.zoom === 'number' && Number.isFinite(parsed.zoom)
				? clampPanelZoom(parsed.zoom)
				: PANEL_DEFAULT_ZOOM;
		// The Explorer Layout (ADR D4): clamp through the single bound site;
		// absent in legacy blobs — only override the default when the stored
		// value is a usable number.
		const treePct =
			typeof parsed.treePct === 'number' && Number.isFinite(parsed.treePct)
				? clampTreePct(parsed.treePct)
				: TREE_PCT_DEFAULT;
		const selected =
			typeof parsed.selectedPanelId === 'string' &&
			panels.some((panel) => panel.id === parsed.selectedPanelId)
				? parsed.selectedPanelId
				: (panels[0]?.id ?? null);
		return { panels, selectedPanelId: selected, panelWidth, zoom, treePct };
	} catch {
		return defaultPanelPrefs();
	}
}

/**
 * Write the workspace state to localStorage (best-effort).
 * @param prefs the full state; always stored together.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function savePanelPrefs(prefs: PanelPrefs, profile?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(panelPrefsKey(profile), JSON.stringify(prefs));
	} catch {
		// Store full or blocked — persistence is lost, the floor is not.
	}
}

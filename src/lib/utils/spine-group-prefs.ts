/**
 * Spine-group preferences — persisted state for the sidebar's session
 * spine group (SidebarSessionsList's collapse/expand header, 2026-09-01):
 * the collapsed flag, the session-name filter text, the sub-agent
 * visibility toggle, and the date filter (2026-09-04). One key for one
 * state object; every field survives a hard reload per workspace desk.
 *
 * Same round-trip contract as panel-group-prefs.ts / session-filter-prefs.ts:
 * SSR-safe (no localStorage → default), junk payloads fall back PER FIELD,
 * writes are best-effort — a full or blocked store loses persistence,
 * never the layout. The group ships EXPANDED and unfiltered (the spine is
 * the sidebar's primary content — the Panels group's collapsed default is
 * intentionally not copied).
 */
import { dsiKey } from './storage-profile';

/** localStorage base key — one JSON blob `{collapsed, nameFilter, subagentsHidden}`. */
const STORAGE_KEY = 'dsi-spine-group';

export interface SpineGroupPrefs {
	/** Row list hidden — the header-only group (default: expanded). */
	collapsed: boolean;
	/** The header input's session-name filter ('' = unfiltered). */
	nameFilter: string;
	/** Sub-agent-origin rows removed from the spine (default: visible). */
	subagentsHidden: boolean;
	/** The header date button's picked day (YYYY-MM-DD, '' = unfiltered;
	 *  2026-09-04 — the FilterDateButton port, applied with the name
	 *  filter as a spine view filter). */
	dateFilter: string;
}

/** Persisted default: expanded, unfiltered, sub-agents visible. */
export function defaultSpineGroupPrefs(): SpineGroupPrefs {
	return { collapsed: false, nameFilter: '', subagentsHidden: false, dateFilter: '' };
}

/**
 * Read prefs from localStorage.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored prefs when parseable, defaults when absent, junk, or SSR.
 *          Per-field validation: `collapsed`/`subagentsHidden` are true only
 *          on an explicit `true`, `nameFilter` only on a string — anything
 *          else falls back to that field's default.
 */
export function loadSpineGroupPrefs(profile?: string | null): SpineGroupPrefs {
	if (typeof localStorage === 'undefined') return defaultSpineGroupPrefs();
	try {
		const raw = localStorage.getItem(dsiKey(STORAGE_KEY, profile));
		if (!raw) return defaultSpineGroupPrefs();
		const parsed = JSON.parse(raw) as Partial<SpineGroupPrefs> | null;
		if (parsed === null || typeof parsed !== 'object') return defaultSpineGroupPrefs();
		return {
			collapsed: parsed.collapsed === true,
			nameFilter: typeof parsed.nameFilter === 'string' ? parsed.nameFilter : '',
			subagentsHidden: parsed.subagentsHidden === true,
			dateFilter: typeof parsed.dateFilter === 'string' ? parsed.dateFilter : ''
		};
	} catch {
		return defaultSpineGroupPrefs();
	}
}

/**
 * Write prefs to localStorage (best-effort).
 * @param prefs the full preference blob; always stored as one value.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function saveSpineGroupPrefs(prefs: SpineGroupPrefs, profile?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(dsiKey(STORAGE_KEY, profile), JSON.stringify(prefs));
	} catch {
		// Store full or blocked — persistence is lost, the layout is not.
	}
}

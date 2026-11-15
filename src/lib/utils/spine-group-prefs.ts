/**
 * Spine-group preferences — persisted state for the sidebar's session
 * spine group (SidebarSessionList's collapse/expand header, 2026-09-01):
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
 *
 * ADR-0063 D6: the internals are the base store (createPrefsStore) —
 * same key, same blob shape.
 */
import { createPrefsStore } from '@deepseek-insight/container-base';

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

/** Per-field revive: `collapsed`/`subagentsHidden` are true only on an
 *  explicit `true`, `nameFilter`/`dateFilter` only on a string — anything
 *  else falls back to that field's default. */
function revive(parsed: unknown): SpineGroupPrefs | null {
	if (parsed === null || typeof parsed !== 'object') return null;
	const p = parsed as Partial<SpineGroupPrefs>;
	return {
		collapsed: p.collapsed === true,
		nameFilter: typeof p.nameFilter === 'string' ? p.nameFilter : '',
		subagentsHidden: p.subagentsHidden === true,
		dateFilter: typeof p.dateFilter === 'string' ? p.dateFilter : ''
	};
}

const store = createPrefsStore<SpineGroupPrefs>({
	key: STORAGE_KEY,
	defaults: defaultSpineGroupPrefs,
	revive
});

/**
 * Read prefs from localStorage.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored prefs when parseable, defaults when absent, junk, or SSR.
 */
export function loadSpineGroupPrefs(profile?: string | null): SpineGroupPrefs {
	return store.load(profile);
}

/**
 * Write prefs to localStorage (best-effort).
 * @param prefs the full preference blob; always stored as one value.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function saveSpineGroupPrefs(prefs: SpineGroupPrefs, profile?: string | null): void {
	store.save(prefs, profile);
}

/**
 * Panel-group preferences — persisted collapse state for the sidebar's
 * pinned panel group (SidebarOpenPanels, 2026-08-26).
 *
 * The group ships EXPANDED by default (2026-09-18; collapsed before):
 * the full row list is visible on load, and collapsing tucks it to the
 * header row. The choice persists per workspace desk — a hard reload
 * (or a profile switch) honors each desk's own memory.
 *
 * Same round-trip contract as sidebar-prefs.ts: SSR-safe (no localStorage →
 * default), junk payloads fall back to the default, writes are best-effort —
 * a full or blocked store loses persistence, never the layout.
 *
 * Fold map (2026-09-03, ADR The Tree That Remembers): the family fold
 * state joins the SAME blob as `unfoldedSessionIds` — the ids of sessions
 * whose families stand open, keyed by session id (host-issued, stable
 * across reloads). Absent entry = folded (the 2026-08-28 default); the
 * field's absence in a stored blob IS the old format (loads `[]`).
 */
import { dsiKey } from './storage-profile';

/** localStorage base key — one JSON blob `{collapsed, unfoldedSessionIds}`. */
const STORAGE_KEY = 'dsi-panel-group';

export interface PanelGroupPrefs {
	/** Row list hidden — the header-only group (false is the DEFAULT). */
	collapsed: boolean;
	/** Sessions whose families stand UNFOLDED (absent = folded). Pruned
	 *  to live floor members by the writer, never on load (load is dumb). */
	unfoldedSessionIds: string[];
}

/** Persisted default: expanded, every family folded. */
export function defaultPanelGroupPrefs(): PanelGroupPrefs {
	return { collapsed: false, unfoldedSessionIds: [] };
}

/** The fold field's junk fallback (spine-group grammar): only an array of
 *  non-empty strings survives — deduped, first occurrence keeps its order;
 *  everything else (non-array, non-string members, empty strings) falls
 *  back to the default `[]`. */
function sanitizeUnfoldedIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string' || entry === '' || ids.includes(entry)) continue;
		ids.push(entry);
	}
	return ids;
}

/**
 * Read prefs from localStorage.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored prefs when parseable, defaults when absent, junk, or SSR.
 *          Per-field: only an explicit `true` collapses — anything else
 *          stays expanded (the default wins on junk); the fold field
 *          passes through sanitizeUnfoldedIds, so a stored blob without it
 *          (the pre-2026-09-03 format) loads `[]`.
 */
export function loadPanelGroupPrefs(profile?: string | null): PanelGroupPrefs {
	if (typeof localStorage === 'undefined') return defaultPanelGroupPrefs();
	try {
		const raw = localStorage.getItem(dsiKey(STORAGE_KEY, profile));
		if (!raw) return defaultPanelGroupPrefs();
		const parsed = JSON.parse(raw) as Partial<PanelGroupPrefs> | null;
		if (parsed === null || typeof parsed !== 'object') return defaultPanelGroupPrefs();
		return {
			collapsed: parsed.collapsed === true,
			unfoldedSessionIds: sanitizeUnfoldedIds(parsed.unfoldedSessionIds)
		};
	} catch {
		return defaultPanelGroupPrefs();
	}
}

/**
 * Write prefs to localStorage (best-effort).
 * @param prefs the full preference blob; always stored as one value.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function savePanelGroupPrefs(prefs: PanelGroupPrefs, profile?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(dsiKey(STORAGE_KEY, profile), JSON.stringify(prefs));
	} catch {
		// Store full or blocked — persistence is lost, the layout is not.
	}
}

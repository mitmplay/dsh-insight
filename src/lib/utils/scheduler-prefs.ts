/**
 * Scheduler shelf prefs (ADR-0058 D2/D3, W2 task 2.2) — the persisted
 * collapsed + filter state of the sidebar's SchedulerShelf (Filter
 * Cluster ADR D5: nameFilter / dateFilter / viewMode ride beside the
 * fold; strict reads, junk falls back per field). One JSON blob under
 * localStorage['dsi-scheduler']; a workspace profile (`?profile=…`)
 * suffixes the key like every dsi-* key (container-base storage/namespace), so each
 * desk remembers its own fold.
 *
 * COLLAPSED BY DEFAULT (ADR-0058 D2/D3): the shelf stays a quiet ledger
 * line until the operator opens it. Defense follows the panel-prefs
 * pattern — now LITERALLY the pattern: the internals are the base store
 * (createPrefsStore, ADR-0063 D6), same key, same blob shape; SSR-safe,
 * strict per-field reads, best-effort write.
 */
import { createPrefsStore } from '@deepseek-insight/container-base';

/** localStorage base key — one JSON blob `{ collapsed: boolean }`.
 *  The default desk lives under `dsi-scheduler`, profile `widi` under
 *  `dsi-scheduler_widi`. */
export const SCHEDULER_PREFS_KEY = 'dsi-scheduler';

/**
 * The storage key for a workspace profile.
 * @param profile sanitized profile segment, or null/undefined for the
 *                default desk (`dsi-scheduler`).
 */
export function schedulerPrefsKey(profile?: string | null): string {
	return store.key(profile);
}

/** The shelf's view slice (Filter Cluster ADR D2): all rows, only rows
 *  with a scheduledAt, or only ended rows carrying a delivery receipt. */
export type SchedulerViewMode = 'all' | 'scheduled' | 'delivered';

/** The shelf's persisted shape (D3 fold + Filter Cluster ADR D5 filters). */
export interface SchedulerShelfPrefs {
	collapsed: boolean;
	/** Title-substring filter ('' = unfiltered). */
	nameFilter: string;
	/** Scheduled-day filter (YYYY-MM-DD, '' = unfiltered). */
	dateFilter: string;
	/** The tri-state delivery view (D2). */
	viewMode: SchedulerViewMode;
}

/** Persisted defaults when nothing (usable) is stored — collapsed, unfiltered (D2/D3 + D5). */
export function defaultSchedulerPrefs(): SchedulerShelfPrefs {
	return { collapsed: true, nameFilter: '', dateFilter: '', viewMode: 'all' };
}

/** Strict per-field revive (Filter Cluster ADR D5): only the exact shapes
 *  pass; junk — including old fold-only blobs — falls back per field
 *  without throwing and without inventing states. */
function revive(parsed: unknown): SchedulerShelfPrefs | null {
	if (parsed === null || typeof parsed !== 'object') return null;
	const p = parsed as Partial<SchedulerShelfPrefs>;
	return {
		collapsed: typeof p.collapsed === 'boolean' ? p.collapsed : true,
		nameFilter: typeof p.nameFilter === 'string' ? p.nameFilter : '',
		dateFilter: typeof p.dateFilter === 'string' ? p.dateFilter : '',
		viewMode:
			p.viewMode === 'scheduled' || p.viewMode === 'delivered'
				? p.viewMode
				: 'all'
	};
}

const store = createPrefsStore<SchedulerShelfPrefs>({
	key: SCHEDULER_PREFS_KEY,
	defaults: defaultSchedulerPrefs,
	revive
});

/**
 * Read the shelf's persisted fold.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored fold when strictly boolean, defaults when absent, junk,
 *          or SSR. Junk never throws and never invents a third state.
 */
export function loadSchedulerPrefs(profile?: string | null): SchedulerShelfPrefs {
	return store.load(profile);
}

/**
 * Write the shelf's fold to localStorage (best-effort).
 * @param prefs the fold state.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function saveSchedulerPrefs(prefs: SchedulerShelfPrefs, profile?: string | null): void {
	store.save(prefs, profile);
}

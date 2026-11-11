/**
 * Scheduler shelf prefs (ADR-0058 D2/D3, W2 task 2.2) — the persisted
 * collapsed state of the sidebar's SchedulerShelf. One JSON blob under
 * localStorage['dsi-scheduler']; a workspace profile (`?profile=…`)
 * suffixes the key like every dsi-* key (storage-profile.ts), so each
 * desk remembers its own fold.
 *
 * COLLAPSED BY DEFAULT (ADR-0058 D2/D3): the shelf stays a quiet ledger
 * line until the operator opens it. Defense follows the panel-prefs
 * pattern: SSR-safe (no localStorage → defaults), strict boolean read
 * (only true/false pass — junk falls back to the default without
 * throwing), best-effort write (quota-full or blocked storage loses the
 * fold, never the shelf).
 */
import { dsiKey } from './storage-profile';

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
	return dsiKey(SCHEDULER_PREFS_KEY, profile);
}

/** The shelf's persisted shape (D3): just the fold. */
export interface SchedulerShelfPrefs {
	collapsed: boolean;
}

/** Persisted defaults when nothing (usable) is stored — collapsed (D2/D3). */
export function defaultSchedulerPrefs(): SchedulerShelfPrefs {
	return { collapsed: true };
}

/**
 * Read the shelf's persisted fold.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored fold when strictly boolean, defaults when absent, junk,
 *          or SSR. Junk never throws and never invents a third state.
 */
export function loadSchedulerPrefs(profile?: string | null): SchedulerShelfPrefs {
	if (typeof localStorage === 'undefined') return defaultSchedulerPrefs();
	try {
		const raw = localStorage.getItem(schedulerPrefsKey(profile));
		if (!raw) return defaultSchedulerPrefs();
		const parsed = JSON.parse(raw) as Partial<SchedulerShelfPrefs> | null;
		if (parsed === null || typeof parsed !== 'object') return defaultSchedulerPrefs();
		// Strict boolean: only true/false pass; anything else → collapsed.
		return { collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : true };
	} catch {
		return defaultSchedulerPrefs();
	}
}

/**
 * Write the shelf's fold to localStorage (best-effort).
 * @param prefs the fold state.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function saveSchedulerPrefs(prefs: SchedulerShelfPrefs, profile?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(schedulerPrefsKey(profile), JSON.stringify(prefs));
	} catch {
		// Quota-full or blocked storage — persistence is lost, the shelf is not.
	}
}

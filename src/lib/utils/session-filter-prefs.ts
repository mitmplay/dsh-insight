/**
 * Session-filter preferences — the persisted SessionFilterRow state
 * (workspace + preset pills, and the conversation-count toggle), 2026-08-23.
 *
 * Review decision: the ENTIRE filter state survives a hard reload — a
 * filter the user set is a view they will want back when they return,
 * not a question to re-ask. One key for one state object, shared by both
 * surfaces (sidebar header + home filters row), last writer wins.
 *
 * Legacy: `dsi-blank-mode` (the toggle's first, standalone key) is honored
 * READ-ONLY for blankMode — a preference set before the consolidation
 * survives it; writes never touch the old key.
 *
 * Same localStorage discipline as sidebar-prefs: SSR-safe (no store →
 * default), junk and wrong-shaped fields fall back PER FIELD, writes are
 * best-effort (a full or blocked store loses persistence, never the page).
 *
 * Workspace profiles (storage-profile.ts): `?profile=widi` moves the key
 * to `dsi-session-filter_widi` — each desk remembers its own pills. The
 * legacy `dsi-blank-mode` fallback stays GLOBAL (it predates profiles).
 */

import { DEFAULT_SESSION_FILTER, isBlankMode, type SessionFilterState } from './session-filters';
import { dsiKey } from './storage-profile';

/** localStorage key — one JSON blob `{workspace, preset, blankMode}`. */
const STORAGE_KEY = 'dsi-session-filter';

/** Legacy toggle-only key — read as the blankMode fallback, never written. */
const LEGACY_BLANK_KEY = 'dsi-blank-mode';

/** A dimension key is valid only as a non-empty string (null = unfiltered). */
function readKey(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}

function legacyBlankMode(): SessionFilterState['blankMode'] {
	if (typeof localStorage === 'undefined') return DEFAULT_SESSION_FILTER.blankMode;
	try {
		const parsed = JSON.parse(localStorage.getItem(LEGACY_BLANK_KEY) ?? 'null') as unknown;
		return isBlankMode(parsed) ? parsed : DEFAULT_SESSION_FILTER.blankMode;
	} catch {
		return DEFAULT_SESSION_FILTER.blankMode;
	}
}

/**
 * Read the persisted session filter.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns the stored filter with per-field validation; any absent, junk,
 *   or wrong-shaped field falls back (blankMode consults the legacy key
 *   before its own default). SSR and missing storage return the default.
 */
export function loadSessionFilter(profile?: string | null): SessionFilterState {
	if (typeof localStorage === 'undefined') return { ...DEFAULT_SESSION_FILTER };
	try {
		const raw = localStorage.getItem(dsiKey(STORAGE_KEY, profile));
		if (!raw) return { ...DEFAULT_SESSION_FILTER, blankMode: legacyBlankMode() };
		const parsed = JSON.parse(raw) as Partial<Record<keyof SessionFilterState, unknown>>;
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { ...DEFAULT_SESSION_FILTER, blankMode: legacyBlankMode() };
		}
		return {
			workspace: readKey(parsed.workspace),
			preset: readKey(parsed.preset),
			blankMode: isBlankMode(parsed.blankMode)
				? parsed.blankMode
				: legacyBlankMode()
		};
	} catch {
		return { ...DEFAULT_SESSION_FILTER, blankMode: legacyBlankMode() };
	}
}

/**
 * Write the session filter (best-effort).
 * @param filter the full state; always stored together.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function saveSessionFilter(filter: SessionFilterState, profile?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(dsiKey(STORAGE_KEY, profile), JSON.stringify(filter));
	} catch {
		// Store full or blocked — persistence is lost, the page is not.
	}
}

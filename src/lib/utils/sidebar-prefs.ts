/**
 * Sidebar preferences — persisted layout state for the conversation page's
 * app sidebar (OCI ControlRail pattern, 2026-08-23).
 *
 * Pure localStorage round-trip: SSR-safe (no localStorage → defaults), junk
 * payloads and out-of-range widths fall back instead of throwing into the
 * page, and writes are best-effort (a full or blocked store must not break
 * the layout — it only loses persistence for that session).
 *
 * Workspace profiles (storage-profile.ts): `?profile=widi` moves the key
 * to `dsi-sidebar_widi` — each desk remembers its own rail layout.
 */
import { appConfig } from '$lib/services/config/app-config.svelte';
import { dsiKey } from './storage-profile';

/** localStorage base key — one JSON blob `{ collapsed, width }`. */
const STORAGE_KEY = 'dsi-sidebar';

/** Expanded sidebar default width (px). Config-tunable (2026-08-25):
 *  ~/.dsi/settings.yaml `sidebar.defaultWidth` overrides at runtime —
 *  the constants below are the FALLBACK defaults (unit-test values). */
export const SIDEBAR_DEFAULT_WIDTH = 400;

/** Resize clamp bounds (px) — the drag may never leave this range.
 *  Config-tunable: `sidebar.minWidth` / `sidebar.maxWidth`. */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 500;

export interface SidebarPrefs {
	/** Rail renders the 34px stub instead of the expanded aside. */
	collapsed: boolean;
	/** Expanded rail width in px, always within the clamp bounds. */
	width: number;
}

/** The single width bound site — load-side sanitizing and drag clamping
 *  both route through here so the bounds exist in exactly one place.
 *  Bounds read the config store (layout load has landed them before any
 *  mount; constants are the fallback defaults). */
export function clampSidebarWidth(width: number): number {
	const { minWidth, maxWidth } = appConfig().sidebar;
	return Math.max(minWidth, Math.min(maxWidth, width));
}

/** Config-driven default width (clamped through the single bound site). */
function defaultSidebarWidth(): number {
	return clampSidebarWidth(appConfig().sidebar.defaultWidth);
}

/** Persisted defaults when nothing (usable) is stored. */
export function defaultSidebarPrefs(): SidebarPrefs {
	return { collapsed: false, width: defaultSidebarWidth() };
}

/**
 * Read prefs from localStorage.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 * @returns stored prefs when parseable, defaults when absent, junk, or SSR.
 */
export function loadSidebarPrefs(profile?: string | null): SidebarPrefs {
	if (typeof localStorage === 'undefined') return defaultSidebarPrefs();
	try {
		const raw = localStorage.getItem(dsiKey(STORAGE_KEY, profile));
		if (!raw) return defaultSidebarPrefs();
		const parsed = JSON.parse(raw) as Partial<SidebarPrefs> | null;
		if (parsed === null || typeof parsed !== 'object') return defaultSidebarPrefs();
		return {
			collapsed: parsed.collapsed === true,
			width: clampSidebarWidth(
				typeof parsed.width === 'number' && Number.isFinite(parsed.width)
					? parsed.width
					: defaultSidebarWidth()
			)
		};
	} catch {
		return defaultSidebarPrefs();
	}
}

/**
 * Write prefs to localStorage (best-effort).
 * @param prefs the full preference pair; always stored together.
 * @param profile sanitized workspace profile (null/omitted = default desk).
 */
export function saveSidebarPrefs(prefs: SidebarPrefs, profile?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(dsiKey(STORAGE_KEY, profile), JSON.stringify(prefs));
	} catch {
		// Store full or blocked — persistence is lost, the layout is not.
	}
}

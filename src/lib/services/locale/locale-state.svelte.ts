/**
 * Locale state service — Three Tongues W2 task 2.1 (ADR 2026-09-12 D2/D3),
 * migrated onto the base i18n store (ADR-0063 D3).
 *
 * THE one client-side seat for "what language are we in": BOTH mounts
 * (header menu, settings row) consume this — neither duplicates
 * resolution or persistence logic. The SURVIVAL mechanism (localStorage
 * mirror + dsi.locale cookie dual-write) lives in
 * @deepseek-insight/container-base/src/i18n/ — DSI contributes its
 * identity: the key/cookie name 'dsi.locale' and the locale fleet.
 * Paraglide remains the SSR reader and the runtime truth during a
 * session (setLocale still routes through it, no-reload per D2); the
 * base store only mirrors — the risk-register contract.
 *
 * Public API is unchanged from the hand-rolled module this replaces.
 */

import { setLocale as paraglideSetLocale, getLocale } from '$lib/paraglide/runtime';
import { createLocalePrefs } from '@deepseek-insight/container-base';
import { UI_LOCALES, DEFAULT_UI_LOCALE, type UiLocale } from '$lib/config';

export const localePrefs = createLocalePrefs({
	baseKey: 'dsi.locale',
	cookieName: 'dsi.locale',
	locales: UI_LOCALES,
	defaultLocale: DEFAULT_UI_LOCALE
});

const state = $state({ locale: DEFAULT_UI_LOCALE as UiLocale });

/** The active locale. The RUNTIME's strategy chain (cookie -> localStorage
 *  -> baseLocale, SSR-aware via AsyncLocalStorage) is the source of truth —
 *  a fresh page load must reflect the cookie, not our en-initialized state
 *  (reload bug found by the AC3 e2e, 2026-09-12). The base store's read
 *  (cookie -> storage -> default) is the fallback arm. */
export function currentLocale(): UiLocale {
	const tracked = ($state.snapshot(state) as { locale: UiLocale }).locale;
	try {
		const runtime = getLocale() as unknown;
		if (UI_LOCALES.includes(runtime as UiLocale)) return runtime as UiLocale;
	} catch {
		// runtime not ready (no locale set yet) — fall through to the base read
	}
	const base = localePrefs.read() as UiLocale;
	return UI_LOCALES.includes(tracked) ? tracked : UI_LOCALES.includes(base) ? base : DEFAULT_UI_LOCALE;
}

/** Switch language. No navigation (D2). The base store dual-writes the
 *  dsi.locale cookie + localStorage mirror; paraglide switches the live
 *  runtime (and re-states the cookie — same value, one truth). SSR
 *  callers are silently ignored. */
export async function setLocale(next: UiLocale): Promise<void> {
	if (!UI_LOCALES.includes(next)) return; // invalid -> silent no-op (D3 gate)
	localePrefs.set(next);
	await paraglideSetLocale(next, { reload: false });
	state.locale = next;
}

/** Reactive read for mounts — a function call keeps the rune tracking
 *  alive in the component's effect scope. */
export function localeState(): { locale: UiLocale } {
	return state;
}

/**
 * The translation seat: t(m.key) in a template. THE instant-switch
 * mechanism (bug-fix 2026-09-12). Reads state.locale FIRST so the
 * calling template registers a reactive dependency, then resolves the
 * message through the (already switched) runtime locale.
 */
export function t(fn: () => string): string {
	void $state.snapshot(state).locale; // reactive dependency — do not remove
	try {
		const runtime = getLocale() as unknown;
		if (UI_LOCALES.includes(runtime as UiLocale)) return fn();
	} catch {
		// runtime not ready — fall through, fn resolves via its own default
	}
	return fn();
}

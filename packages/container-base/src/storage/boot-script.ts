/**
 * The pre-paint panels boot script — an inline SCRIPT SOURCE STRING the
 * consumer embeds in its HTML template (ADR-0067 D1/D2/D3). It re-derives
 * the storage key with the SAME grammar as namespace.ts
 * (<baseKey> + '_' + sanitized ?profile=), reads the raw blob, and
 * publishes window.__BOOT_PREFS[baseKey] = { profile, raw } BEFORE first
 * paint — the app's prefs parser consumes the raw string as its first
 * read, so the first paint is the saved desk. Parsing NEVER happens here:
 * the consumer's prefs module stays the only parser (D3).
 *
 * It cannot import modules (it runs before the bundle), so the derivation
 * is generated from this one function: consumers never hand-copy it.
 * Same house pattern as theming/applier.ts (themeApplierScript, ADR-0063
 * D2) — one generated source per inline block, shared by every consumer
 * app (DSI, Playground, …) through their sync scripts.
 *
 * Pure string generation — no runes — so plain node (strip-types) can
 * import it for HTML template generation (scripts/sync-theme-applier.mjs).
 */

/**
 * Generate the inline script source for a consumer's prefs base key.
 * The global is a keyed REGISTER (window.__BOOT_PREFS[baseKey]) so one
 * block can later carry several pref keys without new mechanisms (D4).
 */
export function panelsBootScript(baseKey: string): string {
	return `try {
	var m = location.search.match(/[?&]profile=([^&]*)/);
	var prof = m ? m[1].replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
	var k = '${baseKey}' + (prof ? '_' + prof : '');
	var raw = localStorage.getItem(k);
	if (typeof raw === 'string' && raw.length > 0) {
		(window.__BOOT_PREFS = window.__BOOT_PREFS || {})['${baseKey}'] = { profile: prof, raw: raw };
	}
} catch (e) {}`;
}

/**
 * The pre-paint theme applier — an inline SCRIPT SOURCE STRING the consumer
 * embeds in its HTML template (ADR-0063 D2). It re-derives the storage key
 * with the SAME grammar as theming/theme-prefs.svelte.ts (namespace.ts:
 * <baseKey> + '_' + sanitized ?profile=), reads the choice, resolves system
 * against the OS, and sets html[data-theme] BEFORE first paint — no flash.
 *
 * It cannot import modules (it runs before the bundle), so the derivation is
 * generated from this one function: consumers never hand-copy it.
 *
 * Pure string generation — no runes — so plain node (strip-types) can import
 * it for HTML template generation (scripts/sync-theme-applier.mjs).
 */

/** Generate the inline script source for a consumer's theme base key. */
export function themeApplierScript(baseKey: string): string {
	return `try {
	var m = location.search.match(/[?&]profile=([^&]*)/);
	var prof = m ? m[1].replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
	var k = '${baseKey}' + (prof ? '_' + prof : '');
	var t = localStorage.getItem(k);
	if (t !== 'light' && t !== 'dark' && t !== 'system') t = 'system';
	document.documentElement.dataset.theme =
		t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
			? 'dark'
			: 'light';
} catch (e) {
	document.documentElement.dataset.theme = 'light';
}`;
}

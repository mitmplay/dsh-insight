<script lang="ts">
	/**
	 * CloseButton — the tab-strip ✕ as a reusable button (extracted from
	 * BrowserTab 2026-11-02; TerminalTabButton's inline ✕ span migrated same
	 * day). Presentational (house button pattern, see ReloadButton): the
	 * CALLER owns what closing means and ALL the chrome — pass Tailwind
	 * classes via `class`; the button renders the glyph and reports the click.
	 *
	 * Contract: the click NEVER bubbles (both tab callers stopPropagation'd —
	 * the strip's select must not fire when the ✕ is hit) and the button is
	 * focusable only when the caller says so (`tabindex` — the terminal tab
	 * passes -1 so keyboard focus lands on the tab, not the close).
	 */
	let {
		/** Click handler — the caller's close logic (already stopPropagation'd). */
		onclick,
		/** Accessible name / tooltip (i18n'd by the caller). */
		label,
		/** The surface's own e2e seam (browser-tab-close, terminal-tab-close-N). */
		testid,
		/** Focusability override — terminal tabs pass -1 (tab owns the key lane). */
		tabindex = undefined,
		/** Caller chrome classes (positioning, hover-reveal, destructive…). */
		class: className = ''
	}: {
		onclick: (e: MouseEvent) => void;
		label: string;
		testid: string;
		tabindex?: number | undefined;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	class={className}
	data-testid={testid}
	title={label}
	aria-label={label}
	{tabindex}
	onclick={(e) => {
		e.stopPropagation();
		onclick(e);
	}}>✕</button
>

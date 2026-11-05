<script lang="ts">
/**
 * TermFontSlider — the terminal base font control (ADR-0041 Am.4):
 * a right-aligned range input plus the px readout, mounted in the
 * TerminalPanel header row (the settle-badge's parent). Presentational
 * (house pattern, ZoomSlider 2026-11-02): the CALLER owns what a font
 * change means — the desk forwards px upward and the route persists
 * pagePrefs.termFontSize; the panel re-fires the pocket's refit.
 *
 * Contract: the prop is the base font in PX (TERM_FONT_MIN–MAX); the
 * slider renders and reports PX. The readout is exact at floor zoom 1
 * (zoom multiplies on top).
 */
	let {
		/** Current base font in px (8 … 20) — null-safe caller. */
		font,
		/** Change handler — receives the new base font in px. */
		onchange,
		/** Accessible name / tooltip (i18n'd by the caller). */
		label,
		/** The surface's own e2e seam (terminal-font-slider). */
		testid,
		/** Caller chrome classes (width, alignment, accent…). */
		class: className = ''
	}: {
		font: number;
		onchange: (px: number) => void;
		label: string;
		testid: string;
		class?: string;
	} = $props();
</script>

<div class="flex shrink-0 items-center gap-1 {className}">
	<input
		type="range"
		min="8"
		max="20"
		step="1"
		value={font}
		data-testid={testid}
		aria-label={label}
		title={label}
		class="h-1 w-16 accent-[var(--color-accent-purple)]"
		oninput={(e) => onchange(Number((e.currentTarget as HTMLInputElement).value))}
	/>
		<!-- gap-1 IS the 0.25rem input↔readout gap (the ZoomSlider pin).
		     The px readout speaks accent-purple — the token flips per theme
		     (light #8b5cf6, dark #a78bfa), matching the glass zoom slider. -->
	<span class="text-right font-bold tabular-nums text-[var(--color-accent-purple)]" data-testid="{testid}-readout">{font}px</span>
</div>

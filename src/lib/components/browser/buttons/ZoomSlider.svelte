<script lang="ts">
	/**
	 * ZoomSlider — the live zoom control of the glass browser (extracted
	 * from BrowserPanel 2026-11-02): a right-aligned range input plus the
	 * percent readout. Presentational (house pattern): the CALLER owns what
	 * a zoom change means — the panel debounces the POST and the registry
	 * applies the zoom to every attached tab instantly, no reload.
	 *
	 * Contract: `zoom` is a FRACTION (0.5–1.25 on the wire); the slider
	 * renders and reports PERCENT (50–125, step 5) and converts both ways.
	 */
	let {
		/** Current zoom as a fraction of 1 (0.5 … 1.25) — null-safe caller. */
		zoom,
		/** Change handler — receives the new zoom FRACTION. */
		onchange,
		/** Accessible name / tooltip (i18n'd by the caller). */
		label,
		/** The surface's own e2e seam (browser-zoom-slider). */
		testid,
		/** Caller chrome classes (width, alignment, accent…). */
		class: className = ''
	}: {
		zoom: number;
		onchange: (percent: number) => void;
		label: string;
		testid: string;
		class?: string;
	} = $props();
</script>

<div class="flex shrink-0 items-center gap-1 {className}">
	<input
		type="range"
		min="50"
		max="125"
		step="5"
		value={Math.round(zoom * 100)}
		data-testid={testid}
		aria-label={label}
		title={label}
		class="h-1 w-20 accent-[var(--color-accent-purple)]"
		oninput={(e) => onchange(Number((e.currentTarget as HTMLInputElement).value))}
	/>
		<!-- gap-1 IS the 0.25rem input↔readout gap (pinned). The % readout
		     speaks accent-purple — the token flips per theme (light #8b5cf6,
		     dark #a78bfa), so both themes get a violet tuned to their surface. -->
		<span class="text-right font-bold tabular-nums text-[var(--color-accent-purple)]">{Math.round(zoom * 100)}%</span>
</div>

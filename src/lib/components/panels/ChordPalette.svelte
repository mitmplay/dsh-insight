<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { CHORD_WINDOW_MS } from '$lib/utils/key-chords';
	/**
	 * ChordPalette — the armed Alt+S chord's face (ADR-0006a amendment
	 * D16/D18, 2026-10-31). Centered on the viewport; while armed it fills
	 * a footer progress bar 0→100% across IDLE_CLOSE_MS — pastel-green
	 * while the chord's 2s action window (CHORD_WINDOW_MS) is open,
	 * pastel-yellow after — and at 100% fires `onexpire` (the route resets
	 * the chord to idle). The clock is THIS component's visibility
	 * lifecycle (D18: view-lifecycle, not reducer state); every other rule
	 * of the pure view stands: no stores, no key handlers.
	 */

	/** The 10s idle window before the palette closes itself (D18). */
	const IDLE_CLOSE_MS = 10_000;

	let {
		open,
		rows,
		since,
		prefix,
		onexpire
	}: {
		/** True between the arming chord and the fire / disarm / decay. */
		open: boolean;
		/** The live options, already filtered by the reducer helper. */
		rows: { key: string; label: string }[];
		/** Date.now() of the arming — the decay clock's zero. */
		since: number;
		/** The armed prefix — the palette names it (Alt+S or Alt+T, ADR-0052). */
		prefix: 's' | 't';
		/** Fired once at 100% — the route resets the chord. */
		onexpire: () => void;
	} = $props();

	// The decay clock: the ticker runs ONLY while armed — the floor's BC-7
	// discipline counts every persistent client interval, and a palette
	// that lives for seconds must not add a permanent one (round-2 lesson:
	// the always-on ticker broke 'zero new client timers').
	let now = $state(Date.now());
	const elapsed = $derived(open ? Math.max(0, Math.min(now - (since || Date.now()), IDLE_CLOSE_MS)) : 0);
	const expired = $derived(open && elapsed >= IDLE_CLOSE_MS);

	$effect(() => {
		if (!open) return;
		const ticker = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(ticker);
	});
	$effect(() => {
		if (expired) onexpire();
	});
	const pct = $derived(Math.round((elapsed / IDLE_CLOSE_MS) * 100));
	const inActionWindow = $derived(elapsed < CHORD_WINDOW_MS);
	const barColor = $derived(inActionWindow ? 'bg-green-300' : 'bg-yellow-200');
</script>

{#if open}
	<div
		class="fixed top-1/2 left-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-black/10 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-white/15 dark:bg-neutral-900/95"
		data-testid="chord-palette"
		data-chord-elapsed={elapsed}
		aria-live="polite"
		aria-label={t(() => m.chordArmedLabel({ prefix }))}
	>
		<div class="mb-1 text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
			{t(() => m.chordArmedTitle({ prefix }))}
		</div>
		<ul class="m-0 list-none space-y-0.5 p-0">
			{#each rows as row (row.key)}
				<li class="flex items-center gap-2 text-xs" data-testid="chord-palette-row" data-chord-key={row.key}>
					<kbd class="min-w-5 rounded border border-black/15 bg-neutral-100 px-1 text-center font-mono text-[11px] dark:border-white/20 dark:bg-neutral-800">
						{row.key}
					</kbd>
					<span class="text-neutral-700 dark:text-neutral-200">{row.label}</span>
				</li>
			{/each}
		</ul>
		<!-- D18: the idle clock — green while a verb/digit still lands, yellow after -->
		<div class="mt-2 h-1 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-700" data-testid="chord-palette-decay">
			<div
				class="h-full {barColor} transition-[width] duration-100 ease-linear"
				style="width: {pct}%"
				data-testid="chord-palette-progress"
				data-chord-phase={inActionWindow ? 'action' : 'idle'}
			></div>
		</div>
	</div>
{/if}

<script lang="ts">
	/**
	 * ChordPaletteOverlay — the armed chord's face (ADR-0006a amendment
	 * D16/D18 port; container-base W4, ADR-0062 D8): a centered overlay
	 * with the live option rows and a decay ticker. The consumer passes
	 * its OWN labels (rows carry label text; title/ariaLabel arrive as
	 * props — the package never learns a translation system) and its
	 * action-window length (windowMs). The overlay holds NO armed state:
	 * open/since come in, onexpire fires out.
	 *
	 * While open it fills a footer progress bar 0→100% across
	 * idleCloseMs — inside windowMs the bar reads in-action, past it
	 * idle — and at 100% fires onexpire once. The clock is THIS
	 * component's visibility lifecycle (D18: view-lifecycle, not
	 * reducer state).
	 */

	let {
		open,
		rows,
		since,
		windowMs,
		idleCloseMs = 10_000,
		title,
		ariaLabel,
		onexpire
	}: {
		/** True between the arming chord and the fire / disarm / decay. */
		open: boolean;
		/** The live options, already filtered by the consumer's reducer. */
		rows: { key: string; label: string }[];
		/** Date.now() of the arming — the decay clock's zero. */
		since: number;
		/** The consumer's action-window length (ms) — inside it the bar
		 *  reads in-action; the consumer owns the semantics (ADR-0052). */
		windowMs: number;
		/** The idle window before the overlay closes itself (default 10s). */
		idleCloseMs?: number;
		/** The strip title (consumer-localized, names the armed prefix). */
		title: string;
		/** Accessible name for the overlay (consumer-localized). */
		ariaLabel: string;
		/** Fired once at 100% — the host resets the chord. */
		onexpire?: () => void;
	} = $props();

	// The decay clock: the ticker runs ONLY while open — the host's timer
	// discipline counts every persistent client interval, and an overlay
	// that lives for seconds must not add a permanent one.
	let now = $state(Date.now());
	const elapsed = $derived(open ? Math.max(0, Math.min(now - (since || Date.now()), idleCloseMs)) : 0);
	const expired = $derived(open && elapsed >= idleCloseMs);

	$effect(() => {
		if (!open) return;
		const ticker = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(ticker);
	});
	$effect(() => {
		if (expired) onexpire?.();
	});
	const pct = $derived(Math.round((elapsed / idleCloseMs) * 100));
	const inActionWindow = $derived(elapsed < windowMs);
	// Ground rule: the ticker colors cross through tokens — no palette classes (W6).
	const barColor = $derived(inActionWindow ? 'bg-[var(--color-chord-armed)]' : 'bg-[var(--color-chord-idle)]');
</script>

{#if open}
	<div
		class="fixed top-1/2 left-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-elevated)] px-3 py-2 shadow-lg backdrop-blur"
		data-testid="chord-palette"
		data-chord-elapsed={elapsed}
		aria-live="polite"
		aria-label={ariaLabel}
	>
		<div class="mb-1 text-[10px] font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
			{title}
		</div>
		<ul class="m-0 list-none space-y-0.5 p-0">
			{#each rows as row (row.key)}
				<li class="flex items-center gap-2 text-xs" data-testid="chord-palette-row" data-chord-key={row.key}>
					<kbd class="min-w-5 rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-secondary)] px-1 text-center font-mono text-[11px]">
						{row.key}
					</kbd>
					<span class="text-[var(--color-text-primary)]">{row.label}</span>
				</li>
			{/each}
		</ul>
		<!-- The idle clock: in-action while the consumer's window is open, idle after -->
		<div class="mt-2 h-1 w-full overflow-hidden rounded bg-[var(--color-surface-secondary)]" data-testid="chord-palette-decay">
			<div
				class="h-full {barColor} transition-[width] duration-100 ease-linear"
				style="width: {pct}%"
				data-testid="chord-palette-progress"
				data-chord-phase={inActionWindow ? 'action' : 'idle'}
			></div>
		</div>
	</div>
{/if}

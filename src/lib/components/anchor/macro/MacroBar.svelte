<script lang="ts">
	import type { MacroRunState } from '$lib/services/chat/macro-runner.svelte';
	import MacroChip from './MacroChip.svelte';
	import MacroSheet from './MacroSheet.svelte';

	/**
	 * MacroBar — the Prompt Macro's status surface (ADR D7 + D9,
	 * 2026-08-29): the always-visible layer above the composer, split
	 * into two children — MacroChip (the collapsed chip + Stop/Close)
	 * and MacroSheet (the expanded per-line rows + held/ended controls).
	 * The bar owns the expand state and forwards everything else.
	 *
	 * Presentational by contract (PRD Module Map): run state and the
	 * panel's own poll truth (running, pendingAnswers) arrive as props;
	 * every control leaves as a callback. The component never fetches,
	 * never polls, never imports the runner — the panel owns the wiring
	 * (D7: "the chip reads the panel's existing poll state; the runner
	 * itself never polls").
	 */
	let {
		run,
		landedTurns = 0,
		running = false,
		pendingAnswers = 0,
		onfeednext,
		onrunall,
		onabort,
		onrunagain,
		onclose
	}: {
		/** The runner's reactive state (phase/total/fed/lines/note). */
		run: MacroRunState;
		/** Fed lines whose paired assistant turn has LANDED (panel-derived,
		 *  D9) — forwarded to MacroSheet for ✓ ahead of ⏳. */
		landedTurns?: number;
		/** A turn is in flight on this panel's session (store.isStreaming). */
		running?: boolean;
		/** Pending answerer cards on this panel (store.answerList count). */
		pendingAnswers?: number;
		/** [Feed next] — held runs: submit exactly one line (D10). */
		onfeednext?: () => void;
		/** [Run all] — held runs: release the hold (D10). */
		onrunall?: () => void;
		/** Stop/Abort — drop UNFED lines only (forward-only, D10). */
		onabort?: () => void;
		/** [Run again] — ended runs re-enter the same loop (D10). */
		onrunagain?: () => void;
		/** Close (✕) — ended runs dismiss the sheet (panel calls runner dismiss). */
		onclose?: () => void;
	} = $props();

	/** Sheet expanded state — the chip toggles it (click again to collapse). */
	let expanded = $state(false);
</script>

{#if run.phase !== 'idle'}
	<div class="macro-run" data-testid="macro-run">
		<!-- Collapsed chip (D7) — label derivation and Stop/Close live in
		     MacroChip (extracted 2026-10-19). -->
		<MacroChip
			{run}
			{running}
			{pendingAnswers}
			{expanded}
			ontoggle={() => (expanded = !expanded)}
			{onabort}
			{onclose}
		/>

		<!-- Expanded sheet (D9) — rows and held/ended controls live in
		     MacroSheet (extracted 2026-10-19). -->
		{#if expanded}
			<MacroSheet {run} {landedTurns} {running} {onfeednext} {onrunall} {onabort} {onrunagain} />
		{/if}
	</div>
{/if}

<style>
	.macro-run {
		margin: 0 0.5rem 0.25rem;
		font-size: 0.75rem;
	}
</style>

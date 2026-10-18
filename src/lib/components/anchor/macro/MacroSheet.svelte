<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type {
		MacroLineRecord,
		MacroRunState
	} from '$lib/services/chat/macro-runner.svelte';

	/**
	 * MacroSheet — the expanded SHEET of the Prompt Macro's status surface
	 * (ADR D9, 2026-08-29): one row per executed line, each with one of
	 * six state marks (✓ ▶ ⏳ ⊙ ⊘ ✕) plus the a2a/query marks (↗ ⌕).
	 *
	 * Extracted from MacroBar — the bar keeps the collapsed chip and the
	 * expand toggle; this component renders only the expanded rows and
	 * the held/ended controls.
	 *
	 * Presentational by contract (PRD Module Map): run state, per-line
	 * records, and the panel's own poll truth (running, landedTurns)
	 * arrive as props; every control leaves as a callback. Never
	 * fetches, never polls, never imports the runner.
	 *
	 * ▶/✓ derivation inputs (props, never fetched): `landedTurns` = how
	 * many of the run's turns have landed at this render; `running` =
	 * the panel's own store.isStreaming.
	 */
	let {
		run,
		landedTurns = 0,
		running = false,
		onfeednext,
		onrunall,
		onabort,
		onrunagain
	}: {
		/** The runner's reactive state (phase/total/fed/lines/note). */
		run: MacroRunState;
		/** Fed lines whose paired assistant turn has LANDED (panel-derived,
		 *  D9) — drives ✓ ahead of the runner's own ⏳. */
		landedTurns?: number;
		/** A turn is in flight on this panel's session (store.isStreaming) —
		 *  gates ▶. */
		running?: boolean;
		/** [Feed next] — held runs: submit exactly one line (D10). */
		onfeednext?: () => void;
		/** [Run all] — held runs: release the hold (D10). */
		onrunall?: () => void;
		/** Stop/Abort — drop UNFED lines only (forward-only, D10). */
		onabort?: () => void;
		/** [Run again] — ended runs re-enter the same loop (D10). */
		onrunagain?: () => void;
	} = $props();

	/** The run is over (either ending) — [Run again] appears (D10). */
	const ended = $derived(run.phase === 'fed' || run.phase === 'stopped' || run.phase === 'failed');
	/** A live run could still feed (held or mid-feed) — Stop means
	 * "stop sending more" (abort-after-queued honesty, D10). */
	const canAbort = $derived((run.phase === 'held' || run.phase === 'feeding') && run.fed < run.total);

	/**
	 * The six-state mark for one row (D9), classified by the record's
	 * TYPED kind — never note-text sniffing (W2 2.2 killed it: a
	 * /permission note shifted every later ✓/▶ pairing by one):
	 *   - command rows (both /new and /permission) are terminal
	 *     host-side → ✓ on receipt, no turn to wait for
	 *   - mention rows delegate progress to the a2a chip stack → ↗
	 *   - query rows resolved into the rows below them → ⌕
	 *   - send rows upgrade ⏙→▶→✓ from the panel-derived landedTurns —
	 *     the k-th turn-capable fed row is done when landedTurns ≥ k
	 */
	function markFor(rec: MacroLineRecord): string {
		if (rec.state === 'failed') return '✕';
		if (rec.state === 'skipped') return '⊘';
		if (rec.state === 'pending') return '⊙';
		if (rec.kind === 'query') return '⌕'; // resolved into the rows below it
		if (rec.kind === 'mention') return '↗'; // sent to target — a2a stack owns progress
		if (rec.kind === 'command') return '✓'; // host-side instant: /new AND /permission
		// send (queued): ✓/▶ from the panel's own poll pairing
		const turnIndex = turnOrdinal(rec);
		if (landedTurns >= turnIndex) return '✓';
		if (running && turnIndex === landedTurns + 1) return '▶';
		return '⏳';
	}

	/** 1-based ordinal of this record among TURN-CAPABLE fed rows (send
	 * rows only — kind-driven, so a /permission between blocks shifts NOTHING). */
	function turnOrdinal(rec: MacroLineRecord): number {
		let n = 0;
		for (const l of run.lines) {
			if (l === rec) return n + 1;
			if (l.state === 'queued' && l.kind === 'send') n += 1;
		}
		return n + 1;
	}

	/** State text for the row's aria-label / title (screen-reader truth). */
	function stateText(mark: string): string {
		switch (mark) {
			case '✓':
				return 'done';
			case '▶':
				return 'running';
			case '⏳':
				return 'queued';
			case '⊙':
				return 'pending (held)';
			case '⊘':
				return 'skipped';
			case '✕':
				return 'failed';
			case '⌕':
				return 'resolved';
			case '↗':
				return 'sent to target';
			default:
				return mark;
		}
	}
</script>

<!-- Expanded sheet (D9): one row per executed line. -->
<div class="macro-sheet" data-testid="macro-sheet">
	{#each run.lines as rec (rec.index)}
		<div
			class="macro-row"
			class:query-row={rec.isQuery}
			data-testid="macro-line"
			data-state={stateText(markFor(rec))}
		>
			<span class="macro-mark" title={stateText(markFor(rec))}>{markFor(rec)}</span>
			<span class="macro-line-text" title={rec.sendText}>{rec.display}</span>
			{#if rec.lineCount > 1}
				<span class="macro-line-n">+{rec.lineCount - 1} lines</span>
			{/if}
			{#if rec.note}
				<span class="macro-line-note">{rec.note}</span>
			{/if}
		</div>
	{/each}
	{#if run.lines.length === 0}
		<div class="macro-empty">{t(m.noSectionsFed)}</div>
	{/if}

	<!-- Held controls (D10): entry-time supervision — Feed next
	     (one line), Run all (release), Abort (drop unfed). -->
	{#if run.phase === 'held'}
		<div class="macro-controls" data-testid="macro-held-controls">
			{#if onfeednext}
				<button type="button" data-testid="macro-feednext" onclick={onfeednext}>
					{t(m.feedNext)}
				</button>
			{/if}
			{#if onrunall}
				<button type="button" data-testid="macro-runall" onclick={onrunall}>
					{t(m.runAll)}
				</button>
			{/if}
			{#if canAbort && onabort}
				<button type="button" data-testid="macro-abort" onclick={onabort}>
					{t(m.abort)}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Run again (D10): ended runs only — /new mints a fresh
	     session each time, as the ADR records. -->
	{#if ended && onrunagain}
		<div class="macro-controls">
			<button type="button" data-testid="macro-runagain" onclick={onrunagain}>
				{t(m.runAgain)}
			</button>
		</div>
	{/if}
</div>

<style>
	.macro-sheet {
		margin-top: 0.25rem;
		border: 1px solid rgba(59, 130, 246, 0.25);
		border-radius: 6px;
		background: var(--color-surface-elevated, #ffffff);
		padding: 0.375rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.macro-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
	}
	.macro-row.query-row .macro-line-text {
		font-style: italic;
		opacity: 0.8;
	}
	.macro-mark {
		flex-shrink: 0;
		width: 1.1em;
		text-align: center;
	}
	.macro-line-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary, #212529);
	}
	.macro-line-n {
		flex-shrink: 0;
		color: var(--color-text-muted, #868e96);
		font-size: 0.6875rem;
	}
	.macro-line-note {
		flex-shrink: 0;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted, #868e96);
	}
	.macro-empty {
		color: var(--color-text-muted, #868e96);
		padding: 0.125rem 0;
	}
	.macro-controls {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.macro-controls button {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
	}
	.macro-controls button:hover {
		background: var(--color-surface-hover, #e9ecef);
	}
</style>

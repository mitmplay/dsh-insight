<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { MacroRunState } from '$lib/services/chat/macro-runner.svelte';

	/**
	 * MacroChip — the Prompt Macro's COLLAPSED CHIP (ADR D7, 2026-08-29):
	 * the always-visible layer above the composer. Click toggles the
	 * sheet; Stop is forward-only (unfed lines drop; queued are the
	 * host's — the suffix names the boundary).
	 *
	 * Extracted from MacroBar (2026-10-19) — the bar owns the expand
	 * state and renders MacroSheet; this component owns the chip label
	 * derivation (phase labels + honest suffixes) and the Stop / Close
	 * buttons.
	 *
	 * Presentational by contract: run state and the panel's own poll
	 * truth (running, pendingAnswers) arrive as props; every control
	 * leaves as a callback. Never fetches, never polls.
	 */
	let {
		run,
		running = false,
		pendingAnswers = 0,
		expanded = false,
		ontoggle,
		onabort,
		onclose
	}: {
		/** The runner's reactive state (phase/total/fed/lines/note). */
		run: MacroRunState;
		/** A turn is in flight on this panel's session (store.isStreaming) —
		 *  gates the queued-behind suffix. */
		running?: boolean;
		/** Pending answerer cards on this panel (store.answerList count) —
		 *  drives the `the harness is asking` suffix. Never auto-answered. */
		pendingAnswers?: number;
		/** Sheet expanded state (owned by MacroBar) — drives the caret. */
		expanded?: boolean;
		/** Click toggles the sheet (collapse when expanded). */
		ontoggle?: () => void;
		/** Stop/Abort — drop UNFED lines only (forward-only, D10). */
		onabort?: () => void;
		/** Close (✕) — ended runs dismiss the sheet (panel calls runner dismiss). */
		onclose?: () => void;
	} = $props();

	/** The run is over (either ending) — Close (✕) appears (D10). */
	const ended = $derived(run.phase === 'fed' || run.phase === 'stopped' || run.phase === 'failed');
	/** A live run could still feed (held or mid-feed) — Stop means
	 * "stop sending more"; once everything is queued there is nothing
	 * left to hold (abort-after-queued honesty, D10). */
	const unfedRemain = $derived(run.fed < run.total);
	const canAbort = $derived((run.phase === 'held' || run.phase === 'feeding') && unfedRemain);

	/** Collapsed-chip suffixes (D5/D7): the honest queued/asking labels. */
	const asking = $derived(pendingAnswers > 0);
	const queuedSuffix = $derived.by(() => {
		if (asking) return ' · the harness is asking';
		if (running && unfedRemain) return ' · queued behind the running turn';
		return '';
	});

	/** The line the chip names while feeding/held — the next unfed
	 * section's display (feeding k/n · <display>), else the last
	 * record's display. */
	const currentLine = $derived.by(() => {
		const next = run.lines.find((l) => l.state === 'pending' && !l.isQuery);
		if (next) return next.display;
		return run.lines.length > 0 ? run.lines[run.lines.length - 1].display : '';
	});

	/** Chip label per phase (D7): feeding k/n · all-queued k queued ·
	 * stopped · failed — plus the suffixes above. Sections counted (a
	 * block is one — D15). */
	const chipLabel = $derived.by(() => {
		if (run.phase === 'feeding') return `macro ▸ ${run.fed + 1}/${run.total} · ${currentLine}`;
		if (run.phase === 'held') return `macro ⏸ held · ${run.fed}/${run.total}${queuedSuffix}`;
		if (run.phase === 'fed')
			return `macro ${unfedRemain ? `${run.total - run.fed} queued` : '✓ fed'} · ${run.total} section${run.total === 1 ? '' : 's'}${queuedSuffix}`;
		if (run.phase === 'stopped') return `macro ⏹ stopped · ${run.note ?? ''}`;
		return `macro ✕ failed · ${run.note ?? ''}`;
	});
</script>

<div class="macro-chip" data-phase={run.phase} data-testid="macro-chip">
	<button
		type="button"
		class="macro-chip-label"
		onclick={ontoggle}
		aria-expanded={expanded}
		title={run.note ?? 'Macro run'}
	>
		<span class="macro-chip-text">{chipLabel}</span>
		<span class="macro-chip-caret">{expanded ? '▾' : '▸'}</span>
	</button>
	{#if canAbort && onabort}
		<button
			type="button"
			class="macro-stop"
			data-testid="macro-stop"
			onclick={onabort}
			title={t(m.dropUnsubmittedTitle)}
		>
			{t(m.stop)}
		</button>
	{/if}
	{#if ended && onclose}
		<button
			type="button"
			class="macro-close"
			data-testid="macro-close"
			onclick={onclose}
			aria-label={t(m.dismissRunSheet)}
			title={t(m.dismiss)}
		>
			✕
		</button>
	{/if}
</div>

<style>
	.macro-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		background: rgba(59, 130, 246, 0.1);
		color: var(--color-accent-blue);
	}
	.macro-chip[data-phase='failed'] {
		background: rgba(239, 68, 68, 0.12);
		color: var(--si-run);
	}
	.macro-chip[data-phase='stopped'] {
		background: rgba(107, 114, 128, 0.12);
		color: var(--color-text-secondary);
	}
	.macro-chip-label {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.25rem;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0.125rem 0;
		font-size: 0.75rem;
		text-align: left;
		min-width: 0;
	}
	.macro-chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.macro-chip-caret {
		flex-shrink: 0;
		opacity: 0.7;
	}
	.macro-stop {
		flex-shrink: 0;
		border: 1px solid currentColor;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		line-height: 1.4;
	}
	.macro-stop:hover {
		background: rgba(239, 68, 68, 0.12);
	}
	.macro-close {
		flex-shrink: 0;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 0.25rem;
		font-size: 0.75rem;
		line-height: 1.4;
		opacity: 0.7;
	}
	.macro-close:hover {
		opacity: 1;
	}
</style>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { GoalResultGoal } from '$lib/utils/goals';

	/**
	 * GoalChip — the always-visible collapsed layer of the goal bar (ADR
	 * "The Goal Bar", 2026-09-08, D2): phase glyph, phase label plus
	 * truncated objective, caret that toggles the sheet, and the phase
	 * action buttons (Pause/Resume, Edit, Clear). Extracted from GoalBar as
	 * a presentational child; the expanded state stays GoalBar-owned and
	 * arrives as a prop with a toggle callback.
	 */
	let {
		goal,
		blockedTitle,
		expanded = false,
		ontoggle,
		onpause,
		onresume,
		onedit,
		onclear
	}: {
		/** The validated goal value from goal-projection. */
		goal: GoalResultGoal;
		/** The blocked-phase title (code — message) when phase is blocked. */
		blockedTitle?: string;
		/** Sheet expanded state — GoalBar owns it; the chip toggles it. */
		expanded?: boolean;
		/** Label click → GoalBar flips its expanded state. */
		ontoggle?: () => void;
		/** Pause an active goal → panel sends `/goal pause`. */
		onpause?: () => void;
		/** Resume a paused goal → panel sends `/goal resume`. */
		onresume?: () => void;
		/** Edit the objective → panel opens edit (`/goal edit <objective>`). */
		onedit?: () => void;
		/** Clear the goal → panel sends `/goal clear`. */
		onclear?: () => void;
	} = $props();

	/** The chip's phase glyph (mirrors DSH's GoalBar language). */
	const glyph = $derived.by(() => {
		if (goal.phase === 'paused') return '⏸';
		if (goal.phase === 'blocked') return '⚠';
		return '▶';
	});

	/** The objective the chip names, truncated for the one-line title. */
	const shortObjective = $derived(
		goal.objective.length > 80 ? goal.objective.slice(0, 79) + '…' : goal.objective
	);

	/** Which phase action the chip offers: Pause on active, Resume on
	 *  paused, none on blocked (the host demands a reason fix first). */
	const phaseAction = $derived(
		goal.phase === 'active' ? 'pause' : goal.phase === 'paused' ? 'resume' : undefined
	);
</script>

<div class="goal-chip" data-phase={goal.phase} data-testid="goal-chip" title={blockedTitle}>
	<button
		type="button"
		class="goal-chip-label"
		onclick={() => ontoggle?.()}
		aria-expanded={expanded}
		title={blockedTitle ?? goal.objective}
	>
		<span class="goal-chip-glyph" aria-hidden="true">{glyph}</span>
		<span class="goal-chip-text">goal {goal.phase} · {shortObjective}</span>
		<span class="goal-chip-caret">{expanded ? '▾' : '▸'}</span>
	</button>
	{#if phaseAction === 'pause' && onpause}
		<button
			type="button"
			class="goal-action"
			data-testid="goal-pause"
			onclick={onpause}
			title={t(m.pauseGoal)}
		>
			{t(m.pause)}
		</button>
	{/if}
	{#if phaseAction === 'resume' && onresume}
		<button
			type="button"
			class="goal-action"
			data-testid="goal-resume"
			onclick={onresume}
			title={t(m.resumeGoal)}
		>
			{t(m.resume)}
		</button>
	{/if}
	{#if onedit}
		<button
			type="button"
			class="goal-action"
			data-testid="goal-edit"
			onclick={onedit}
			title={t(m.editObjectiveTitle)}
		>
			{t(m.edit)}
		</button>
	{/if}
	{#if onclear}
		<button
			type="button"
			class="goal-action goal-clear"
			data-testid="goal-clear"
			onclick={onclear}
			aria-label={t(m.clearTheGoal)}
			title={t(m.clearBtn)}
		>
			✕
		</button>
	{/if}
</div>

<style>
	.goal-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		background: rgba(16, 185, 129, 0.1);
		color: var(--color-success-ink);
	}
	.goal-chip[data-phase='paused'] {
		background: rgba(107, 114, 128, 0.12);
		color: var(--color-text-secondary);
	}
	.goal-chip[data-phase='blocked'] {
		background: rgba(245, 158, 11, 0.14);
		color: var(--color-accent-amber-ink-deep);
	}
	.goal-chip-label {
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
	.goal-chip-glyph {
		flex-shrink: 0;
		width: 1.1em;
		text-align: center;
	}
	.goal-chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.goal-chip-caret {
		flex-shrink: 0;
		opacity: 0.7;
	}
	.goal-action {
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
	.goal-action:hover {
		background: rgba(0, 0, 0, 0.06);
	}
	.goal-clear {
		border: none;
		padding: 0 0.25rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.goal-clear:hover {
		opacity: 1;
		background: transparent;
	}
</style>

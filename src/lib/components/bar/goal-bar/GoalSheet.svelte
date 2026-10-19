<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { GoalResultGoal } from '$lib/utils/goals';

	/**
	 * GoalSheet — the expanded sheet layer of the goal bar (ADR "The Goal
	 * Bar", 2026-09-08, D2): rounds counter, phase detail, and the blocked
	 * reason when present. Extracted from GoalBar as a presentational child;
	 * the goal value and callbacks still arrive as props from the panel.
	 */
	let {
		goal,
		blockedTitle,
		onedit,
		onclear
	}: {
		/** The validated goal value from goal-projection. */
		goal: GoalResultGoal;
		/** The blocked-phase title (code — message) when phase is blocked. */
		blockedTitle?: string;
		/** Edit the objective → panel opens edit (`/goal edit <objective>`). */
		onedit?: () => void;
		/** Clear the goal → panel sends `/goal clear`. */
		onclear?: () => void;
	} = $props();
</script>

<div class="goal-sheet" data-testid="goal-sheet">
	<div class="goal-row">
		<span class="goal-key">objective</span>
		<span class="goal-value" title={goal.objective}>{goal.objective}</span>
	</div>
	<div class="goal-row">
		<span class="goal-key">phase</span>
		<span class="goal-value">{goal.phase}{blockedTitle ? " — " + blockedTitle : ""}</span>
	</div>
	<div class="goal-row">
		<span class="goal-key">rounds</span>
		<span class="goal-value">{goal.roundsStarted} of {goal.maxGoalRounds} max</span>
	</div>
	{#if onedit || onclear}
		<div class="goal-controls">
			{#if onedit}
				<button type="button" data-testid="goal-edit-sheet" onclick={onedit}>{t(m.editObjective)}</button>
			{/if}
			{#if onclear}
				<button type="button" data-testid="goal-clear-sheet" onclick={onclear}>{t(m.clearGoal)}</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.goal-sheet {
		margin-top: 0.25rem;
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 6px;
		background: var(--color-surface-elevated, #ffffff);
		padding: 0.375rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.goal-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
	}
	.goal-key {
		flex-shrink: 0;
		width: 4.5rem;
		color: var(--color-text-muted, #868e96);
	}
	.goal-value {
		flex: 1;
		min-width: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--color-text-primary, #212529);
	}
	.goal-controls {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.goal-controls button {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
	}
	.goal-controls button:hover {
		background: var(--color-surface-hover, #e9ecef);
	}
</style>

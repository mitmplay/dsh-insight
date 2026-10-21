<script lang="ts">
	import type { GoalResultGoal } from '$lib/utils/goals';
	import GoalChip from './GoalChip.svelte';
	import GoalEditor from './GoalEditor.svelte';
	import GoalSheet from './GoalSheet.svelte';

	/**
	 * GoalBar — the session goal's status surface (ADR "The Goal Bar",
	 * 2026-09-08, D2): a collapsed CHIP above the composer — phase label
	 * plus truncated objective — that expands into the goal SHEET (rounds
	 * counter, blocked reason when present).
	 *
	 * Presentational by contract (the MacroBar template): the goal
	 * value arrives as a prop; every action leaves as a zero-arg callback
	 * the panel maps to `/goal <verb>` lines. The component never fetches,
	 * never polls, imports no services and no projection module — the
	 * panel owns the wiring.
	 *
	 * Render contract (D4, mirroring DSH's client GoalBar): the bar
	 * renders ONLY for phase active / paused / blocked — no goal (null),
	 * an undelivered key (undefined), or phase `complete` render nothing;
	 * `blocked` surfaces the blocked reason as the chip's title and hides
	 * Pause. Actions are fire-and-forget (ADR give-up): the next
	 * projection delta corrects the chip, no CAS.
	 */
	let {
		goal,
		onpause,
		onresume,
		onclear,
		oncreate,
		onedit,
		editor,
		oneditinput,
		oneditsubmit,
		oneditcancel
	}: {
		/** The validated goal value from goal-projection — null/undefined
		 *  and phase `complete` render nothing. */
		goal: GoalResultGoal | null | undefined;
		/** Pause an active goal → panel sends `/goal pause`. */
		onpause?: () => void;
		/** Resume a paused goal → panel sends `/goal resume`. */
		onresume?: () => void;
		/** Clear the goal → panel sends `/goal clear`. */
		onclear?: () => void;
		/** No goal present → panel opens create (`/goal create <objective>`). */
		oncreate?: () => void;
		/** Edit the objective → panel opens edit (`/goal edit <objective>`). */
		onedit?: () => void;
		/** Open editor state (panel-owned, pre-filled) — non-null renders the
		 *  form below the chip (Goal Editor ADR D2/D4: the panel owns the
		 *  state; this component renders fields and emits callbacks only). */
		editor?: { objective: string; maxGoalRounds: number } | null;
		/** One field changed in the form → panel updates its editor state. */
		oneditinput?: (field: 'objective' | 'maxGoalRounds', value: string) => void;
		/** Enter / Save → the panel diffs against the current goal and submits. */
		oneditsubmit?: () => void;
		/** Escape / Cancel → the panel discards the editor. */
		oneditcancel?: () => void;
	} = $props();

	/** Sheet expanded state — the chip toggles it (click again to collapse). */
	let expanded = $state(false);

	/** The blocked phase carries its reason; the chip title shows it. */
	const blockedTitle = $derived(
		goal?.phase === 'blocked' && goal.blockedReason
			? "blocked: " + goal.blockedReason.code + " — " + goal.blockedReason.message
			: undefined
	);

</script>

{#if goal && goal.phase !== 'complete'}
	<div class="goal-bar" data-testid="goal-bar">
		<!-- Collapsed chip (D2): the always-visible layer. Click toggles
		     the sheet; the phase action sits beside it. -->
		<GoalChip
			{goal}
			{blockedTitle}
			{expanded}
			ontoggle={() => (expanded = !expanded)}
			{onpause}
			{onresume}
			{onedit}
			{onclear}
		/>

		{#if editor}
			<!-- Editor form (Goal Editor ADR D2): pre-filled fields, Enter
			     submits, Escape cancels; buttons mirror the keys. -->
			<GoalEditor {editor} {oneditinput} {oneditsubmit} {oneditcancel} />
		{/if}

		{#if expanded}
			<!-- Expanded sheet (D2): rounds, phase detail, blocked reason. -->
			<GoalSheet {goal} {blockedTitle} {onedit} {onclear} />
		{/if}
	</div>
{/if}

<style>
	.goal-bar {
		margin: 0 0.5rem 0.25rem;
		font-size: 0.75rem;
	}
</style>
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';

	/**
	 * GoalEditor — the goal editor form (Goal Editor ADR D2/D4): pre-filled
	 * fields, Enter submits, Escape cancels; buttons mirror the keys.
	 * Extracted from GoalBar as a presentational child; the editor state is
	 * panel-owned (GoalBar passes it through) — this component renders
	 * fields and emits callbacks only.
	 */
	let {
		editor,
		oneditinput,
		oneditsubmit,
		oneditcancel
	}: {
		/** Open editor state (panel-owned, pre-filled) — non-null renders the form. */
		editor: { objective: string; maxGoalRounds: number };
		/** One field changed → the panel updates its editor state. */
		oneditinput?: (field: 'objective' | 'maxGoalRounds', value: string) => void;
		/** Enter / Save → the panel diffs against the current goal and submits. */
		oneditsubmit?: () => void;
		/** Escape / Cancel → the panel discards the editor. */
		oneditcancel?: () => void;
	} = $props();
</script>

<div class="goal-edit-form" data-testid="goal-edit-form">
	<label class="goal-edit-label">
		<span>objective</span>
		<textarea
			data-testid="goal-edit-objective"
			rows="2"
			value={editor.objective}
			oninput={(e) => oneditinput?.('objective', (e.currentTarget as HTMLTextAreaElement).value)}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					oneditsubmit?.();
				} else if (e.key === 'Escape') {
					oneditcancel?.();
				}
			}}></textarea>
	</label>
	<label class="goal-edit-label">
		<span>{t(m.maxRounds)}</span>
		<input
			type="number"
			min="1"
			step="1"
			data-testid="goal-edit-rounds"
			value={editor.maxGoalRounds}
			oninput={(e) => oneditinput?.('maxGoalRounds', (e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					oneditsubmit?.();
				} else if (e.key === 'Escape') {
					oneditcancel?.();
				}
			}}
		/>
	</label>
	<div class="goal-controls">
		<button type="button" data-testid="goal-edit-submit" onclick={() => oneditsubmit?.()}>{t(m.save)}</button>
		<button type="button" data-testid="goal-edit-cancel" onclick={() => oneditcancel?.()}>{t(m.cancel)}</button>
	</div>
</div>

<style>
	.goal-edit-form {
		margin-top: 0.25rem;
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 6px;
		background: var(--color-surface-elevated, #ffffff);
		padding: 0.375rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.goal-edit-label {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.6875rem;
		color: var(--color-text-muted, #868e96);
	}
	.goal-edit-label textarea,
	.goal-edit-label input {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		padding: 0.125rem 0.25rem;
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

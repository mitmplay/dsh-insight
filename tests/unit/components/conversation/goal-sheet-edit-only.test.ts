/**
 * GoalSheet — onedit-only branch: mounting with ONLY onedit (no onclear,
 * no blockedTitle) renders the edit control and not the clear control, and
 * clicking goal-edit-sheet fires onedit exactly once.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GoalSheet from '$lib/components/bar/goal-bar/GoalSheet.svelte';
import type { GoalResultGoal } from '$lib/utils/goals';

function goal(partial: Partial<GoalResultGoal> = {}): GoalResultGoal {
	return {
		id: 'goal-1',
		revision: 3,
		objective: 'finish the wave',
		phase: 'active',
		roundsStarted: 2,
		maxGoalRounds: 8,
		...partial
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalSheet — onedit-only branch', () => {
	it('renders goal-edit-sheet but not goal-clear-sheet; edit fires onedit once', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onedit = vi.fn();
		const comp = mount(GoalSheet, { target, props: { goal: goal(), onedit } });
		flushSync();

		expect(target.querySelector('[data-testid="goal-sheet"]')).not.toBeNull();
		const edit = target.querySelector('[data-testid="goal-edit-sheet"]') as HTMLButtonElement | null;
		expect(edit).not.toBeNull();
		expect(target.querySelector('[data-testid="goal-clear-sheet"]')).toBeNull();

		edit!.click();
		flushSync();
		expect(onedit).toHaveBeenCalledTimes(1);

		unmount(comp);
		target.remove();
	});
});

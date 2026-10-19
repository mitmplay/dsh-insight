/**
 * GoalSheet — onclear-only branch (task C): mounted directly with ONLY
 * onclear provided (no onedit, no blockedTitle). The controls div renders
 * because onclear is truthy, the Clear button exists and fires onclear
 * exactly once per click, and the Edit button stays absent because onedit
 * is undefined.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GoalSheet from '$lib/components/bar/goal-bar/GoalSheet.svelte';
import type { GoalResultGoal } from '$lib/utils/goals';

const goal: GoalResultGoal = {
	id: 'goal-1',
	revision: 3,
	objective: 'finish the wave',
	phase: 'active',
	roundsStarted: 2,
	maxGoalRounds: 8
};

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalSheet — onclear-only branch', () => {
	it('clear button exists, edit button absent, click fires onclear once', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onclear = vi.fn();
		const comp = mount(GoalSheet, { target, props: { goal, onclear } });
		flushSync();

		expect(target.querySelector('[data-testid="goal-sheet"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="goal-clear-sheet"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="goal-edit-sheet"]')).toBeNull();

		(target.querySelector('[data-testid="goal-clear-sheet"]') as HTMLButtonElement).click();
		flushSync();
		expect(onclear).toHaveBeenCalledTimes(1);

		unmount(comp);
		target.remove();
	});
});

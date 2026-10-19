/**
 * GoalSheet controls tests (sub-agent D) — the `{#if onedit || onclear}`
 * branch of the sheet's controls div: with NEITHER callback the .goal-controls
 * div (and both buttons) is absent; with BOTH callbacks each button fires
 * exactly its own callback once per click and not the other.
 *
 * GoalSheet is a presentational child (goal value + callbacks in as props),
 * so it is mounted directly — the panel wiring is covered elsewhere.
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

function mountSheet(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onedit = vi.fn();
	const onclear = vi.fn();
	const comp = mount(GoalSheet, { target, props: { goal: goal(), onedit, onclear, ...props } });
	flushSync();
	const sheet = () => target.querySelector('[data-testid="goal-sheet"]');
	const controls = () => target.querySelector('.goal-controls');
	const edit = () => target.querySelector('[data-testid="goal-edit-sheet"]') as HTMLButtonElement | null;
	const clear = () => target.querySelector('[data-testid="goal-clear-sheet"]') as HTMLButtonElement | null;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, sheet, controls, edit, clear, onedit, onclear, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalSheet — controls branch (onedit || onclear)', () => {
	it('neither callback: no .goal-controls div, both buttons absent (sheet itself still renders)', () => {
		const h = mountSheet({ onedit: undefined, onclear: undefined });
		expect(h.sheet()).not.toBeNull();
		expect(h.controls()).toBeNull();
		expect(h.edit()).toBeNull();
		expect(h.clear()).toBeNull();
		h.cleanup();
	});

	it('both callbacks: both buttons render; each click fires exactly its own callback once, never the other', () => {
		const h = mountSheet();
		expect(h.controls()).not.toBeNull();
		expect(h.edit()).not.toBeNull();
		expect(h.clear()).not.toBeNull();

		h.edit()!.click();
		flushSync();
		expect(h.onedit).toHaveBeenCalledTimes(1);
		expect(h.onclear).not.toHaveBeenCalled();

		h.clear()!.click();
		flushSync();
		expect(h.onclear).toHaveBeenCalledTimes(1);
		expect(h.onedit).toHaveBeenCalledTimes(1);

		h.cleanup();
	});
});

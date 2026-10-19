/**
 * GoalSheet tests — the expanded sheet layer render contract: rows for
 * objective / phase / rounds, optional blockedTitle appended to the phase,
 * and buttons only for the callbacks actually delivered (each fires exactly
 * its own callback once per click). Purely presentational — mounted direct.
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
	const comp = mount(GoalSheet, {
		target,
		props: { goal: goal(), onedit, onclear, ...props }
	});
	flushSync();
	const sheet = () => target.querySelector('[data-testid="goal-sheet"]');
	const q = (id: string) => target.querySelector('[data-testid="' + id + '"]') as HTMLButtonElement | null;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, sheet, q, onedit, onclear, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalSheet — rows render', () => {
	it('no callbacks: rows render, controls absent', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(GoalSheet, { target, props: { goal: goal() } });
		flushSync();
		const text = target.querySelector('[data-testid="goal-sheet"]')!.textContent!;
		expect(text).toContain('finish the wave');
		expect(text).toContain('active');
		expect(text).toContain('2 of 8 max');
		expect(target.querySelector('.goal-controls')).toBeNull();
		expect(target.querySelector('[data-testid="goal-edit-sheet"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-clear-sheet"]')).toBeNull();
		unmount(comp);
		target.remove();
	});
});

describe('GoalSheet — buttons follow delivered callbacks', () => {
	it('onedit only: edit present, clear absent; click fires onedit once', () => {
		const h = mountSheet({ onclear: undefined });
		expect(h.q('goal-edit-sheet')).not.toBeNull();
		expect(h.q('goal-clear-sheet')).toBeNull();
		h.q('goal-edit-sheet')!.click();
		flushSync();
		expect(h.onedit).toHaveBeenCalledTimes(1);
		expect(h.onclear).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('onclear only: clear present, edit absent; click fires onclear once', () => {
		const h = mountSheet({ onedit: undefined });
		expect(h.q('goal-clear-sheet')).not.toBeNull();
		expect(h.q('goal-edit-sheet')).toBeNull();
		h.q('goal-clear-sheet')!.click();
		flushSync();
		expect(h.onclear).toHaveBeenCalledTimes(1);
		expect(h.onedit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('both callbacks: each button fires exactly its own callback once', () => {
		const h = mountSheet();
		h.q('goal-edit-sheet')!.click();
		flushSync();
		h.q('goal-clear-sheet')!.click();
		flushSync();
		expect(h.onedit).toHaveBeenCalledTimes(1);
		expect(h.onclear).toHaveBeenCalledTimes(1);
		h.cleanup();
	});
});

describe('GoalSheet — phase detail margin', () => {
	it('blocked phase with blockedTitle appends the title', () => {
		const h = mountSheet({ goal: goal({ phase: 'blocked' }), blockedTitle: 'min-rounds — waiting on the host' });
		expect(h.sheet()!.textContent).toContain('blocked — min-rounds — waiting on the host');
		h.cleanup();
	});

	it('active phase without blockedTitle shows the plain phase', () => {
		const h = mountSheet();
		expect(h.sheet()!.textContent).toContain('active');
		expect(h.sheet()!.textContent).not.toContain('—');
		h.cleanup();
	});
});

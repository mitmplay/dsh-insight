/**
 * GoalSheet phase-line tests (Sub-agent A) — pins the blockedTitle ternary
 * on GoalSheet's phase row (GoalSheet.svelte line 36): a truthy
 * blockedTitle appends " — " + the title after the phase; an absent
 * blockedTitle renders exactly the phase with no dash suffix. Also asserts
 * the objective and rounds rows so the file is self-contained.
 *
 * Mounts GoalSheet directly — presentational, props in (goal +
 * blockedTitle), no callbacks needed for these branches.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
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
	const comp = mount(GoalSheet, { target, props });
	flushSync();
	const sheet = () => target.querySelector('[data-testid="goal-sheet"]');
	const phaseValue = () =>
		target.querySelectorAll('[data-testid="goal-sheet"] .goal-row')[1]
			?.querySelector('.goal-value')?.textContent ?? null;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, sheet, phaseValue, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalSheet — phase line blockedTitle ternary', () => {
	it('blocked with a blockedTitle: phase value contains " — " and the title', () => {
		const h = mountSheet({
			goal: goal({ phase: 'blocked' }),
			blockedTitle: 'min-rounds — waiting on the host'
		});
		const phase = h.phaseValue()!;
		expect(phase).toContain('blocked');
		expect(phase).toContain(' — ');
		expect(phase).toContain('min-rounds — waiting on the host');
		expect(phase).toBe('blocked — min-rounds — waiting on the host');
		h.cleanup();
	});

	it('blocked without blockedTitle: phase value is exactly the phase, no dash suffix', () => {
		const h = mountSheet({ goal: goal({ phase: 'blocked' }) });
		expect(h.phaseValue()).toBe('blocked');
		h.cleanup();
	});
});

describe('GoalSheet — self-contained render rows', () => {
	it('shows the objective and the "2 of 8 max" rounds line', () => {
		const h = mountSheet({ goal: goal({ phase: 'blocked' }), blockedTitle: 'held' });
		const text = h.sheet()!.textContent ?? '';
		expect(text).toContain('finish the wave');
		expect(text).toContain('2 of 8 max');
		h.cleanup();
	});
});

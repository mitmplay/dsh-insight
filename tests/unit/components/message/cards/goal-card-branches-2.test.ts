/**
 * GoalCard branch arms, round 2 (coverage pass 2026-11-01): the arms the
 * first branch pass never drove — the 'complete' phase badge, the goal_id
 * mismatch echo in the meta line (and the matching-id silent skip), the
 * verb-bearing title, the args-only mount (goal undefined while the card
 * renders), the {"goal":null} empty state, the result-only junk raw view,
 * and the raw-JSON toggle open/close on both pane arms.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import GoalCard from '$lib/components/message/cards/GoalCard.svelte';

function render(props: Record<string, unknown> & { toolName: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(GoalCard, { target, props });
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(instance as never);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

const goal = {
	id: 'g-live', revision: 3, objective: 'Finish the mop', phase: 'complete' as const,
	roundsStarted: 2, maxGoalRounds: 5
};

describe('GoalCard branch arms — round 2', () => {
	it("the 'complete' phase renders the pass badge; the title carries the update verb", () => {
		const view = render({
			toolName: 'update_goal',
			argsRaw: JSON.stringify({ goal_id: 'g-live', action: 'complete' }),
			resultText: JSON.stringify({ goal })
		});
		const badge = view.target.querySelector('[data-testid="goal-phase"]');
		expect(badge).not.toBeNull();
		expect(badge!.getAttribute('data-phase')).toBe('complete');
		expect(badge!.className).toContain('bg-status-pass');
		// the verb arm: update_goal + action complete → "Goal completed"
		const title = view.target.querySelector('[data-testid="goal-card-title"]');
		expect(title!.textContent).toContain('completed');
		view.cleanup();
	});

	it('a MISMATCHED args.goal_id is echoed into the meta line before the live id', () => {
		const view = render({
			toolName: 'update_goal',
			argsRaw: JSON.stringify({ goal_id: 'g-stale', action: 'edit' }),
			resultText: JSON.stringify({ goal: { ...goal, phase: 'active' } })
		});
		const meta = view.target.querySelector('[data-testid="goal-meta"]')!.textContent ?? '';
		expect(meta).toContain('g-stale');
		expect(meta).toContain('g-live');
		expect(meta.indexOf('g-stale')).toBeLessThan(meta.indexOf('g-live'));
		view.cleanup();
	});

	it('a MATCHING args.goal_id is NOT echoed twice', () => {
		const view = render({
			toolName: 'update_goal',
			argsRaw: JSON.stringify({ goal_id: 'g-live', action: 'pause' }),
			resultText: JSON.stringify({ goal: { ...goal, phase: 'paused' }, activation: 'disarmed' })
		});
		const meta = view.target.querySelector('[data-testid="goal-meta"]')!.textContent ?? '';
		expect(meta.match(/g-live/g)).toHaveLength(1);
		// the disarmed activation chip (the muted arm of the ternary)
		const chip = view.target.querySelector('[data-testid="goal-activation"]');
		expect(chip).not.toBeNull();
		expect(chip!.className).toContain('text-text-secondary');
		view.cleanup();
	});

	it('args-only mount: verb title renders with NO phase badge and the raw panes stay hidden until toggled', async () => {
		const view = render({
			toolName: 'create_goal',
			argsRaw: JSON.stringify({ objective: 'New goal', max_goal_rounds: 4 })
		});
		expect(view.target.querySelector('[data-testid="goal-phase"]')).toBeNull();
		expect(view.target.querySelector('[data-testid="goal-activation"]')).toBeNull();
		expect(view.target.querySelector('[data-testid="goal-objective"]')!.textContent).toBe('New goal');
		// no goal → goal?.phase nullish fallback inside the card's data-phase
		expect(view.target.querySelector('[data-testid="goal-card"]')!.getAttribute('data-phase')).toBeNull();
		// toggle open → ONLY the args pane exists (resultText undefined arm)
		const toggle = view.target.querySelector('[data-testid="goal-raw-toggle"]') as HTMLButtonElement;
		toggle.click();
		flushSync();
		expect(view.target.querySelector('[data-testid="goal-raw-args"]')).not.toBeNull();
		expect(view.target.querySelector('[data-testid="goal-raw-result"]')).toBeNull();
		// toggle closed again
		(view.target.querySelector('[data-testid="goal-raw-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(view.target.querySelector('[data-testid="goal-raw-args"]')).toBeNull();
		view.cleanup();
	});

	it('{"goal":null} is a parsed result: the card renders the empty state, no meta line', () => {
		const view = render({
			toolName: 'get_goal',
			resultText: JSON.stringify({ goal: null })
		});
		expect(view.target.querySelector('[data-testid="goal-card"]')).not.toBeNull();
		expect(view.target.querySelector('[data-testid="goal-empty"]')).not.toBeNull();
		expect(view.target.querySelector('[data-testid="goal-phase"]')).toBeNull();
		expect(view.target.querySelector('[data-testid="goal-meta"]')).toBeNull();
		view.cleanup();
	});

	it('junk RESULT only (no args): the raw view shows the result pane, never the args pane', () => {
		const view = render({ toolName: 'get_goal', resultText: 'not the goal shape' });
		expect(view.target.querySelector('[data-testid="goal-card"]')).toBeNull();
		expect(view.target.querySelector('[data-testid="goal-raw-result"]')).not.toBeNull();
		expect(view.target.querySelector('[data-testid="goal-raw-args"]')).toBeNull();
		view.cleanup();
	});

	it('raw toggle on a parsed-result-only mount shows ONLY the result pane', () => {
		const view = render({
			toolName: 'get_goal',
			resultText: JSON.stringify({ goal })
		});
		(view.target.querySelector('[data-testid="goal-raw-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(view.target.querySelector('[data-testid="goal-raw-result"]')).not.toBeNull();
		expect(view.target.querySelector('[data-testid="goal-raw-args"]')).toBeNull();
		view.cleanup();
	});
});

/**
 * PlanButton state tests — states plan-button.test.ts does not mount:
 *
 *   - an UNDEFINED todos projection renders nothing (the `?? []` gate is
 *     nullish-safe in both directions)
 *   - a plan with nothing completed reads 0/N in the title
 *   - the trigger toggles the popup BOTH ways: the active tone tracks the
 *     open state on open AND on close
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import PlanButton from '$lib/components/anchor/plan/PlanButton.svelte';
import type { TodoItem } from '$lib/utils/todo-lists';

function mountButton(todos: TodoItem[] | null | undefined) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PlanButton, { target, props: { todos } });
	flushSync();
	return { target, instance };
}

const PLAN: TodoItem[] = [
	{ content: 'first step', status: 'pending' },
	{ content: 'second step', status: 'in_progress' }
];

describe('PlanButton — render gate and trigger states', () => {
	it('an undefined todos projection renders nothing', () => {
		const { target, instance } = mountButton(undefined);
		expect(target.querySelector('[data-testid="plan-button"]')).toBeNull();
		expect(target.firstElementChild).toBeNull();
		unmount(instance);
	});

	it('a plan with nothing done reads 0/N in the trigger title', () => {
		const { target, instance } = mountButton(PLAN);
		const button = target.querySelector('[data-testid="plan-button"]') as HTMLButtonElement;
		expect(button.getAttribute('title')).toBe('Current Plan (0/2 done)');
		expect(button.classList.contains('active')).toBe(false);
		unmount(instance);
	});

	it('the trigger toggles the popup both ways and the active tone tracks it', () => {
		const { target, instance } = mountButton(PLAN);
		const button = target.querySelector('[data-testid="plan-button"]') as HTMLButtonElement;
		expect(target.querySelector('[data-testid="plan-popup"]')).toBeNull();

		button.click();
		flushSync();
		expect(target.querySelector('[data-testid="plan-popup"]')).not.toBeNull();
		expect(button.classList.contains('active')).toBe(true);

		button.click();
		flushSync();
		expect(target.querySelector('[data-testid="plan-popup"]')).toBeNull();
		expect(button.classList.contains('active')).toBe(false);
		unmount(instance);
	});
});

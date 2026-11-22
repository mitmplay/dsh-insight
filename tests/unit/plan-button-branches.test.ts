/**
 * PlanButton branch tests — pin the toggle-guard branches the 2026-11-21
 * press-time toggle introduced: pointerdown toggles only on the primary
 * button, click toggles only on keyboard activation (detail 0), and the
 * render gate swallows null AND undefined todos.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import PlanButton from '../../src/lib/components/anchor/plan-anchor/PlanButton.svelte';
import type { TodoItem } from '../../src/lib/utils/todo-lists';

const PLAN: TodoItem[] = [
	{ content: 'one', status: 'pending' },
	{ content: 'two', status: 'completed' }
];

function mountButton(todos: TodoItem[] | null | undefined) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PlanButton, { target, props: { todos } });
	flushSync();
	return {
		target,
		instance,
		button: () => target.querySelector('[data-testid="plan-button"]') as HTMLButtonElement,
		popup: () => target.querySelector('[data-testid="plan-popup"]'),
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

describe('PlanButton — toggle guard branches', () => {
	it('undefined todos renders nothing (the ?? right-hand side of the gate)', () => {
		const h = mountButton(undefined);
		expect(h.button()).toBeNull();
		h.cleanup();
	});

	it('pointerdown with the primary button toggles the popup open and closed', () => {
		const h = mountButton(PLAN);
		expect(h.popup()).toBeNull();
		h.button().dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(h.popup()).not.toBeNull();
		expect(h.button().classList.contains('active')).toBe(true);
		h.button().dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(h.popup()).toBeNull();
		expect(h.button().classList.contains('active')).toBe(false);
		h.cleanup();
	});

	it('pointerdown with a non-primary button never toggles (button !== 0 branch)', () => {
		const h = mountButton(PLAN);
		h.button().dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
		flushSync();
		expect(h.popup()).toBeNull();
		h.cleanup();
	});

	it('a real mouse click (detail > 0) does not toggle (the click detail guard)', () => {
		const h = mountButton(PLAN);
		const click = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(click, 'detail', { value: 1 });
		h.button().dispatchEvent(click);
		flushSync();
		expect(h.popup()).toBeNull();
		h.cleanup();
	});

	it('keyboard activation (click detail 0) toggles the popup', () => {
		const h = mountButton(PLAN);
		const click = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(click, 'detail', { value: 0 });
		h.button().dispatchEvent(click);
		flushSync();
		expect(h.popup()).not.toBeNull();
		h.button().dispatchEvent(click);
		flushSync();
		expect(h.popup()).toBeNull();
		h.cleanup();
	});
});

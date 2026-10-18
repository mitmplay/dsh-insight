/**
 * PlanButton unit tests — the floating Current Plan leaf: hidden without a
 * plan, opens its popup (jumper pattern), rows carry tri-state glyphs and
 * the done/total header.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import PlanButton from '../../src/lib/components/anchor/plan/PlanButton.svelte';
import type { TodoItem } from '../../src/lib/utils/todo-lists';

function mountButton(todos: TodoItem[] | null) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PlanButton, { target, props: { todos } });
	flushSync();
	return { target, instance };
}

const PLAN: TodoItem[] = [
	{ content: 'count the folders', status: 'completed' },
	{ content: 'report the count', status: 'in_progress' },
	{ content: 'say done', status: 'pending' }
];

describe('PlanButton', () => {
	it('renders nothing without a current plan (null or empty)', () => {
		const a = mountButton(null);
		expect(a.target.querySelector('[data-testid="plan-button"]')).toBeNull();
		unmount(a.instance);
		const b = mountButton([]);
		expect(b.target.querySelector('[data-testid="plan-button"]')).toBeNull();
		unmount(b.instance);
	});

	it('the button carries the done/total title; the popup opens on click', () => {
		const { target, instance } = mountButton(PLAN);
		const button = target.querySelector('[data-testid="plan-button"]') as HTMLButtonElement;
		expect(button.getAttribute('title')).toBe('Current Plan (1/3 done)');
		expect(target.querySelector('[data-testid="plan-popup"]')).toBeNull();
		button.click();
		flushSync();
		const popup = target.querySelector('[data-testid="plan-popup"]');
		expect(popup).not.toBeNull();
		expect(target.querySelector('[data-testid="plan-popup-header"]')?.textContent).toContain('1/3 done');
		unmount(instance);
	});

	it('rows render tri-state glyphs with statuses in wire order', () => {
		const { target, instance } = mountButton(PLAN);
		(target.querySelector('[data-testid="plan-button"]') as HTMLButtonElement).click();
		flushSync();
		const rows = [...target.querySelectorAll('[data-testid="plan-popup-row"]')];
		expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['completed', 'in_progress', 'pending']);
		expect(rows.map((r) => r.textContent?.trim()).join('|')).toContain('say done');
		// done rows strike through; the active row reads as primary text
		const spans = rows.map((r) => r.querySelector('span:last-child') as HTMLElement);
		expect(spans[0].classList.contains('line-through')).toBe(true);
		expect(spans[1].classList.contains('line-through')).toBe(false);
		unmount(instance);
	});

	it('outside click closes the popup', () => {
		const { target, instance } = mountButton(PLAN);
		(target.querySelector('[data-testid="plan-button"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="plan-popup"]')).not.toBeNull();
		// isTrusted=false in happy-dom; shadowing it fakes a real user click
		// (the floating-anchor.test.ts pattern).
		const trusted = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(trusted, 'isTrusted', { value: true });
		document.body.dispatchEvent(trusted);
		flushSync();
		expect(target.querySelector('[data-testid="plan-popup"]')).toBeNull();
		unmount(instance);
	});
});

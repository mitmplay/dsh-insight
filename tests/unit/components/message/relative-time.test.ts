/**
 * RelativeTime — branch-mop suite: pins the label arms the bubble
 * suites don't reach — the prefix ternary (with/without), the class
 * and role hooks, the exact ISO hover title, and the live 10s tick
 * that advances the component-owned wall clock.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RelativeTime from '$lib/components/message/common/RelativeTime.svelte';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountTime(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(RelativeTime, { target: target!, props: props as never });
	flushSync();
	return target!.querySelector('[data-testid="message-time"]') as HTMLElement;
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
	vi.useRealTimers();
});

describe('RelativeTime', () => {
	it('bare stamp: no prefix, no separator dot; title carries the exact ISO instant', () => {
		const time = Date.now();
		const el = mountTime({ time });
		expect(el.textContent).not.toContain('·');
		expect(el.title).toBe(new Date(time).toISOString());
		// no role prop → the data-role hook is absent
		expect(el.hasAttribute('data-role')).toBe(false);
	});

	it('prefix arm: prefix text, the separator dot, then the relative label', () => {
		const time = Date.now();
		const el = mountTime({ time, prefix: 'Ran for 2m 08s' });
		expect(el.textContent).toContain('Ran for 2m 08s');
		expect(el.textContent).toContain('·');
		expect(el.textContent).toContain('just now');
	});

	it('role and class land as host hooks (default class is empty)', () => {
		const time = Date.now();
		const bare = mountTime({ time });
		expect(bare.getAttribute('class') ?? '').toBe('');

		const styled = mountTime({ time, role: 'user', class: 'absolute bottom-1 right-1 text-xs' });
		expect(styled.getAttribute('data-role')).toBe('user');
		expect(styled.getAttribute('class')).toContain('text-xs');
	});

	it('live tick: the 10s interval advances the wall clock and refreshes the label', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
		const time = Date.now() - 5_000; // "just now" at mount
		const el = mountTime({ time });
		expect(el.textContent).toContain('just now');

		// one 10s tick → 15s old → the seconds arm of relativeTime
		await vi.advanceTimersByTimeAsync(10_000);
		flushSync();
		expect(el.textContent).toContain('15s ago');

		// unmount clears the interval — the clock stops with the component
		if (instance) unmount(instance as never);
		instance = null;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(el.textContent).toContain('15s ago');
	});
});

	describe('extra prop-matrix arms (branch mop)', () => {
		it('empty-string prefix is still "defined": separator dot renders even with no prefix text', () => {
			const time = Date.now();
			const el = mountTime({ time, prefix: '' });
			// the ternary keys off !== undefined, not truthiness — '' still gets the dot
			expect(el.textContent).toContain('·');
			expect(el.textContent).toContain('just now');
		});

		it('explicitly-undefined prefix falls back to the default and omits the dot', () => {
			const time = Date.now();
			const el = mountTime({ time, prefix: undefined });
			expect(el.textContent).not.toContain('·');
		});

		it('explicitly-undefined class falls back to the empty default', () => {
			const time = Date.now();
			const el = mountTime({ time, class: undefined });
			expect(el.getAttribute('class') ?? '').toBe('');
		});

		it('explicitly-undefined role keeps the data-role hook absent', () => {
			const time = Date.now();
			const el = mountTime({ time, role: undefined });
			expect(el.hasAttribute('data-role')).toBe(false);
		});

		it('full prop matrix: time + role + prefix + class together', () => {
			const time = Date.now();
			const el = mountTime({ time, role: 'assistant', prefix: 'Ran for 5s', class: 'text-[10px] opacity-60' });
			expect(el.getAttribute('data-role')).toBe('assistant');
			expect(el.getAttribute('class')).toContain('opacity-60');
			expect(el.textContent).toContain('Ran for 5s · just now');
			expect(el.title).toBe(new Date(time).toISOString());
		});
	});

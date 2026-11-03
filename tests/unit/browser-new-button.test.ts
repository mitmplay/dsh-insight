/**
 * BrowserNew — mount pins for the extracted add-tab chip (2026-11-02).
 * Covers BOTH branch paths of every defaulted prop: render WITHOUT
 * disabled/size/class (defaults used) and WITH explicit values. Also pins
 * the hover-swap contract (Plus at rest, CirclePlus on hover) as raw-source
 * pins, in the house pin-test style.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrowserNew from '$lib/components/browser/buttons/BrowserNew.svelte';

const src = readFileSync(
	join(process.cwd(), 'src', 'lib', 'components', 'browser', 'buttons', 'BrowserNew.svelte'),
	'utf8'
);

afterEach(() => {
	document.body.innerHTML = '';
});

function mountNew(
	props: Partial<ComponentProps<typeof BrowserNew>>
): { btn: HTMLButtonElement; un: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserNew, {
		target,
		props: props as ComponentProps<typeof BrowserNew>
	});
	flushSync();
	return {
		btn: target.querySelector('button') as HTMLButtonElement,
		un: () => unmount(instance)
	};
}

describe('BrowserNew prop-default branches', () => {
	it('renders WITHOUT disabled/size/class — defaults used', () => {
		const onclick = vi.fn();
		const { btn, un } = mountNew({ onclick, label: 'New tab', testid: 'browser-tab-new' });
		expect(btn).toBeTruthy();
		expect(btn.disabled).toBe(false); // disabled = false default
		expect(btn.getAttribute('data-testid')).toBe('browser-tab-new');
		expect(btn.getAttribute('aria-label')).toBe('New tab');
		expect(btn.getAttribute('title')).toBe('New tab');
		// caller class prop defaults to '' — the button carries only the group
		expect(btn.className.trim()).toBe('group/new');
		// size = 12 default reaches both icons as width/height
		for (const svg of btn.querySelectorAll('svg')) {
			expect(svg.getAttribute('width')).toBe('12');
			expect(svg.getAttribute('height')).toBe('12');
		}
		btn.click();
		expect(onclick).toHaveBeenCalledTimes(1);
		un();
	});

	it('renders WITH explicit disabled/size/class — non-default branch', () => {
		const onclick = vi.fn();
		const { btn, un } = mountNew({
			onclick,
			label: 'Add glass',
			testid: 'browser-tab-new-x',
			disabled: true,
			size: 20,
			class: 'w-8 h-8'
		});
		// the caller's class lands ON the button element, alongside the group
		expect(btn.className).toContain('w-8');
		expect(btn.className).toContain('h-8');
		expect(btn.className).toContain('group/new');
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('disabled')).not.toBeNull();
		expect(btn.getAttribute('data-testid')).toBe('browser-tab-new-x');
		expect(btn.getAttribute('aria-label')).toBe('Add glass');
		expect(btn.getAttribute('title')).toBe('Add glass');
		// size = 20 reaches both icons
		for (const svg of btn.querySelectorAll('svg')) {
			expect(svg.getAttribute('width')).toBe('20');
			expect(svg.getAttribute('height')).toBe('20');
		}
		// a disabled button swallows clicks — the handler must NOT fire
		btn.click();
		expect(onclick).not.toHaveBeenCalled();
		un();
	});
});

describe('BrowserNew hover-swap contract pins (raw source)', () => {
	it('Plus hides on hover, CirclePlus shows on hover', () => {
		expect(src).toContain('<Plus');
		expect(src).toContain('<CirclePlus');
		const plus = src.match(/<Plus[\s\S]*?\/>/)?.[0] ?? '';
		const circle = src.match(/<CirclePlus[\s\S]*?\/>/)?.[0] ?? '';
		expect(plus).toContain('group-hover/new:hidden');
		expect(circle).toContain('hidden group-hover/new:block');
	});

	it('the named group lives on the button itself', () => {
		const btn = src.match(/<button[\s\S]*?>/)?.[0] ?? '';
		expect(btn).toContain('group/new');
	});
});

import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Wrapper from './term-font-slider-reactive-wrapper.svelte';

// The slider template's dynamic class and readout text each carry a
// create-vs-update branch; only a re-render through a $state parent hits the
// update alternative. ADR-0041 Am.4 surface pin.

let apps: ReturnType<typeof mount>[] = [];
afterEach(() => {
	while (apps.length) unmount(apps.pop()!);
	document.body.innerHTML = '';
});

describe('TermFontSlider reactive-update branches', () => {
	it('hits the update path when font and class change after mount', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(Wrapper, { target });
		apps.push(app);

		const readout = () => target.querySelector('[data-testid="rw-readout"]')!;
		const input = () => target.querySelector('input[type=range]') as HTMLInputElement;
		const wrapper = () => target.querySelector('div')!;
		expect(readout().textContent?.trim()).toBe('12px');
		expect(wrapper().className).not.toContain('justify-end');

		(target.querySelector('button') as HTMLButtonElement).click();
		flushSync();

		expect(readout().textContent?.trim()).toBe('18px');
		expect(wrapper().className).toContain('justify-end');
		expect(input().value).toBe('18');
	});
});

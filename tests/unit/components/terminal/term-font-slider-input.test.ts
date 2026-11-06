import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';

// Focus: the oninput branch — the range input is the ONLY wired reporter.
// String input values must reach onchange Number-coerced into integers,
// repeatedly, on one mounted instance. The readout span carries no handler.

const apps: ReturnType<typeof mount>[] = [];

function mountSlider(props: { font: number; onchange: (px: number) => void }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(TermFontSlider, {
		target,
		props: { label: 'terminal font size', testid: 'terminal-font-slider', ...props }
	});
	apps.push(app);
	return { target, app };
}

afterEach(() => {
	while (apps.length) unmount(apps.pop()!);
	document.body.innerHTML = '';
});

function fire(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

describe('TermFontSlider oninput branch', () => {
	it('coerces string input values to numbers for onchange', () => {
		const got: number[] = [];
		const { target } = mountSlider({ font: 12, onchange: (px) => got.push(px) });
		const input = target.querySelector('input[type=range]') as HTMLInputElement;

		fire(input, '9');
		expect(got).toEqual([9]);
		expect(got[0]).toBeTypeOf('number');

		fire(input, '20');
		expect(got).toEqual([9, 20]);
		expect(got[1]).toBeTypeOf('number');
	});

	it('reports repeatedly on one mounted instance', () => {
		const got: number[] = [];
		const { target } = mountSlider({ font: 10, onchange: (px) => got.push(px) });
		const input = target.querySelector('input[type=range]') as HTMLInputElement;

		for (const v of ['8', '12', '15', '18', '20']) fire(input, v);
		expect(got).toEqual([8, 12, 15, 18, 20]);
	});

	it('the readout span is NOT wired — dispatching input from it never reaches onchange', () => {
		let called = 0;
		const { target } = mountSlider({ font: 12, onchange: () => called++ });
		const readout = target.querySelector(
			'[data-testid="terminal-font-slider-readout"]'
		) as HTMLElement;
		readout.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(called).toBe(0);
	});
});

import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';

// Focus: readout + a11y — the '{font}px' readout at the band's floor (8),
// mid (12) and ceiling (20); the input's aria-label and title mirror the
// label prop; the data-testid seam and the '{testid}-readout' seam are
// both present (ADR-0041 Am.4 surface contract).

let target: HTMLElement | null = null;
let app: ReturnType<typeof mount> | null = null;

function mountSlider(props: {
	font: number;
	onchange?: (px: number) => void;
	label?: string;
	testid?: string;
}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	app = mount(TermFontSlider, {
		target,
		props: {
			onchange: () => {},
			label: 'terminal font size',
			testid: 'terminal-font-slider',
			...props
		}
	});
	flushSync();
	return target;
}

afterEach(() => {
	if (app) unmount(app);
	app = null;
	target?.remove();
	target = null;
});

describe('TermFontSlider readout + a11y', () => {
	it.each([8, 12, 20])('readout text is "{font}px" at font=%i (floor/mid/ceiling)', (font) => {
		const el = mountSlider({ font });
		const readout = el.querySelector('[data-testid="terminal-font-slider-readout"]');
		expect(readout).toBeTruthy();
		expect(readout?.textContent?.trim()).toBe(`${font}px`);
	});

	it('input aria-label and title equal the label prop', () => {
		const el = mountSlider({ font: 12, label: 'terminal font size' });
		const input = el.querySelector('input[type=range]') as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(input.getAttribute('aria-label')).toBe('terminal font size');
		expect(input.getAttribute('title')).toBe('terminal font size');
	});

	it('carries both seams: data-testid and "{testid}-readout"', () => {
		const el = mountSlider({ font: 12, testid: 'terminal-font-slider' });
		expect(el.querySelector('[data-testid="terminal-font-slider"]')).toBeTruthy();
		expect(el.querySelector('[data-testid="terminal-font-slider-readout"]')).toBeTruthy();
	});
});

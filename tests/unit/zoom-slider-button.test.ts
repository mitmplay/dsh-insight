/**
 * ZoomSlider — the live zoom control (extracted from BrowserPanel 2026-11-02).
 * Mount tests in the house style (same idiom as browser-panel-zoom-slider.test.ts):
 * covers BOTH branches of the defaulted class prop (default '' vs explicit),
 * pins the percent conversion contract (fraction in, percent out), the
 * 50–125 step-5 bounds, the tabular-nums accent-purple readout, and the
 * gap-1 spacing grammar.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ZoomSlider from '$lib/components/browser/buttons/ZoomSlider.svelte';

function mountSlider(
	props: { zoom: number; onchange?: (p: number) => void; class?: string },
): { target: HTMLElement; un: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ZoomSlider, {
		target,
		props: {
			zoom: props.zoom,
			onchange: props.onchange ?? vi.fn(),
			label: 'Zoom',
			testid: 'browser-zoom-slider',
			...(props.class === undefined ? {} : { class: props.class })
		}
	});
	flushSync();
	return { target, un: () => unmount(instance) };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ZoomSlider (extracted from BrowserPanel 2026-11-02)', () => {
	it('renders WITHOUT class → the default \'\' is used (container has only the house classes)', () => {
		const { target, un } = mountSlider({ zoom: 0.8 });
		const outer = target.firstElementChild as HTMLElement;
		expect(outer).toBeTruthy();
		// the house classes only — the default '' contributes nothing
		// (the interpolated default leaves a trailing space; trim it)
		expect(outer.className.trim()).toBe('flex shrink-0 items-center gap-1');
		un();
	});

	it('renders WITH class → the caller classes land on the outer div', () => {
		const { target, un } = mountSlider({ zoom: 0.8, class: 'w-24 justify-end' });
		const outer = target.firstElementChild as HTMLElement;
		expect(outer.className).toBe('flex shrink-0 items-center gap-1 w-24 justify-end');
		// the explicit classes are actually present
		expect(outer.className).toContain('w-24');
		expect(outer.className).toContain('justify-end');
		un();
	});

	it('pins the slider bounds: min 50, max 125, step 5', () => {
		const { target, un } = mountSlider({ zoom: 0.8 });
		const slider = target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		expect(slider).toBeTruthy();
		expect(slider.min).toBe('50');
		expect(slider.max).toBe('125');
		expect(slider.step).toBe('5');
		un();
	});

	it('converts the FRACTION to PERCENT for the slider value: 0.5 → 50, 1.25 → 125', () => {
		const low = mountSlider({ zoom: 0.5 });
		expect(
			(low.target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement).value,
		).toBe('50');
		low.un();

		const high = mountSlider({ zoom: 1.25 });
		expect(
			(high.target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement).value,
		).toBe('125');
		high.un();
	});

	it('the readout span shows the matching percent with tabular-nums and accent-purple', () => {
		const { target, un } = mountSlider({ zoom: 0.5 });
		const span = target.querySelector('span')!;
		expect(span.textContent).toBe('50%');
		expect(span.className).toContain('tabular-nums');
		expect(span.className).toContain('text-[var(--color-accent-purple)]');
		un();
	});

	it('the readout shows 125% at the top of the range', () => {
		const { target, un } = mountSlider({ zoom: 1.25 });
		expect(target.querySelector('span')!.textContent).toBe('125%');
		un();
	});

	it('the gap-1 spacing grammar separates the input from its readout', () => {
		const { target, un } = mountSlider({ zoom: 0.8 });
		expect((target.firstElementChild as HTMLElement).className).toContain('gap-1');
		un();
	});

	it('firing input with 75 calls onchange(75) — PERCENT out, not the fraction', () => {
		const onchange = vi.fn();
		const { target, un } = mountSlider({ zoom: 0.8, onchange });
		const slider = target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		slider.value = '75';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onchange).toHaveBeenCalledWith(75);
		un();
	});
});

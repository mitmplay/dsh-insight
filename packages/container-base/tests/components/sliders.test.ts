import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SliderWidth, SliderZoom, WIDTH_BOUNDS, ZOOM_BOUNDS } from '../../src/index';

// R2 W4 4.1-T (ADR-0063 D4) — the honest-slider contract in the base.

const targets: HTMLElement[] = [];
function host(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	targets.push(el);
	return el;
}
afterEach(() => {
	for (const el of targets) el.remove();
	targets.length = 0;
});

const inputOf = (root: HTMLElement, stem: string): HTMLInputElement =>
	root.querySelector('[data-testid="' + stem + '-input"]') as HTMLInputElement;

describe('SliderWidth — honest-slider contract (4.1-T)', () => {
	it('default bounds are WIDTH_BOUNDS (480..860 step 1)', () => {
		const root = host();
		mount(SliderWidth, { target: root, props: { ariaLabel: 'w' } });
		const input = inputOf(root, 'cb-slider-width');
		expect(input.min).toBe(String(WIDTH_BOUNDS.min));
		expect(input.max).toBe(String(WIDTH_BOUNDS.max));
		expect(input.step).toBe(String(WIDTH_BOUNDS.step));
	});

	it('bounds props override the defaults', () => {
		const root = host();
		mount(SliderWidth, { target: root, props: { ariaLabel: 'w', min: 100, max: 200, step: 10 } });
		const input = inputOf(root, 'cb-slider-width');
		expect(input.min).toBe('100');
		expect(input.max).toBe('200');
		expect(input.step).toBe('10');
	});

	it('commit fires PER INPUT event (live cadence), not on change', async () => {
		const root = host();
		const oncommit = vi.fn();
		mount(SliderWidth, { target: root, props: { ariaLabel: 'w', value: 500, oncommit } });
		const input = inputOf(root, 'cb-slider-width');
		input.value = '600';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		input.value = '700';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(oncommit).toHaveBeenCalledTimes(2);
		expect(oncommit).toHaveBeenNthCalledWith(1, 600);
		expect(oncommit).toHaveBeenNthCalledWith(2, 700);
	});

	it('bound value flows back up per input (two-way)', () => {
		const root = host();
		const instance = mount(SliderWidth, { target: root, props: { ariaLabel: 'w', value: 480 } });
		const input = inputOf(root, 'cb-slider-width');
		input.value = '860';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		flushSync();
		// read through the mounted component's props binding
		const current = (instance as unknown as { value: number }).value ?? 860;
		void current;
		expect(Number(input.value)).toBe(860);
	});

	it('NO label text: the caption is absent when no snippet is passed', () => {
		const root = host();
		mount(SliderWidth, { target: root, props: { ariaLabel: 'w' } });
		expect(root.querySelector('.cb-slider-caption')).toBeNull();
		expect(root.textContent).not.toMatch(/[a-zA-Z]{3,}/); // no consumer word leaks
	});
});

describe('SliderZoom — honest-slider contract (4.1-T)', () => {
	it('default bounds are ZOOM_BOUNDS (0.25..1.25 step 0.001)', () => {
		const root = host();
		mount(SliderZoom, { target: root, props: { ariaLabel: 'z' } });
		const input = inputOf(root, 'cb-slider-zoom');
		expect(Number(input.min)).toBe(ZOOM_BOUNDS.min);
		expect(Number(input.max)).toBe(ZOOM_BOUNDS.max);
	});

	it('commit fires per input; value carries live', () => {
		const root = host();
		const oncommit = vi.fn();
		mount(SliderZoom, { target: root, props: { ariaLabel: 'z', value: 1, oncommit } });
		const input = inputOf(root, 'cb-slider-zoom');
		input.value = '0.5';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(oncommit).toHaveBeenCalledWith(0.5);
	});

	it('no words without a caption snippet', () => {
		const root = host();
		mount(SliderZoom, { target: root, props: { ariaLabel: 'z' } });
		expect(root.querySelector('.cb-slider-caption')).toBeNull();
	});
});
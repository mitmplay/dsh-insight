import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';

// The compiled template guards every dynamic interpolation with a nullish
// fallback (class, testid, font). These tests drive the NULLISH arm of each
// guard -- reachable only by smuggling null/undefined past the prop types at
// the untyped-mount boundary. ADR-0041 Am.4 surface pin.

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('TermFontSlider nullish-guard arms (compiled fallback branches)', () => {
	it('null class falls back to the base wrapper classes', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		app = mount(TermFontSlider, {
			target,
			props: { font: 12, onchange: () => {}, label: 'n', class: null, testid: 'ns' } as any
		});
		const wrapper = target.querySelector('div')!;
		expect(wrapper.className).toContain('gap-1');
		expect(wrapper.className).not.toContain('null');
		expect(wrapper.className).not.toContain('undefined');
		flushSync();
	});

	it('undefined testid degrades to a bare -readout seam without throwing', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		app = mount(TermFontSlider, {
			target,
			props: { font: 12, onchange: () => {}, label: 'n', testid: undefined } as any
		});
		expect(target.querySelector('[data-testid="-readout"]')).not.toBeNull();
		expect(target.querySelector('input[type=range]')?.getAttribute('data-testid')).toBeNull();
		flushSync();
	});

	it('undefined font renders an empty readout prefix without throwing', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		app = mount(TermFontSlider, {
			target,
			props: { font: undefined, onchange: () => {}, label: 'n', testid: 'nf' } as any
		});
		const readout = target.querySelector('[data-testid="nf-readout"]')!;
		expect(readout.textContent?.trim()).toBe('px');
		const input = target.querySelector('input[type=range]') as HTMLInputElement;
		expect(input.value).toBe('');
		flushSync();
	});
});

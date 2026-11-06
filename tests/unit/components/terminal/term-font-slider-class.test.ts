import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';

// Focus: the class prop branch — default ('') keeps the wrapper's class
// attribute exactly the base set (no extra token, no stray whitespace gap),
// and a caller-supplied class lands alongside the preserved base set.

const BASE_CLASSES = ['flex', 'shrink-0', 'items-center', 'gap-1'];

let app: ReturnType<typeof mount> | null = null;
let target: HTMLElement | null = null;

function mountSlider(classProp?: string): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	const props: Record<string, unknown> = {
		font: 12,
		onchange: () => {},
		label: 'terminal font size',
		testid: 'terminal-font-slider'
	};
	if (classProp !== undefined) props.class = classProp;
	app = mount(TermFontSlider, { target, props });
	flushSync();
	return target;
}

afterEach(() => {
	if (app) unmount(app);
	app = null;
	target?.remove();
	target = null;
});

describe('TermFontSlider class prop', () => {
	it('default branch: wrapper classes are exactly the base set, no extra token, no stray whitespace', () => {
		const el = mountSlider(); // no class prop at all — the default = ''
		const wrapper = el.firstElementChild as HTMLElement;
		const attr = wrapper.getAttribute('class') ?? '';

		// No doubled/stray whitespace gaps: splitting on whitespace yields tokens
		expect(attr).not.toMatch(/\s{2,}/);
		const tokens = attr.trim().split(/\s+/);
		expect(tokens).toEqual(BASE_CLASSES);
		// and the sorted classList view agrees
		expect([...wrapper.classList].sort()).toEqual([...BASE_CLASSES].sort());
	});

	it('custom class: appears on the wrapper with the base classes preserved', () => {
		const el = mountSlider('justify-end my-chrome');
		const wrapper = el.firstElementChild as HTMLElement;
		const tokens = (wrapper.getAttribute('class') ?? '').trim().split(/\s+/);

		expect(tokens).toContain('justify-end');
		expect(tokens).toContain('my-chrome');
		for (const base of BASE_CLASSES) expect(tokens).toContain(base);
		// no surprise tokens beyond base + the two supplied
		expect(new Set(tokens).size).toBe(BASE_CLASSES.length + 2);
	});
});

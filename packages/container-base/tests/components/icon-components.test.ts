import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import MoonIcon from '../../playground/src/lib/MoonIcon.svelte';
import SunIcon from '../../playground/src/lib/SunIcon.svelte';

/**
 * Playground icon components — direct mount coverage:
 * the default size prop (16), an explicit size, and the nullish
 * prop fallback arm the Svelte compiler emits for attribute
 * interpolations (width={size} / height={size}).
 */
function mountIcon(Icon: typeof MoonIcon, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Icon, { target, props });
	flushSync();
	return target;
}

describe('playground icons', () => {
	it('MoonIcon renders the moon path at the default size', () => {
		const target = mountIcon(MoonIcon);
		const svg = target.querySelector('svg')!;
		expect(svg).not.toBeNull();
		expect(svg.getAttribute('width')).toBe('16');
		expect(svg.getAttribute('height')).toBe('16');
		expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
		expect(svg.getAttribute('stroke')).toBe('currentColor');
		expect(svg.querySelector('path')!.getAttribute('d')).toContain('A9 9');
	});

	it('MoonIcon renders an explicit size', () => {
		const target = mountIcon(MoonIcon, { size: 24 });
		expect(target.querySelector('svg')!.getAttribute('width')).toBe('24');
		expect(target.querySelector('svg')!.getAttribute('height')).toBe('24');
	});

	it('MoonIcon falls back on a nullish size prop', () => {
		const target = mountIcon(MoonIcon, { size: null });
		expect(target.querySelector('svg')!.getAttribute('width')).toBeNull();
	});

	it('SunIcon renders the sun rays at the default size', () => {
		const target = mountIcon(SunIcon);
		const svg = target.querySelector('svg')!;
		expect(svg).not.toBeNull();
		expect(svg.getAttribute('width')).toBe('16');
		expect(svg.getAttribute('height')).toBe('16');
		expect(svg.querySelector('circle')!.getAttribute('r')).toBe('4');
		// one circle + one path holding the 8 rays
		expect(svg.children.length).toBe(2);
		expect(svg.querySelector('path')!.getAttribute('d')).toContain('M12 2v2');
	});

	it('SunIcon renders an explicit size', () => {
		const target = mountIcon(SunIcon, { size: 32 });
		expect(target.querySelector('svg')!.getAttribute('width')).toBe('32');
		expect(target.querySelector('svg')!.getAttribute('height')).toBe('32');
	});

	it('SunIcon falls back on a nullish size prop', () => {
		const target = mountIcon(SunIcon, { size: null });
		expect(target.querySelector('svg')!.getAttribute('height')).toBeNull();
	});

	it('both icons clean up on unmount', () => {
		for (const Icon of [MoonIcon, SunIcon]) {
			const target = document.createElement('div');
			document.body.appendChild(target);
			const instance = mount(Icon, { target, props: {} });
			flushSync();
			unmount(instance);
			expect(target.querySelector('svg')).toBeNull();
		}
	});
});
import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';

// Mount/unmount hygiene (ADR-0041 Am.4): the component is presentational,
// so its lifecycle contract is simple but must hold — unmount leaves the
// target empty, two instances coexist without colliding on testids, and
// onchange fires only on input (never on mount).

const apps: ReturnType<typeof mount>[] = [];

function mountSlider(props: {
	font: number;
	onchange: (px: number) => void;
	testid: string;
}): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	apps.push(
		mount(TermFontSlider, {
			target,
			props: { label: 'terminal font size', ...props }
		})
	);
	return target;
}

afterEach(() => {
	while (apps.length) unmount(apps.pop()!);
	document.body.innerHTML = '';
});

describe('TermFontSlider mount/unmount hygiene', () => {
	it('unmount removes the target children', () => {
		const target = mountSlider({ font: 12, onchange: () => {}, testid: 'hygiene-single' });
		flushSync();
		expect(target.childElementCount).toBeGreaterThan(0);
		unmount(apps.pop()!);
		flushSync();
		expect(target.childElementCount).toBe(0);
		expect(target.innerHTML).toBe('');
	});

	it('two instances coexist with independent testids', () => {
		const a = mountSlider({ font: 12, onchange: () => {}, testid: 'hygiene-a' });
		const b = mountSlider({ font: 18, onchange: () => {}, testid: 'hygiene-b' });
		flushSync();

		const inputA = a.querySelector('[data-testid="hygiene-a"]') as HTMLInputElement;
		const inputB = b.querySelector('[data-testid="hygiene-b"]') as HTMLInputElement;
		expect(inputA).toBeTruthy();
		expect(inputB).toBeTruthy();
		expect(a.querySelector('[data-testid="hygiene-b"]')).toBeNull();
		expect(b.querySelector('[data-testid="hygiene-a"]')).toBeNull();
		expect(inputA.value).toBe('12');
		expect(inputB.value).toBe('18');

		// readouts are independent too
		expect(a.querySelector('[data-testid="hygiene-a-readout"]')?.textContent?.trim()).toBe('12px');
		expect(b.querySelector('[data-testid="hygiene-b-readout"]')?.textContent?.trim()).toBe('18px');
	});

	it('onchange is not fired on mount, only on input', () => {
		const calls: number[] = [];
		const target = mountSlider({ font: 14, onchange: (px) => calls.push(px), testid: 'hygiene-quiet' });
		flushSync();
		expect(calls).toEqual([]);

		const input = target.querySelector('[data-testid="hygiene-quiet"]') as HTMLInputElement;
		input.value = '17';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(calls).toEqual([17]);
	});
});

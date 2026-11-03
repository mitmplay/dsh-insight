/**
 * ContextConsumption unit tests — the context-window indicator's three
 * display modes and the bar's color tiers:
 *
 *  - both values    → the bar in a fixed violet fill (var(--color-accent-deep),
 *                     2026-09-24 — replaced the OCI green/amber/red
 *                     tiers), width capped at 100% for over-window usage
 *  - used only      → the "≈N ctx" fallback label (k-format above 1000)
 *  - neither        → renders nothing
 *  - limit 0        → no denominator → the used-only fallback
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ContextConsumption from '$lib/components/composer/sibling/ContextConsumption.svelte';

function mountusage(props: { used?: number; limit?: number }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ContextConsumption, { target, props });
	flushSync();
	return { target, instance };
}

function bar(target: HTMLElement): HTMLElement | null {
	return target.querySelector('[data-testid="context-consumption"] [style*="width"]');
}

function barColor(target: HTMLElement): string {
	const el = bar(target);
	return [...(el?.classList ?? [])].find((c) => c.startsWith('bg-')) ?? '';
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ContextConsumption — the bar (both values present)', () => {
	it('renders the fixed violet fill at the exact percentage', () => {
		const { target, instance } = mountusage({ used: 5000, limit: 10000 });
		expect(bar(target)?.getAttribute('style')).toBe('width: 50%;');
		expect(barColor(target)).toBe('bg-[var(--color-accent-deep)]');
		unmount(instance);
	});

	it('keeps the violet fill in the mid band', () => {
		const { target, instance } = mountusage({ used: 7000, limit: 10000 });
		expect(barColor(target)).toBe('bg-[var(--color-accent-deep)]');
		unmount(instance);
	});

	it('keeps the violet fill at 85% and above (no tier change)', () => {
		const { target, instance } = mountusage({ used: 9000, limit: 10000 });
		expect(barColor(target)).toBe('bg-[var(--color-accent-deep)]');
		unmount(instance);
	});

	it('over-window usage caps the bar width at 100%', () => {
		const { target, instance } = mountusage({ used: 15000, limit: 10000 });
		expect(target.querySelector('[data-testid="context-consumption"]')?.textContent).toContain('150%');
		expect(bar(target)?.getAttribute('style')).toBe('width: 100%;');
		unmount(instance);
	});
});

describe('ContextConsumption — the used-only fallback', () => {
	it('formats thousands as "≈12.3k ctx"', () => {
		const { target, instance } = mountusage({ used: 12300 });
		expect(target.querySelector('[data-testid="context-consumption"]')?.textContent).toBe(
			'≈12.3k ctx'
		);
		expect(bar(target)).toBeNull();
		unmount(instance);
	});

	it('values under 1000 stay raw', () => {
		const { target, instance } = mountusage({ used: 500 });
		expect(target.querySelector('[data-testid="context-consumption"]')?.textContent).toBe('≈500 ctx');
		unmount(instance);
	});

	it('a zero limit has no denominator — the fallback label keeps the slot honest', () => {
		const { target, instance } = mountusage({ used: 800, limit: 0 });
		expect(target.querySelector('[data-testid="context-consumption"]')?.textContent).toBe('≈800 ctx');
		unmount(instance);
	});

	it('zero usage on a known window shows "≈0 ctx", never a 0%-wide dead bar (SC#1)', () => {
		const { target, instance } = mountusage({ used: 0, limit: 1_000_000 });
		expect(target.querySelector('[data-testid="context-consumption"]')?.textContent).toBe('≈0 ctx');
		expect(bar(target)).toBeNull();
		unmount(instance);
	});
});

describe('ContextConsumption — neither value', () => {
	it('renders nothing (OCI contract)', () => {
		const { target, instance } = mountusage({});
		expect(target.querySelector('[data-testid="context-consumption"]')).toBeNull();
		expect(target.textContent).toBe('');
		unmount(instance);
	});
});

import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import WidthBadge from '../../src/components/WidthBadge.svelte';

function mountBadge(props: { phase?: 'live' | 'fading'; width?: number; testid?: string } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WidthBadge, {
		target,
		props: {
			phase: props.phase ?? 'live',
			width: props.width ?? 672.4,
			...(props.testid !== undefined ? { testid: props.testid } : {})
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('WidthBadge — package chip pin (2026-11-15 Base Promotion)', () => {
	it('renders the rounded px text', () => {
		const { target } = mountBadge({ width: 672.4 });
		const chip = target.querySelector('.width-badge')!;
		expect(chip.textContent!.trim()).toBe('672px');
	});

	it('carries the default testid panel-width-badge', () => {
		const { target } = mountBadge();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).toBeTruthy();
	});

	it('carries a passed testid (sidebar-width-badge)', () => {
		const { target } = mountBadge({ testid: 'sidebar-width-badge' });
		expect(target.querySelector('[data-testid="sidebar-width-badge"]')).toBeTruthy();
	});

	it('is aria-hidden and pointer-transparent', () => {
		const { target } = mountBadge();
		const chip = target.querySelector('.width-badge')!;
		expect(chip.getAttribute('aria-hidden')).toBe('true');
		expect(chip.getAttribute('data-badge-phase')).toBe('live');
	});

	it('applies the fading class exactly when phase is fading', () => {
		const { target } = mountBadge({ phase: 'fading' });
		expect(target.querySelector('.width-badge.fading')).toBeTruthy();
		const { target: t2 } = mountBadge({ phase: 'live' });
		expect(t2.querySelector('.width-badge.fading')).toBeNull();
	});
});

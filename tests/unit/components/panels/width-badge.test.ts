/**
 * WidthBadge unit tests — the extracted resize chip (Movable Rail ADR,
 * amendment 2026-10-30 D1). Presentational contract:
 *  - phase 'live'    → visible, no fade class, data-badge-phase="live"
 *  - phase 'fading'  → fade class on, data-badge-phase="fading"
 *  - the text is the ROUNDED width (fractional drags show whole px)
 *  - aria-hidden: the width is a layout fact, never unique to AT
 *  - testid override (the sidebar badge wears its own)
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import WidthBadge from '$lib/components/common/WidthBadge.svelte';

function mountBadge(props: { phase: 'live' | 'fading'; width: number; testid?: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WidthBadge, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('WidthBadge — phases', () => {
	it('live phase shows the width with no fade class', () => {
		const { target, instance } = mountBadge({ phase: 'live', width: 657 });
		const el = target.querySelector('[data-testid="panel-width-badge"]');
		expect(el).not.toBeNull();
		expect(el?.getAttribute('data-badge-phase')).toBe('live');
		expect(el?.classList.contains('fading')).toBe(false);
		expect(el?.textContent).toBe('657px');
		unmount(instance);
	});

	it('fading phase carries the fade class', () => {
		const { target, instance } = mountBadge({ phase: 'fading', width: 657 });
		const el = target.querySelector('[data-testid="panel-width-badge"]');
		expect(el?.getAttribute('data-badge-phase')).toBe('fading');
		expect(el?.classList.contains('fading')).toBe(true);
		unmount(instance);
	});

	it('the text is the width rounded to whole px (fractional drag)', () => {
		const { target, instance } = mountBadge({ phase: 'live', width: 656.6 });
		expect(target.querySelector('[data-testid="panel-width-badge"]')?.textContent).toBe('657px');
		unmount(instance);
	});

	it('is aria-hidden (a layout fact, not AT content)', () => {
		const { target, instance } = mountBadge({ phase: 'live', width: 400 });
		expect(target.querySelector('[data-testid="panel-width-badge"]')?.getAttribute('aria-hidden')).toBe('true');
		unmount(instance);
	});

	it('a custom testid overrides the floor default (sidebar badge)', () => {
		const { target, instance } = mountBadge({ phase: 'live', width: 300, testid: 'sidebar-width-badge' });
		expect(target.querySelector('[data-testid="sidebar-width-badge"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).toBeNull();
		unmount(instance);
	});
});

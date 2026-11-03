/**
 * StickToBottomToggle (2026-08-26) — the composer's stick-to-bottom
 * indicator + switch: maroon while following the live bottom, grey when
 * released; a flip reports upward (the panel scrolls on re-engage).
 *
 * Covers the leaf component's state contract. Since 2026-09 the toggle
 * lives on the panel's floating mount (sub-agent + agent panels) — the
 * live scroll-driven self-heal and the re-engage jump are e2e territory
 * (conversation spec 13c, short viewport); the panel integration is
 * pinned in conversation-panel.test.ts.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import StickToBottomToggle from '$lib/components/composer/sibling/StickToBottomToggle.svelte';

let cleanup: (() => void)[] = [];

afterEach(() => {
	for (const fn of cleanup) fn();
	cleanup = [];
});

function mountToggle(stick: boolean) {
	const flips: boolean[] = [];
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(StickToBottomToggle, {
		target,
		props: { stick, ontoggle: (next: boolean) => flips.push(next) }
	});
	cleanup.push(() => {
		unmount(comp);
		target.remove();
	});
	return { target, flips };
}

describe('StickToBottomToggle', () => {
	it('ON: maroon glyph, pressed, promises follow in the title', () => {
		const { target } = mountToggle(true);
		const btn = target.querySelector('[data-testid="stick-toggle"]') as HTMLElement;
		expect(btn.classList.contains('on')).toBe(true);
		expect(btn.getAttribute('aria-pressed')).toBe('true');
		expect(btn.getAttribute('data-active')).toBe('true');
		// The maroon paint itself is e2e (real browser) — happy-dom does not
		// resolve the scoped style block; here the class IS the state.
		expect(btn.getAttribute('title')).toContain('on');
	});

	it('OFF: grey glyph, not pressed, says the transcript stays put', () => {
		const { target } = mountToggle(false);
		const btn = target.querySelector('[data-testid="stick-toggle"]') as HTMLElement;
		expect(btn.classList.contains('on')).toBe(false);
		expect(btn.getAttribute('aria-pressed')).toBe('false');
		expect(btn.getAttribute('data-active')).toBe('false');
		expect(btn.getAttribute('title')).toContain('off');
	});

	it('click reports the flip (NOT of the current state)', () => {
		const a = mountToggle(true);
		(a.target.querySelector('[data-testid="stick-toggle"]') as HTMLElement).click();
		flushSync();
		expect(a.flips).toEqual([false]);

		const b = mountToggle(false);
		(b.target.querySelector('[data-testid="stick-toggle"]') as HTMLElement).click();
		flushSync();
		expect(b.flips).toEqual([true]);
	});
});

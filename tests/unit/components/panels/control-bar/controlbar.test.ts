/**
 * ControlBar unit tests — the host component's own branches (the tray
 * BODY is ControlBarTray's test files' contract; this file pins the
 * ControlBar lifecycle itself):
 *
 *   reveal()            → cancels a PENDING hide (hover out → re-enter
 *                         inside the 250ms grace keeps the tray open)
 *   scheduleHide()      → the 250ms grace actually closes the tray
 *   onKeydown           → Escape closes AND clears the pending timer;
 *                         a non-Escape key is the ignored else branch
 *   onfocusout          → relatedTarget INSIDE is navigation (no hide);
 *                         null or OUTSIDE schedules the hide
 *   onfocusin / click   → reveal through the focus and click paths
 *   the $effect         → the TRAY_MIN clamp: left = max(8, min(rect.left,
 *                         innerWidth - 272)) — both Math branches
 *   the portal action   → unmount destroys the tray node off document.body
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlBar from '$lib/components/panels/control-bar/ControlBar.svelte';

function renderBar(props: { onresizeall?: (width: number) => void } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onresizeall = props.onresizeall ?? (() => {});
	const comp = mount(ControlBar, { target, props: { onresizeall } });
	flushSync();
	const bar = target.querySelector('[data-testid="controlbar"]') as HTMLElement;
	const trigger = target.querySelector('[data-testid="controlbar-trigger"]') as HTMLElement;
	return {
		target,
		bar,
		trigger,
		unmount: () => {
			unmount(comp);
			flushSync();
		}
	};
}

const isOpen = (bar: HTMLElement): boolean => bar.getAttribute('data-open') === 'true';

/** The portaled tray host (.tray-float) lives on document.body, not in target. */
const trayFloat = (): HTMLElement | null => document.body.querySelector('.tray-float') as HTMLElement | null;

const reveal = (el: HTMLElement): void => {
	el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
	flushSync();
};

const hide = (el: HTMLElement): void => {
	el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
	flushSync();
};

const focusOut = (el: HTMLElement, relatedTarget: EventTarget | null): void => {
	// bubbles: true — Svelte's delegated listeners live at the document.
	el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
	flushSync();
};

const keydown = (el: HTMLElement, key: string): void => {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	flushSync();
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('ControlBar — reveal/scheduleHide grace lifecycle', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('hover out → re-enter inside the grace: reveal() clears the pending hideTimer', async () => {
		const { bar } = renderBar();
		reveal(bar);
		hide(bar); // 250ms hide pending
		reveal(bar); // re-enter before the grace lands — the clear branch
		await vi.advanceTimersByTimeAsync(1000);
		flushSync();
		expect(isOpen(bar)).toBe(true);
		expect(trayFloat()).not.toBeNull();
	});

	it('scheduleHide: the 250ms grace actually closes the tray', async () => {
		const { bar } = renderBar();
		reveal(bar);
		hide(bar);
		expect(isOpen(bar)).toBe(true); // inside the grace window
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
		expect(trayFloat()).toBeNull();
	});
});

describe('ControlBar — onKeydown branches', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('Escape closes the tray AND clears a pending hide (timer lands as a no-op)', async () => {
		const { bar } = renderBar();
		reveal(bar);
		hide(bar); // hide pending
		keydown(bar, 'Escape');
		expect(isOpen(bar)).toBe(false);
		await vi.advanceTimersByTimeAsync(400);
		flushSync();
		expect(isOpen(bar)).toBe(false); // cleared timer never re-fired
	});

	it('a non-Escape key hits the else branch — the open tray stays open', () => {
		const { bar } = renderBar();
		reveal(bar);
		keydown(bar, 'Tab');
		expect(isOpen(bar)).toBe(true);
	});
});

describe('ControlBar — onfocusout contains-check + focusin/click reveal', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('focusout to a relatedTarget INSIDE the bar does NOT schedule the hide', async () => {
		const { bar } = renderBar();
		reveal(bar);
		const inside = document.createElement('input');
		bar.appendChild(inside);
		focusOut(bar, inside);
		await vi.advanceTimersByTimeAsync(400);
		flushSync();
		expect(isOpen(bar)).toBe(true);
	});

	it('focusout with relatedTarget OUTSIDE schedules the hide', async () => {
		const { bar } = renderBar();
		reveal(bar);
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		focusOut(bar, outside);
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('focusout with relatedTarget null schedules the hide (the !(next instanceof Node) branch)', async () => {
		const { bar } = renderBar();
		reveal(bar);
		focusOut(bar, null);
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('focusin reveals the tray (keyboard access path)', () => {
		const { bar } = renderBar();
		bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(isOpen(bar)).toBe(true);
	});

	it('trigger click reveals the tray (the onclick branch) and sets aria-expanded', () => {
		const { bar, trigger } = renderBar();
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		trigger.click();
		flushSync();
		expect(isOpen(bar)).toBe(true);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
	});
});

describe('ControlBar — the $effect tray-position clamp (TRAY_MIN = 272)', () => {
	/** Pin the trigger rect and the viewport width, reveal, read the inline style. */
	const positionedLeft = (left: number, innerWidth: number): string => {
		const { bar, trigger, unmount } = renderBar();
		const rect = {
			left,
			right: left + 28,
			top: 10,
			bottom: 38,
			width: 28,
			height: 28,
			x: left,
			y: 10,
			toJSON: () => ({})
		} as DOMRect;
		vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect);
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
		reveal(bar);
		// Svelte renders the style attribute with a trailing semicolon.
		return (trayFloat()?.getAttribute('style') ?? '').replace(/;$/, '');
		unmount();
		return style;
	};

	it('a trigger near the left edge clamps to left: 8 (the Math.max floor branch)', () => {
		// rect.left 5 → min(5, 1928) = 5 → max(8, 5) = 8.
		expect(positionedLeft(5, 2000)).toBe('left: 8px; top: 44px');
	});

	it('a trigger near the right edge clamps to innerWidth - 272 (the Math.min branch)', () => {
		// innerWidth 300 → min(240, 28) = 28 → max(8, 28) = 28.
		expect(positionedLeft(240, 300)).toBe('left: 28px; top: 44px');
	});

	it('an unclamped trigger keeps its raw rect.left (both comparisons pass through)', () => {
		// rect.left 100, innerWidth 2000 → min(100, 1728) = 100 → max(8, 100) = 100.
		expect(positionedLeft(100, 2000)).toBe('left: 100px; top: 44px');
	});
});

describe('ControlBar — the portal action destroy', () => {
	it('unmount removes the portaled tray node from document.body', () => {
		const { bar, unmount } = renderBar();
		reveal(bar);
		const tray = trayFloat();
		expect(tray).not.toBeNull();
		expect(document.body.contains(tray as Node)).toBe(true);
		unmount();
		flushSync();
		expect(document.body.contains(tray as Node)).toBe(false);
		expect(isOpen(bar)).toBe(true); // bar was torn down too — assert reads don't throw
	});
});

describe('ControlBar — the portaled .tray-float re-attaches the hover/focus/Escape lifecycle', () => {
	// The tray host is MOVED to document.body, so the handlers on the host
	// div are the lifecycle's second copy — driven here on .tray-float.
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('mouseleave on the tray-float itself schedules the 250ms hide', async () => {
		const { bar } = renderBar();
		reveal(bar);
		const tray = trayFloat() as HTMLElement;
		expect(tray).not.toBeNull();
		hide(tray);
		expect(isOpen(bar)).toBe(true); // inside the grace window
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('a second hide while one is pending CLEARS and re-arms the timer (scheduleHide clearTimeout branch)', async () => {
		const { bar } = renderBar();
		reveal(bar);
		hide(bar); // hide pending at t=0
		await vi.advanceTimersByTimeAsync(200); // 50ms from closing
		hide(trayFloat() as HTMLElement); // re-arm from the tray side: clears the old timer
		await vi.advanceTimersByTimeAsync(100); // the FIRST timer's deadline passes
		flushSync();
		expect(isOpen(bar)).toBe(true); // old timer was cleared, not fired
		await vi.advanceTimersByTimeAsync(150); // the re-armed timer lands
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('focusout INSIDE the tray-float is navigation — no hide', async () => {
		const { bar } = renderBar();
		reveal(bar);
		const tray = trayFloat() as HTMLElement;
		const inside = document.createElement('input');
		tray.appendChild(inside);
		focusOut(tray, inside);
		await vi.advanceTimersByTimeAsync(400);
		flushSync();
		expect(isOpen(bar)).toBe(true);
	});

	it('focusout OUTSIDE the tray-float schedules the hide', async () => {
		const { bar } = renderBar();
		reveal(bar);
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		focusOut(trayFloat() as HTMLElement, outside);
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('focusout from the tray-float with a null relatedTarget schedules the hide', async () => {
		const { bar } = renderBar();
		reveal(bar);
		focusOut(trayFloat() as HTMLElement, null);
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('Escape keydown on the tray-float with NO pending timer closes it (the hideTimer-null branch)', async () => {
		const { bar } = renderBar();
		reveal(bar);
		keydown(trayFloat() as HTMLElement, 'Escape');
		expect(isOpen(bar)).toBe(false);
		expect(trayFloat()).toBeNull();
	});
});

describe('ControlBar — the $effect null-rect guard', () => {
	it('a trigger with no measurable rect returns early — tray mounts with no inline style', () => {
		const { bar, trigger } = renderBar();
		vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(undefined as unknown as DOMRect);
		reveal(bar);
		expect(isOpen(bar)).toBe(true); // the tray still opened
		// The positioning effect bailed before writing trayStyle.
		expect(trayFloat()?.getAttribute('style') ?? '').toBe('');
	});
});

/**
 * stick-to-bottom unit tests — the shared follow-the-live-end primitive
 * (utils/stick-to-bottom.svelte.ts, extracted from ConversationScrollArea
 * 2026-08-26), driven through a minimal host component so the runes state
 * and $effect attach path run exactly as consumers use them.
 *
 * happy-dom has no layout: geometry is faked with getters tied to the
 * rendered DOM (100px per child), the conversation-scroll-area pattern.
 * MutationObserver callbacks are microtasks — settle() flushes them.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StickHost from '../fixtures/StickHost.svelte';
import { createStickToBottom } from '$lib/utils/stick-to-bottom.svelte';

/** Fake geometry: 100px per child, 50px viewport. */
function fakeGeometry(el: HTMLElement): void {
	Object.defineProperty(el, 'scrollHeight', {
		configurable: true,
		get: () => Math.max(1, el.children.length) * 100
	});
	Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 50 });
}

async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function renderHost(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(StickHost, { target, props });
	const el = target.querySelector('[data-testid="stick-box"]') as HTMLElement;
	fakeGeometry(el);
	return { target, comp, el, unmount: () => unmount(comp) };
}

function scrollTo(el: HTMLElement, top: number): void {
	el.scrollTop = top;
	el.dispatchEvent(new Event('scroll', { bubbles: true }));
	flushSync();
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('stick-to-bottom — the generic contract', () => {
	it('attaches stuck; content growth keeps the live end pinned', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		expect(r.el.scrollTop).toBe(0); // no jump without the option

		const host = r.comp as unknown as { addChild(): void };
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(300); // 3 children × 100 — glued
		r.unmount();
	});

	it('jumpToBottom lands on the tail at attach', async () => {
		const r = renderHost({ children: 3, jump: true });
		await settle();
		expect(r.el.scrollTop).toBe(300);
		r.unmount();
	});

	it('scrolling up releases — later growth does NOT yank back', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		scrollTo(r.el, 50); // 50 + 50 < 200 - 48 → off-bottom
		const host = r.comp as unknown as { addChild(): void };
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(50); // reading position honored
		r.unmount();
	});

	it('an upward wheel tick releases the pin WITHIN the threshold (2026-11-21 bug)', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		// one small wheel-up tick (a real gesture's first delta): scrollTop
		// moves only 40px — inside the 48px threshold, so the scroll path
		// alone kept the pin engaged and streaming growth yanked it back.
		r.el.scrollTop = 160;
		r.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
		flushSync();
		const host = r.comp as unknown as { addChild(): void; flips: boolean[] };
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(160); // growth must NOT yank back
		expect(host.flips).toEqual([false]); // the wheel reported the release
		r.unmount();
	});

	it('the scroll event after a wheel release does NOT re-arm inside the threshold', async () => {
		const r = renderHost({ children: 3 }); // content 300, viewport 50
		await settle();
		// pinned at the bottom (scroll event keeps lastTop honest)
		scrollTo(r.el, 250);
		// a small tick lands at 210 — inside the 48px zone (>= 202)
		r.el.scrollTop = 210;
		r.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
		// the scroll event the tick generated: position within threshold,
		// traveling UP — must not re-arm the pin that was just dropped
		r.el.dispatchEvent(new Event('scroll', { bubbles: true }));
		flushSync();
		const host = r.comp as unknown as { addChild(): void };
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(210); // still released — no yank, no re-arm
		r.unmount();
	});

	it('a downward wheel tick does NOT release the pin', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		r.el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));
		flushSync();
		const host = r.comp as unknown as { addChild(): void };
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(300); // still glued
		r.unmount();
	});

	it('scrolling back to the bottom re-engages', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		scrollTo(r.el, 50);
		scrollTo(r.el, 200); // 200 + 50 >= 200 - 48 → bottom again
		const host = r.comp as unknown as { addChild(): void };
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(300);
		r.unmount();
	});

	it('setStick(true) jumps immediately; setStick(false) stops following', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		const host = r.comp as unknown as { addChild(): void; stb: { setStick(n: boolean): void; stick: boolean } };
		host.stb.setStick(false);
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(0); // released → no follow
		host.stb.setStick(true); // engage → jumps NOW
		flushSync();
		expect(r.el.scrollTop).toBe(300);
		r.unmount();
	});

	it('onstickchange reports scroll-driven flips', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		const host = r.comp as unknown as { flips: boolean[] };
		scrollTo(r.el, 50);
		expect(host.flips).toEqual([false]);
		scrollTo(r.el, 200);
		expect(host.flips).toEqual([false, true]);
		r.unmount();
	});

	it('characterData deltas (streaming text) keep the tail pinned', async () => {
		const r = renderHost({ children: 1 });
		await settle();
		const host = r.comp as unknown as { growText(): void };
		host.growText(); // same child node, longer text
		await settle();
		expect(r.el.scrollTop).toBe(100); // followed without a new child
		r.unmount();
	});

	it('detach stops everything: no scroll listener, no observer', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		const host = r.comp as unknown as { detach(): void; addChild(): void; flips: boolean[] };
		host.detach();
		await settle();
		host.addChild();
		await settle();
		scrollTo(r.el, 50);
		expect(r.el.scrollTop).toBe(50);
		expect(host.flips).toEqual([]); // listener gone
		r.unmount();
	});
});

describe('stick-to-bottom — re-attach and options', () => {
	it('re-attaching resets the stick state (fresh engage per open)', async () => {
		const r = renderHost({ children: 2 });
		await settle();
		scrollTo(r.el, 50); // released
		const host = r.comp as unknown as { reattach(): void; addChild(): void };
		host.reattach(); // e.g. the popup closed and reopened
		await settle();
		host.addChild();
		await settle();
		expect(r.el.scrollTop).toBe(300); // engaged again
		r.unmount();
	});

	it('a custom thresholdPx tightens the near-bottom band', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(StickHost, { target, props: { children: 4, threshold: 8 } });
		const el = target.querySelector('[data-testid="stick-box"]') as HTMLElement;
		fakeGeometry(el);
		await settle();
		// 340 + 50 = 390 >= 400 - 48 (bottom under the DEFAULT band) but
		// < 400 - 8 → off-bottom under the tight one: the flip happens.
		scrollTo(el, 340);
		const host = comp as unknown as { flips: boolean[] };
		expect(host.flips).toEqual([false]); // released — tight band says away
		unmount(comp);
	});

	it('the standalone factory works without a host component (pure API)', async () => {
		const el = document.createElement('div');
		el.dataset.testid = 'stick-box';
		el.appendChild(document.createElement('p'));
		document.body.appendChild(el);
		fakeGeometry(el);
		const onstickchange = vi.fn();
		const stb = createStickToBottom({ onstickchange });
		const detach = stb.attachTo(el);
		expect(stb.stick).toBe(true);
		// scrollTop 0 + clientHeight 50 < 100 - 48 → off-bottom on the
		// first honest scroll read.
		el.dispatchEvent(new Event('scroll', { bubbles: true }));
		expect(stb.stick).toBe(false);
		expect(onstickchange).toHaveBeenCalledWith(false);
		detach();
	});
});

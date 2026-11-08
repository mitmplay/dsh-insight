/**
 * BackToTheEdgeButton branch coverage (SA-3): the arms the floating-anchor
 * suite leaves cold — container-undefined guard, the Shift condition's
 * short-circuit arms (deep=false, onloadall=undefined), default threshold,
 * and the draining spinner render.
 */

import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import BackToTheEdgeButton from '$lib/components/common/buttons/BackToTheEdgeButton.svelte';
import BackToTheEdgeContainerGoneHost from '../fixtures/BackToTheEdgeContainerGoneHost.svelte';

function mountInto(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(BackToTheEdgeButton as any, { target, props });
	return { target, comp, cleanup: () => { unmount(comp); target.remove(); } };
}

/** Geometry-controllable container: happy-dom exposes scrollHeight/
 *  clientHeight as getters, so instance properties override them. */
function makeContainer(geo: { scrollTop?: number; scrollHeight: number; clientHeight: number }): HTMLElement {
	const el = document.createElement('div');
	Object.defineProperty(el, 'scrollHeight', { value: geo.scrollHeight, configurable: true });
	Object.defineProperty(el, 'clientHeight', { value: geo.clientHeight, configurable: true });
	el.scrollTop = geo.scrollTop ?? 0;
	document.body.appendChild(el);
	return el;
}

describe('BackToTheEdgeButton — branch arms (SA-3)', () => {
	it('container undefined: no button renders and the effect guard returns without attaching', () => {
		const { target, cleanup } = mountInto({ container: undefined, threshold: 200 });
		flushSync();
		expect(target.querySelector('button')).toBeNull();
		expect(target.querySelector('[data-testid="back-to-top"]')).toBeNull();
		expect(target.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
		cleanup();
	});

	it('container arriving as undefined later still refreshes clean if invoked — refresh(undefined-arm) resets both flags', () => {
		// The refresh() undefined-arm is defensive (owner never calls it); the
		// observable contract is that an undefined container never leaks a
		// stale button across a mount cycle.
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		const a = mountInto({ container: el, threshold: 200 });
		flushSync();
		expect(a.target.querySelector('[data-testid="back-to-top"]')).not.toBeNull();
		a.cleanup();
		el.remove();

		const b = mountInto({ container: undefined, threshold: 200 });
		flushSync();
		expect(b.target.querySelector('button')).toBeNull();
		b.cleanup();
	});

	it('Shift+click in TOP mode WITHOUT onloadall: falls through to the plain top jump (no crash, no drain state)', () => {
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		const { target, cleanup } = mountInto({ container: el, threshold: 200 });
		flushSync();
		const btn = target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
		expect(el.scrollTo).toHaveBeenCalledTimes(1);
		expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
		// No drain ran → never disabled, plain ArrowUp icon (no spinner).
		expect(btn.disabled).toBe(false);
		expect(btn.className).not.toContain('draining');
		cleanup();
		el.remove();
	});

	it('Shift+click in BOTTOM mode never drains — the modifier belongs to the up direction only', async () => {
		const el = makeContainer({ scrollTop: 50, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		const drain = vi.fn(async () => {});
		const { target, cleanup } = mountInto({ container: el, threshold: 200, onloadall: drain });
		flushSync();
		const btn = target.querySelector('[data-testid="scroll-to-bottom"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
		await Promise.resolve();
		expect(drain).not.toHaveBeenCalled();
		expect(el.scrollTo).toHaveBeenCalledWith({ top: 3000, behavior: 'smooth' });
		cleanup();
		el.remove();
	});

	it('default threshold 200: overflow exactly at 200 stays hidden; 201 shows', () => {
		const atEdge = makeContainer({ scrollTop: 0, scrollHeight: 900, clientHeight: 700 });
		const a = mountInto({ container: atEdge });
		flushSync();
		expect(a.target.querySelector('button')).toBeNull();
		a.cleanup();
		atEdge.remove();

		const past = makeContainer({ scrollTop: 0, scrollHeight: 901, clientHeight: 700 });
		const b = mountInto({ container: past });
		flushSync();
		expect(b.target.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();
		b.cleanup();
		past.remove();
	});

	it('custom threshold prop drives BOTH gates (visibility and mode split)', () => {
		const el = makeContainer({ scrollTop: 60, scrollHeight: 1200, clientHeight: 600 });
		const { target, cleanup } = mountInto({ container: el, threshold: 50 });
		flushSync();
		// Overflow 600 > 50 and scrollTop 60 > 50 → top mode immediately.
		expect(target.querySelector('[data-testid="back-to-top"]')).not.toBeNull();

		// Scroll back inside the threshold → bottom mode on the SAME mount.
		el.scrollTop = 10;
		el.dispatchEvent(new Event('scroll'));
		flushSync();
		expect(target.querySelector('[data-testid="back-to-top"]')).toBeNull();
		expect(target.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();
		cleanup();
		el.remove();
	});

	it('draining renders the spinner arm: class, disabled, and Loader icon replace ArrowUp mid-drain', async () => {
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const { target, cleanup } = mountInto({
			container: el,
			threshold: 200,
			onloadall: () => gate
		});
		flushSync();
		const btn = target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
		await vi.waitFor(() => expect(btn.className).toContain('draining'));
		expect(btn.disabled).toBe(true);
		expect(btn.querySelector('svg.spin')).not.toBeNull();

		release();
		await vi.waitFor(() => expect(el.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 })));
		flushSync();
		expect(btn.className).not.toContain('draining');
		expect(btn.querySelector('svg.spin')).toBeNull();
		cleanup();
		el.remove();
	});

	it('onleavebottom absent: up click still jumps (optional-call arm) and never throws', () => {
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		const { target, cleanup } = mountInto({ container: el, threshold: 200 });
		flushSync();
		(target.querySelector('[data-testid="back-to-top"]') as HTMLElement).click();
		expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
		cleanup();
		el.remove();
	});

	it('container prop detaches after render (host fixture): the button persists (effect !el arm returns early) and a click hits jump\'s !container guard — no crash, no scroll', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const comp = mount(BackToTheEdgeContainerGoneHost as any, { target, props: {} });
		const cleanup = () => { unmount(comp); target.remove(); };
		flushSync();
		const scroll = target.querySelector('[data-testid="bte-scroll"]') as HTMLElement;
		// happy-dom has no layout: expose the real geometry via instance
		// props (the makeContainer trick) BEFORE any refresh runs.
		Object.defineProperty(scroll, 'scrollHeight', { value: 1000, configurable: true });
		Object.defineProperty(scroll, 'clientHeight', { value: 100, configurable: true });
		scroll.scrollTop = 300;
		scroll.dispatchEvent(new Event('scroll'));
		flushSync();
		const btn = () => target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement | null;
		expect(btn()).not.toBeNull();
		const scrollTo = vi.fn();
		(scroll as unknown as { scrollTo: unknown }).scrollTo = scrollTo;

		// Overflow 900 > 10 and scrollTop 300 > 10 → top mode.
		expect(btn()).not.toBeNull();

		// Detach the container PROP (the effect `if (!el) return` arm —
		// overflowed keeps its stale true, so the button survives).
		(target.querySelector('[data-testid="bte-detach"]') as HTMLButtonElement).click();
		flushSync();
		expect(btn()).not.toBeNull();

		// jump(): `if (!container) return` — no throw, no scrollTo, no
		// onleavebottom (the !container guard precedes the optional call).
		expect(() => btn()!.click()).not.toThrow();
		await Promise.resolve();
		expect(scrollTo).not.toHaveBeenCalled();
		cleanup();
	});

	it('mode boundary: scrollTop exactly at threshold stays BOTTOM, one past flips TOP', () => {
		const el = makeContainer({ scrollTop: 200, scrollHeight: 3000, clientHeight: 600 });
		const { target, cleanup } = mountInto({ container: el, threshold: 200 });
		flushSync();
		// Strictly greater-than: exactly at the threshold is still the live end.
		expect(target.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

		el.scrollTop = 201;
		el.dispatchEvent(new Event('scroll'));
		flushSync();
		expect(target.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
		expect(target.querySelector('[data-testid="back-to-top"]')).not.toBeNull();
		cleanup();
		el.remove();
	});
});

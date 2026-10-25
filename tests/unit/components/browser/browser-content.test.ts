import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import BrowserContent from '$lib/components/browser/BrowserContent.svelte';

/**
 * BrowserContent — the dumb glass canvas surface. These tests exercise the
 * event relays (down/up/move/wheel/key/contextmenu), the failed strip, the
 * launch/wait placeholders, and every context-menu action callback, so the
 * inline arrow handlers are all counted.
 */
afterEach(() => {
	document.body.innerHTML = '';
});

function mountContent(props: Record<string, unknown> = {}): ReturnType<typeof mount> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return mount(BrowserContent, { target, props: props as never });
}

function q(sel: string): Element | null {
	return document.querySelector(sel);
}

function qAll(sel: string): HTMLElement[] {
	return Array.from(document.querySelectorAll(sel));
}

describe('BrowserContent — the glass canvas', () => {
	it('binds wrap and canvas upward and relays every input event', async () => {
		const seen: string[] = [];
		const instance = mountContent({
			status: 'live',
			ondown: () => seen.push('down'),
			onup: () => seen.push('up'),
			onmove: () => seen.push('move'),
			onwheel: () => seen.push('wheel'),
			onkey: () => seen.push('key'),
			oncontextmenu: () => seen.push('ctx')
		});
		const canvas = q('canvas')!;
		// Svelte defers wheel/touch/pointer listener attachment to a microtask —
		// flush it before dispatching or the handler is not yet on the canvas
		await Promise.resolve();
		canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		// happy-dom swallows synthesized WheelEvent dispatch — a named Event still exercises onwheel
		canvas.dispatchEvent(new Event('wheel', { bubbles: true }));
		canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
		canvas.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(seen).toEqual(['down', 'up', 'move', 'wheel', 'key', 'key', 'ctx']);
		unmount(instance);
	});

	it('shows the failed strip with the fail reason and no glass', () => {
		const instance = mountContent({ status: 'failed', failReason: 'cdp died' });
		const strip = q('[data-testid="browser-failed"]');
		expect(strip).toBeTruthy();
		expect(strip!.textContent).toContain('cdp died');
		expect(q('[data-testid="browser-glass"]')).toBeNull();
		unmount(instance);
	});

	it('failed with a null reason still renders the strip (?? fallback)', () => {
		const instance = mountContent({ status: 'failed' });
		expect(q('[data-testid="browser-failed"]')).toBeTruthy();
		unmount(instance);
	});

	it('opening/connecting show placeholders; live hides it', () => {
		const opening = mountContent({ status: 'opening' });
		expect(q('[data-testid="browser-placeholder"]')).toBeTruthy();
		unmount(opening);

		const connecting = mountContent({ status: 'connecting' });
		expect(q('[data-testid="browser-placeholder"]')).toBeTruthy();
		unmount(connecting);

		const live = mountContent({ status: 'live' });
		expect(q('[data-testid="browser-placeholder"]')).toBeNull();
		unmount(live);
	});

	it('renders the full context menu (src + href) and fires each action', () => {
		const actions: string[] = [];
		const instance = mountContent({
			status: 'live',
			ctxMenu: { px: 12, py: 34, href: 'https://x/y', src: 'https://x/i.png' },
			onctxaction: (a: string) => actions.push(a)
		});
		const menu = q('[data-testid="browser-ctxmenu"]') as HTMLElement;
		expect(menu).toBeTruthy();
		expect(menu.style.left).toBe('12px');
		expect(menu.style.top).toBe('34px');
		const items = qAll('[data-testid="browser-ctxmenu-item"]');
		expect(items).toHaveLength(6);
		for (const item of items) item.click();
		expect(actions).toEqual(['open-image', 'copy-image', 'open-link', 'copy-link', 'reload', 'send-right-click']);
		unmount(instance);
	});

	it('renders the minimal context menu (no src, no href) with reload + right-click only', () => {
		const actions: string[] = [];
		const instance = mountContent({
			status: 'live',
			ctxMenu: { px: 0, py: 0, href: null, src: null },
			onctxaction: (a: string) => actions.push(a)
		});
		const items = qAll('[data-testid="browser-ctxmenu-item"]');
		expect(items).toHaveLength(2);
		for (const item of items) item.click();
		expect(actions).toEqual(['reload', 'send-right-click']);
		unmount(instance);
	});
});

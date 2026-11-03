import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrowserTab from '$lib/components/browser/BrowserTab.svelte';

/**
 * BrowserTab chip — the faviconUrl arms and the ordinal-badge grammar that
 * the strip suites never reach (they only send data:/https tabs with a
 * strip position): the http: arm, the invalid-URL catch arm, the img
 * onerror fallback to the dot, and both ordinal labels ('tN:id' with a
 * strip position, 'tab:id' on a bare direct mount).
 */
afterEach(() => {
	document.body.innerHTML = '';
});

const BASE = { targetId: 'tx-9', title: 'Example', active: false };

function mountChip(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserTab, { target, props: props as never });
	flushSync();
	return {
		target,
		un: () => unmount(instance),
		img: () => target.querySelector('[data-testid="browser-tab-favicon"] img') as HTMLImageElement | null,
		badge: () => target.querySelector('[data-testid="browser-tab-ordinal"]')?.textContent ?? null
	};
}

describe('BrowserTab — faviconUrl arms', () => {
	it('an https URL renders the s2 favicon img', () => {
		const v = mountChip({ tab: { ...BASE, url: 'https://example.com/page' } });
		const img = v.img();
		expect(img).toBeTruthy();
		expect(img!.getAttribute('src')).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=32');
		v.un();
	});

	it('an http URL renders the s2 favicon too (the first protocol arm)', () => {
		const v = mountChip({ tab: { ...BASE, url: 'http://insecure.example/a' } });
		expect(v.img()).toBeTruthy();
		v.un();
	});

	it('a non-http(s) URL (data:) keeps the bare dot — no img', () => {
		const v = mountChip({ tab: { ...BASE, url: 'data:text/html,one' } });
		expect(v.img()).toBeNull();
		v.un();
	});

	it('an invalid URL takes the catch arm — no img, no throw', () => {
		const v = mountChip({ tab: { ...BASE, url: 'not a url at all' } });
		expect(v.img()).toBeNull();
		v.un();
	});

	it('a favicon img load error hides the img (the dot shows through)', async () => {
		const v = mountChip({ tab: { ...BASE, url: 'https://example.com/page' } });
		const img = v.img()!;
		expect(img.style.display).toBe('');
		img.dispatchEvent(new Event('error'));
		expect(img.style.display).toBe('none');
		v.un();
	});
});

describe('BrowserTab — ordinal badge grammar', () => {
	it('with a strip position the badge reads tN:tabId', () => {
		const v = mountChip({ tab: { ...BASE, url: 'https://e.com', tabId: 7 }, position: 3 });
		expect(v.badge()).toBe('t3:7');
		v.un();
	});

	it('without a position (bare mount) the badge degrades to tab:tabId', () => {
		const v = mountChip({ tab: { ...BASE, url: 'https://e.com', tabId: 7 } });
		expect(v.badge()).toBe('tab:7');
		v.un();
	});

	it('no tabId — no badge at all', () => {
		const v = mountChip({ tab: { ...BASE, url: 'https://e.com' } });
		expect(v.badge()).toBeNull();
		v.un();
	});
});

describe('BrowserTab — close stops propagation', () => {
	it('the X click fires close but never activate', () => {
		const onactivate = vi.fn();
		const onclose = vi.fn();
		const v = mountChip({ tab: { ...BASE, url: 'https://e.com', tabId: 1 }, onactivate, onclose });
		(v.target.querySelector('[data-testid="browser-tab-close"]') as HTMLButtonElement).click();
		expect(onclose).toHaveBeenCalledWith('tx-9');
		expect(onactivate).not.toHaveBeenCalled();
		v.un();
	});
});

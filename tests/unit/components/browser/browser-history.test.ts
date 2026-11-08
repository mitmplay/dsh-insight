import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrowserHistory from '$lib/components/browser/buttons/BrowserHistory.svelte';

/**
 * BrowserHistory branch sweep — the long-press history menu extracted from
 * BrowserHeader (ADR-0031 ACTS). The header's behavior battery drives it
 * through the header; here the component is mounted directly to pin every
 * template branch: faviconUrl http/https vs non-http(s) vs invalid URL,
 * the back/forward dot colors, the title-fallback-to-url arm, shortUrl's
 * root-vs-path arms, the onpick report, the class passthrough, and the
 * favicon onerror fallback reveal.
 */

type Entry = { index: number; url: string; title: string };

function mountHistory(entries: Entry[], dir: 'back' | 'forward' = 'back', className = '') {
	const onpick = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(BrowserHistory, {
		target,
		props: { dir, entries, onpick, class: className }
	});
	flushSync();
	return { onpick, target, cleanup: () => { unmount(app); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('BrowserHistory — render branches', () => {
	it('renders one row per entry, keyed pick reports the entry index', () => {
		const { onpick, target, cleanup } = mountHistory([
			{ index: 3, url: 'https://a.example/', title: 'Third' },
			{ index: 7, url: 'https://b.example/x', title: 'Seventh' }
		]);
		const rows = target.querySelectorAll<HTMLButtonElement>('[data-testid="browser-history-item"]');
		expect(rows).toHaveLength(2);
		rows[1].click();
		flushSync();
		expect(onpick).toHaveBeenCalledWith(7);
		cleanup();
	});

	it('http(s) URLs get the Google s2 favicon; the dot stays under the img', () => {
		const { target, cleanup } = mountHistory([
			{ index: 0, url: 'http://plain.example/', title: 'Plain' }
		]);
		const img = target.querySelector<HTMLImageElement>('[data-testid="browser-history-favicon"]');
		expect(img).not.toBeNull();
		expect(img!.src).toBe('https://www.google.com/s2/favicons?domain=plain.example&sz=32');
		cleanup();
	});

	it('non-http(s) URLs (about:) and invalid URLs keep the dot, no favicon img', () => {
		const { target, cleanup } = mountHistory([
			{ index: 0, url: 'about:blank', title: 'Blank' },
			{ index: 1, url: 'not a url at all', title: 'Broken' }
		]);
		expect(target.querySelector('[data-testid="browser-history-favicon"]')).toBeNull();
		const dots = target.querySelectorAll('span.rounded-full');
		expect(dots).toHaveLength(2);
		cleanup();
	});

	it('an empty title falls back to the raw URL', () => {
		const { target, cleanup } = mountHistory([
			{ index: 0, url: 'https://t.example/deep', title: '' }
		]);
		const title = target.querySelector('[data-testid="browser-history-item"] span.block.truncate');
		expect(title!.textContent).toBe('https://t.example/deep');
		cleanup();
	});

	it('shortUrl drops the path for root URLs but keeps non-root paths', () => {
		const { target, cleanup } = mountHistory([
			{ index: 0, url: 'https://root.example/', title: 'Root' },
			{ index: 1, url: 'https://deep.example/a/b?q=1', title: 'Deep' }
		]);
		const shorts = target.querySelectorAll('[data-testid="browser-history-item"] .leading-tight span:last-child');
		expect(shorts[0].textContent).toBe('root.example');
		// the component renders pathname only — a query string never shows
		expect(shorts[1].textContent).toBe('deep.example/a/b');
		cleanup();
	});

	it('dir=back paints amber dots; dir=forward paints sky dots', () => {
		const back = mountHistory([{ index: 0, url: 'https://a.example/', title: 'A' }], 'back');
		expect(back.target.querySelector('span.rounded-full')!.className).toContain('bg-amber-400');
		back.cleanup();

		const fwd = mountHistory([{ index: 0, url: 'https://a.example/', title: 'A' }], 'forward');
		expect(fwd.target.querySelector('span.rounded-full')!.className).toContain('bg-sky-400');
		fwd.cleanup();
	});

	it('the caller class is passed through for the anchoring shift', () => {
		const { target, cleanup } = mountHistory(
			[{ index: 0, url: 'https://a.example/', title: 'A' }],
			'back',
			'left-7'
		);
		const menu = target.querySelector('[data-testid="browser-history-menu"]');
		expect(menu!.className).toContain('left-7');
		cleanup();
	});

	it('a favicon onerror hides the img so the colored dot shows through', () => {
		const { target, cleanup } = mountHistory([
			{ index: 0, url: 'https://a.example/', title: 'A' }
		]);
		const img = target.querySelector<HTMLImageElement>('[data-testid="browser-history-favicon"]');
		img!.dispatchEvent(new Event('error', { bubbles: true }));
		flushSync();
		expect(img!.style.display).toBe('none');
		cleanup();
	});
});

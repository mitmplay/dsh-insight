/**
 * MarkdownContent allowHtml viewer tests (ADR-0055 companion Wave 2, task
 * 2.1-T; 2026-11-09). Pins the surface contract: flag false (default —
 * chat parity) renders the banner snippet as escaped text; flag true (the
 * FILE PREVIEW path) renders a real <img> in the container.
 */
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

const BANNER = '<p align="center"><img src="https://example.com/banner.png" alt="banner" width="600" /></p>';

function mountContent(props: { content: string; allowHtml?: boolean }): { el: HTMLElement; un: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(MarkdownContent, { target, props });
	flushSync();
	return {
		el: target,
		un: () => {
			unmount(instance);
			target.remove();
		}
	};
}

describe('MarkdownContent allowHtml (ADR-0055 Wave 2)', () => {
	it('defaults to escaped text — chat parity holds', () => {
		const v = mountContent({ content: BANNER });
		const html = v.el.querySelector('.md-content')?.innerHTML ?? '';
		expect(html).toContain('&lt;p align');
		// No BANNER img element (the favicon img inside the autolinked URL is
		// pre-existing strict-path behavior, not a revival).
		expect(v.el.querySelector('img[src="https://example.com/banner.png"]')).toBeNull();
		v.un();
	});

	it('allowHtml renders a real img element in the container', () => {
		const v = mountContent({ content: BANNER, allowHtml: true });
		const img = v.el.querySelector('img[src="https://example.com/banner.png"]');
		expect(img).toBeTruthy();
		expect(img?.getAttribute('alt')).toBe('banner');
		v.un();
	});

	it('allowHtml keeps fenced HTML as escaped source (D3)', () => {
		const fenced = '```html\n<div align="center">hi</div>\n```';
		const v = mountContent({ content: fenced, allowHtml: true });
		expect(v.el.querySelector('pre code')?.innerHTML).toContain('&lt;div align');
		expect(v.el.querySelector('.md-content div[align]')).toBeNull();
		v.un();
	});
});

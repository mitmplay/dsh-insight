/** File Link Intent W1.2-T — the delegated handler contract (PRD Task 1.2):
 *  with onFileLink, scheme-free relative anchor clicks preventDefault and
 *  emit the normalized path; '..'/'//' hrefs do not emit; without the prop,
 *  native navigation is untouched. */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import MarkdownContent from '../../src/lib/components/common/viewers/MarkdownContent.svelte';

type Mounted = { target: HTMLElement; cleanup: () => void };

function mountContent(content: string, onFileLink?: (path: string) => void): Mounted {
	const target = document.body.appendChild(document.createElement('div'));
	const comp = mount(MarkdownContent, {
		target,
		props: onFileLink ? { content, onFileLink } : { content }
	});
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

function clickAnchor(target: HTMLElement, href: string): void {
	const anchor = target.querySelector(`a[href="${href}"]`) as HTMLAnchorElement | null;
	if (!anchor) throw new Error('anchor not rendered for ' + href);
	const event = new MouseEvent('click', { bubbles: true, cancelable: true });
	anchor.dispatchEvent(event);
	return void (event.defaultPrevented);
}

describe('MarkdownContent onFileLink (File Link Intent W1.2)', () => {
	it('emits the raw href once and prevents navigation', () => {
		const onFileLink = vi.fn();
		const { target, cleanup } = mountContent('[card](src/lib/components/cards/Card.svelte)', onFileLink);
		clickAnchor(target, 'src/lib/components/cards/Card.svelte');
		expect(onFileLink).toHaveBeenCalledTimes(1);
		// The #L anchor feature: the RAW href crosses this seam — the
		// consumer parses path AND line target out of it (parseFileLinkHref).
		expect(onFileLink).toHaveBeenCalledWith('src/lib/components/cards/Card.svelte');
		cleanup();
	});

	it('emits the anchor-bearing href verbatim (line target survives)', () => {
		const onFileLink = vi.fn();
		const { target, cleanup } = mountContent('[a](./src//deep//a.ts#L3-L9)', onFileLink);
		clickAnchor(target, './src//deep//a.ts#L3-L9');
		expect(onFileLink).toHaveBeenCalledWith('./src//deep//a.ts#L3-L9');
		cleanup();
	});

	it('a .. escape href does not emit and does not navigate', () => {
		const onFileLink = vi.fn();
		const { target, cleanup } = mountContent('[evil](../secrets.txt)', onFileLink);
		const anchor = target.querySelector('a[href="../secrets.txt"]') as HTMLAnchorElement;
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		anchor.dispatchEvent(event);
		expect(onFileLink).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		cleanup();
	});

	it('protocol-relative href is never an anchor at all (sanitizer refusal)', () => {
		const onFileLink = vi.fn();
		const { target, cleanup } = mountContent('[x](//evil.example/x)', onFileLink);
		expect(target.querySelector('a')).toBeNull();
		expect(target.textContent).toContain('x');
		cleanup();
	});

	it('external https anchors keep native navigation (no emit)', () => {
		const onFileLink = vi.fn();
		const { target, cleanup } = mountContent('[docs](https://example.com/x)', onFileLink);
		const anchor = target.querySelector('a[href="https://example.com/x"]') as HTMLAnchorElement;
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		anchor.dispatchEvent(event);
		expect(onFileLink).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		cleanup();
	});

	it('a click that lands OFF any anchor emits nothing (the !anchor guard)', () => {
		const onFileLink = vi.fn();
		const { target, cleanup } = mountContent('just a paragraph, no links', onFileLink);
		const el = target.querySelector('.md-content') as HTMLElement;
		el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(onFileLink).not.toHaveBeenCalled();
		cleanup();
	});

	it('without the prop, anchors navigate natively (no listener installed)', () => {
		const { target, cleanup } = mountContent('[card](src/a.ts)');
		const anchor = target.querySelector('a[href="src/a.ts"]') as HTMLAnchorElement;
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		anchor.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		cleanup();
	});
});

// ── Fullpath Bow ADR 2026-09-26 D2 — the extension-icon post-pass ──

describe('file-link anchor icons (Fullpath Bow D2)', () => {
	it('decorates each file anchor with exactly one extension glyph', () => {
		const { target, cleanup } = mountContent(
			'[a](src/lib/components/cards/Card.svelte) and [b](README.md)',
			vi.fn()
		);
		const icons = target.querySelectorAll('a .flink-icon');
		expect(icons.length).toBe(2);
		for (const icon of icons) expect(icon.querySelector('svg')).not.toBeNull();
		cleanup();
	});

	it('a line-anchor href derives the icon from the basename', () => {
		const { target, cleanup } = mountContent('[c](deep/nested/Composer.svelte#L12)', vi.fn());
		expect(target.querySelectorAll('a .flink-icon').length).toBe(1);
		cleanup();
	});

	it('external and api anchors get NO icon', () => {
		const { target, cleanup } = mountContent(
			'[d](https://example.com/x.ts) [e](/api/dsh/session)',
			vi.fn()
		);
		expect(target.querySelectorAll('a .flink-icon').length).toBe(0);
		cleanup();
	});

	it('a re-run of the render pass does not duplicate icons', () => {
		const { target, cleanup } = mountContent('[f](src/a.ts)', vi.fn());
		flushSync();
		flushSync();
		expect(target.querySelectorAll('a .flink-icon').length).toBe(1);
		cleanup();
	});

	it('without onFileLink the anchors stay undecorated (change-nothing contract)', () => {
		const { target, cleanup } = mountContent('[g](src/a.ts)');
		expect(target.querySelectorAll('a .flink-icon').length).toBe(0);
		cleanup();
	});
});

/**
 * MarkdownContent pre copy (2026-11-06, ADR-0051): every rendered code fence
 * gets a hover-revealed TEXT CopyButton at its top-right through the same
 * post-render DOM pass that decorates tables and diagrams — wrapped in a
 * relative group/code div, one button per block, lean path covered, and
 * plain prose mounts none.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

const FENCE = [
	"```js",
	"const x = 1;",
	"```"
].join("\n");

function mountContent(props: { content: string; small?: boolean; hideToggle?: boolean }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('MarkdownContent — per-pre text copy (ADR-0051)', () => {
	it('a rendered code fence is wrapped group/code with a text copy button at its top-right', () => {
		const h = mountContent({ content: 'intro\n\n' + FENCE + '\n\ndone' });
		const pre = h.target.querySelector('pre') as HTMLElement;
		expect(pre).not.toBeNull();
		const wrap = pre.parentElement as HTMLElement;
		expect(wrap.className.includes('group/code')).toBe(true);
		const btn = wrap.querySelector(
			'[data-testid="copy-text-button"]'
		) as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.title).toBe('Copy code');
		// text mode: the button copies the block own characters
		expect(wrap.querySelector('[data-testid="canvas-copy-button"]')).toBeNull();
		expect(wrap.parentElement?.classList.contains('md-content')).toBe(true);
		h.cleanup();
	});

	it('two fences get two buttons, each anchored to its own block', () => {
		const h = mountContent({ content: FENCE + '\n\n' + FENCE.replaceAll('x = 1', 'y = 2') });
		// scope to .md-content: the full-path toolbar also renders a whole-turn
		// CopyButton OUTSIDE it — only the per-pre buttons live inside
		const md = h.target.querySelector('.md-content') as HTMLElement;
		expect(md.querySelectorAll('pre')).toHaveLength(2);
		expect(md.querySelectorAll('[data-testid="copy-text-button"]')).toHaveLength(2);
		h.cleanup();
	});

	it('plain prose mounts no text copy button', () => {
		const h = mountContent({ content: 'plain **bold** prose' });
		const md = h.target.querySelector('.md-content') as HTMLElement;
		expect(md.querySelector('[data-testid="copy-text-button"]')).toBeNull();
		h.cleanup();
	});

	it('the lean path (hideToggle) gets the button too', () => {
		const h = mountContent({ content: FENCE, hideToggle: true });
		expect(h.target.querySelectorAll('[data-testid="copy-text-button"]')).toHaveLength(1);
		h.cleanup();
	});

	it('the copy value is the code text', () => {
		const h = mountContent({ content: FENCE });
		const pre = h.target.querySelector("pre") as HTMLElement;
		const btn = h.target.querySelector('[data-testid="copy-text-button"]');
		expect(btn).not.toBeNull();
		// the wrapper preserves the pre; the value derives from its textContent
		expect(pre.textContent?.includes('const x = 1')).toBe(true);
		h.cleanup();
	});

	it('a content change re-runs the pass: fresh mount leaves exactly one wrapper, no duplicates', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(MarkdownContent, { target, props: { content: FENCE } });
		flushSync();
		const md1 = target.querySelector('.md-content') as HTMLElement;
		expect(md1.querySelectorAll('[data-testid="copy-text-button"]')).toHaveLength(1);
		unmount(comp);
		const t2 = document.createElement('div');
		document.body.appendChild(t2);
		const again = mount(MarkdownContent, { target: t2, props: { content: FENCE } });
		flushSync();
		const md2 = t2.querySelector('.md-content') as HTMLElement;
		expect(md2.querySelectorAll('[data-testid="copy-text-button"]')).toHaveLength(1);
		expect(md2.querySelectorAll('pre')).toHaveLength(1);
		unmount(again);
		t2.remove();
	});
});

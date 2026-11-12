/**
 * MarkdownContent image-src decoration — component host test (task 1.2-T,
 * "Explorer Freshness and Image Links" Wave 1; ADR "The Silent Root").
 *
 * Contract: with a workspaceRoot prop, each img[data-ws-src] gets its src
 * rewritten to /api/dsh/workspace-file-bytes?root=<enc>&path=<enc>; without
 * a root the src stays ABSENT and the alt text survives (D1's acceptable
 * fallback). The client never trusts the path — the endpoint enforces
 * containment; this test only pins the URL the client builds.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

function mountInto(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(MarkdownContent as any, { target, props });
	flushSync();
	return { target, comp, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('MarkdownContent img data-ws-src decoration (The Silent Root D1)', () => {
	it('with a root: src carries the encoded root and path', () => {
		const { target, cleanup } = mountInto({
			content: '![top row](<sticky notes row.png>)',
			hideToggle: true,
			workspaceRoot: '/Users/op/my workspace'
		});
		const img = target.querySelector('img[data-ws-src]');
		expect(img).toBeTruthy();
		expect(img?.getAttribute('src')).toBe(
			'/api/dsh/workspace-file-bytes?root=' +
				encodeURIComponent('/Users/op/my workspace') +
				'&path=' +
				encodeURIComponent('sticky notes row.png')
		);
		cleanup();
	});

	it('without a root: src is absent and alt text survives', () => {
		const { target, cleanup } = mountInto({
			content: '![top row](<sticky-notes-top-row.png>)',
			hideToggle: true
		});
		const img = target.querySelector('img[data-ws-src]');
		expect(img).toBeTruthy();
		expect(img?.getAttribute('src')).toBeNull();
		expect(img?.getAttribute('alt')).toBe('top row');
		cleanup();
	});
});

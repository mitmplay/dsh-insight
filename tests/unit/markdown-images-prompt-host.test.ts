/**
 * Chat-surface workspaceRoot threading — component host test (task 5.1-T,
 * "Explorer Freshness and Image Links" Wave 5; ADR "The Silent Root" D1).
 *
 * Wave-5 defect fix: the chat transcript's MarkdownContent consumers never
 * received a workspace root, so transcript images rendered alt-only
 * (img[data-ws-src], src absent). This pins the PromptBubble → MessageBubble
 * chain: with a workspaceRoot the img src carries the encoded root and path;
 * without one the src stays ABSENT and the alt text survives (D1 fallback).
 * The client never trusts the path — the endpoint enforces containment.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import PromptBubble from '$lib/components/message/prompt/PromptBubble.svelte';

function mountInto(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(PromptBubble as any, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('chat-surface workspaceRoot threading (The Silent Root D1, Wave 5)', () => {
	it('with a root: the bubble chain resolves the img src with encoded root and path', () => {
		const { target, cleanup } = mountInto({
			text: '![top row](<sticky notes row.png>)',
			time: 1,
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

	it('without a root: src stays absent and alt text survives (D1 fallback)', () => {
		const { target, cleanup } = mountInto({
			text: '![top row](<sticky-notes-top-row.png>)',
			time: 1
		});
		const img = target.querySelector('img[data-ws-src]');
		expect(img).toBeTruthy();
		expect(img?.getAttribute('src')).toBeNull();
		expect(img?.getAttribute('alt')).toBe('top row');
		cleanup();
	});
});

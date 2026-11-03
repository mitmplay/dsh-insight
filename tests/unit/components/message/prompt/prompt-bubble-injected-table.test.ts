/**
 * PromptBubble injected data-table mount pins (2026-10-29): an injected
 * message whose text is the <path>/<type>/<content> trio renders the
 * key/value table (path value a file link); plain prompts never do.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PromptBubble from '$lib/components/message/prompt/PromptBubble.svelte';

const TRIO = '<path>/Users/wharsojo/agentic-ai/x.png</path>\n<type>image</type>\n<content>\nimage/png image, 10x10 px, 99 bytes\n</content>';

function mountBubble(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptBubble, { target, props: { time: 1, sessionId: 's1', ...props } });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('PromptBubble — injected data-table render (2026-10-29)', () => {
	it('meta injected + trio text renders the key/value table with a linked path', () => {
		const onFileLink = vi.fn();
		const h = mountBubble({ text: TRIO, meta: 'injected', onFileLink });
		const table = h.target.querySelector('[data-testid=injected-data-table]');
		expect(table).not.toBeNull();
		const keys = [...table!.querySelectorAll('td.k')].map((td) => td.textContent);
		expect(keys).toEqual(['path', 'type', 'content']);
		const link = table!.querySelector('button') as HTMLButtonElement;
		expect(link.textContent).toBe('x.png');
		link.click();
		expect(onFileLink).toHaveBeenCalledWith('/Users/wharsojo/agentic-ai/x.png');
		// the action row + RelativeTime mount exactly as for a text bubble;
		// the trio never renders as markdown
		expect(h.target.querySelector('[data-testid=prompt-action-row]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid=message-time]')).not.toBeNull();
		// SavePromptButton excluded (2026-10-29 operator call): saving the raw
		// trio into the prompts library is meaningless
		expect(h.target.querySelector('[data-testid=save-prompt-button]')).toBeNull();
		expect(h.target.querySelector('.md-content')).toBeNull();
		h.cleanup();
	});

	it('a plain prompt (no meta) renders markdown, never the table', () => {
		const h = mountBubble({ text: TRIO });
		expect(h.target.querySelector('[data-testid=injected-data-table]')).toBeNull();
		expect(h.target.querySelector('[data-testid=save-prompt-button]')).not.toBeNull();
		h.cleanup();
	});

	it('an injected message WITHOUT the trio shape renders markdown, not a table', () => {
		const h = mountBubble({ text: 'background job finished', meta: 'injected' });
		expect(h.target.querySelector('[data-testid=injected-data-table]')).toBeNull();
		h.cleanup();
	});
});

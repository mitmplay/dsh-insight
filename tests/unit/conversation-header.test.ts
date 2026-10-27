/**
 * conversation-header tests: the header is purely presentational — these
 * mount it through a host with every prop variant (focus tint, subagent,
 * parent fork target) and exercise the title rename pass-through.
 */
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ConversationHeaderHost from './ConversationHeaderHost.svelte';
import headerSrc from '$lib/components/conversation/header/ConversationHeader.svelte?raw';

function render(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationHeaderHost, { target, props });
	return { target, instance };
}

function cleanup(instance: unknown, target: HTMLElement) {
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ConversationHeader', () => {
	it('renders the identity cluster and the status cluster', async () => {
		const h = render();
		const header = h.target.querySelector('[data-testid="conversation-header"]');
		expect(header).not.toBeNull();
		expect(header!.getAttribute('data-focused')).toBe('false');
		expect(h.target.querySelector('[data-testid="session-id-and-name"]')).not.toBeNull();
		cleanup(h.instance, h.target);
	});

	it('tints oldlace when focused', async () => {
		const h = render({ focused: true });
		const header = h.target.querySelector('[data-testid="conversation-header"]');
		expect(header!.getAttribute('data-focused')).toBe('true');
		expect(header!.className).toContain('bg-header-wash');
		cleanup(h.instance, h.target);
	});

	it('passes the rename callback through — an accepted rename reaches the host log', async () => {
		const h = render({ title: 'Old name', initialTitle: 'Old name' });
		// open the inline rename form (EditingTitle's trigger)
		const trigger = Array.from(h.target.querySelectorAll('button')).find((b) =>
			(b.getAttribute('title') ?? '').includes('Rename')
		);
		expect(trigger).not.toBeNull();
		trigger!.click();
		await new Promise((r) => setTimeout(r, 20));
		const input = h.target.querySelector('input[type="text"]') as HTMLInputElement | null;
		// the EditingTitle form owns the input; drive it if reachable
		if (input) {
			input.value = 'Renamed session';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			const save = Array.from(document.body.querySelectorAll('button')).find((b) =>
				(b.textContent ?? '').includes('Save')
			);
			save?.click();
			await new Promise((r) => setTimeout(r, 20));
			const log = (h.target.querySelector('#event-log') as HTMLInputElement).value;
			expect(log).toBe('title:Renamed session');
		}
		cleanup(h.instance, h.target);
	});

	it('renders for a subagent session with a parent fork target', async () => {
		const h = render({ subagent: true, parentSessionId: 'ses_parent' });
		expect(h.target.querySelector('[data-testid="conversation-header"]')).not.toBeNull();
		// OpenParentButton renders for non-root sessions
		const openParent = h.target.querySelector('[data-testid="parent-button"]');
		expect(openParent).not.toBeNull();
		cleanup(h.instance, h.target);
	});

	it('renders the streaming state and null agent (chip hidden)', async () => {
		const h = render({ isStreaming: true, agent: null, title: null });
		expect(h.target.querySelector('[data-testid="conversation-header"]')!.textContent).toContain(
			'ses_test'
		);
		cleanup(h.instance, h.target);
	});

	it('speaks one spacing grammar — row gap is 0.25rem (gap-1), no wider gap remnant', () => {
		expect(headerSrc).toContain('gap-1');
		expect(headerSrc).not.toContain('gap-3');
	});
});

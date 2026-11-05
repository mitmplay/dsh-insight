import { describe, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import ConversationHeader from '../../src/lib/components/conversation/header/ConversationHeader.svelte';

function mountHeader(onOpenBrowser: (shift: boolean) => void): { target: HTMLDivElement; instance: Record<string, unknown> } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationHeader, {
		target,
		props: { sessionId: 's1', title: 't', initialTitle: 't', ontitlechange: () => undefined, agent: null, isStreaming: false, onOpenBrowser }
	});
	return { target, instance: instance as unknown as Record<string, unknown> };
}

describe('BrowserButton shift wiring (task 2.1-T, ADR-0046 D0)', () => {
	it('a plain click reports shift=false', async () => {
		const seen: boolean[] = [];
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		const chip = target.querySelector('[data-testid="open-browser"]') as HTMLElement;
		chip.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([false]);
		unmount(instance as object);
		target.remove();
	});

	it('a shift+click reports shift=true (the Borrowed Signature gesture)', async () => {
		const seen: boolean[] = [];
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		const chip = target.querySelector('[data-testid="open-browser"]') as HTMLElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([true]);
		unmount(instance as object);
		target.remove();
	});
});

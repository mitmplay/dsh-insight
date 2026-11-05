import { describe, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import ConversationHeader from '../../src/lib/components/conversation/header/ConversationHeader.svelte';

function mountHeader(onOpenBrowser: (shift: boolean) => void): { target: HTMLDivElement; instance: object } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationHeader, {
		target,
		props: { sessionId: 's1', title: 't', initialTitle: 't', ontitlechange: () => undefined, agent: null, isStreaming: false, onOpenBrowser }
	});
	return { target, instance };
}

describe('BrowserButton shift wiring (task 2.1/2.2, ADR-0047 D0/D2)', () => {
	it('a plain click reports shift=false with NO consent dialog (D0: plain stays clean)', async () => {
		const seen: boolean[] = [];
		let dialogs = 0;
		window.confirm = () => {
			dialogs += 1;
			return true;
		};
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		(target.querySelector('[data-testid="open-browser"]') as HTMLElement).click();
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([false]);
		expect(dialogs).toBe(0);
		unmount(instance);
		target.remove();
	});

	it('a shift+click asks consent, and only a confirmed dialog reports shift=true (D2)', async () => {
		const seen: boolean[] = [];
		window.confirm = () => true;
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		const chip = target.querySelector('[data-testid="open-browser"]') as HTMLElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([true]);
		unmount(instance);
		target.remove();
	});

	it('a DECLINED consent dialog reports nothing (declining is a no-op, never permission)', async () => {
		const seen: boolean[] = [];
		window.confirm = () => false;
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		const chip = target.querySelector('[data-testid="open-browser"]') as HTMLElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([]);
		unmount(instance);
		target.remove();
	});
});

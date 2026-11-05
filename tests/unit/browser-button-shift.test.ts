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

// The Headed Downgrade (2026-11-05): the consent dialog is GONE — Shift
// passes straight through as the headed intent. Plain clicks stay clean.
describe('BrowserButton shift wiring (task 2.2, the Headed Downgrade)', () => {
	it('a plain click reports shift=false (plain stays byte-identical)', async () => {
		const seen: boolean[] = [];
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		(target.querySelector('[data-testid="open-browser"]') as HTMLElement).click();
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([false]);
		unmount(instance);
		target.remove();
	});

	it('a shift+click reports shift=true immediately — NO consent dialog', async () => {
		const seen: boolean[] = [];
		let dialogs = 0;
		window.confirm = () => {
			dialogs += 1;
			return true;
		};
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		const chip = target.querySelector('[data-testid="open-browser"]') as HTMLElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([true]);
		expect(dialogs).toBe(0);
		unmount(instance);
		target.remove();
	});

	it('the chip renders no dialog path at all — confirm can never fire for any click', async () => {
		let dialogs = 0;
		window.confirm = () => {
			dialogs += 1;
			return false;
		};
		const seen: boolean[] = [];
		const { target, instance } = mountHeader((shift) => seen.push(shift));
		const chip = target.querySelector('[data-testid="open-browser"]') as HTMLElement;
		chip.click();
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(dialogs).toBe(0);
		expect(seen).toEqual([false, true]);
		unmount(instance);
		target.remove();
	});
});

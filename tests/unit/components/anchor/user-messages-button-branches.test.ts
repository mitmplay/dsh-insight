/**
 * UserMessagesButton branch tests — the anchor leaf with NO prior unit
 * test (coverage-final: 3/6 branches). Covers the render gate's BOTH
 * miss arms (no container; no prompt group) and the 2026-11-21
 * press-toggle guards: primary pointerdown toggles, non-primary never
 * does, click toggles only at detail 0 (keyboard), rapid toggle closes.
 * Style follows plan-button.test.ts (mount + flushSync, no library).
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import UserMessagesButton from '$lib/components/anchor/user-msg-anchor/UserMessagesButton.svelte';
import { groupTurns } from '$lib/utils/turn-grouping';
import type { TurnGroup } from '$lib/utils/turn-grouping';

const GROUPS: TurnGroup[] = groupTurns([
	{ kind: 'user-message', id: 'u:seq:1', seq: 1, time: 1, text: 'hello there' },
	{ kind: 'assistant-turn-placeholder' } as never
]);

function mountButton(groups: TurnGroup[], container?: HTMLElement) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(UserMessagesButton, { target, props: { groups, container } });
	flushSync();
	return { target, instance };
}

describe('UserMessagesButton branches', () => {
	it('renders nothing without a container even when prompt groups exist', () => {
		const { target, instance } = mountButton(GROUPS, undefined);
		expect(target.querySelector('[data-testid="user-messages-button"]')).toBeNull();
		unmount(instance);
	});

	it('renders nothing with a container but no prompt group', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const onlyTurn: TurnGroup[] = [
			{ kind: 'assistant-turn', key: 'a:1', entries: [] }
		];
		const { target, instance } = mountButton(onlyTurn, container);
		expect(target.querySelector('[data-testid="user-messages-button"]')).toBeNull();
		unmount(instance);
	});

	it('primary pointerdown toggles open; the popup lists the prompt; the button reads active', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const { target, instance } = mountButton(GROUPS, container);
		const button = target.querySelector('[data-testid="user-messages-button"]') as HTMLButtonElement;
		expect(target.querySelector('[data-testid="user-message-jumper"]')).toBeNull();
		button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();
		expect(button.classList.contains('active')).toBe(true);
		// second press toggles closed (rapid toggle path)
		button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).toBeNull();
		expect(button.classList.contains('active')).toBe(false);
		unmount(instance);
	});

	it('non-primary pointerdown (right-click) never toggles', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const { target, instance } = mountButton(GROUPS, container);
		const button = target.querySelector('[data-testid="user-messages-button"]') as HTMLButtonElement;
		button.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).toBeNull();
		unmount(instance);
	});

	it('a trusted mouse click (detail 1) does not toggle; keyboard click (detail 0) does', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const { target, instance } = mountButton(GROUPS, container);
		const button = target.querySelector('[data-testid="user-messages-button"]') as HTMLButtonElement;
		// pointer-style click: detail 1 — the toggle must stay closed
		button.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).toBeNull();
		// keyboard Enter/Space: detail 0 — toggles open
		button.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();
		unmount(instance);
	});
});
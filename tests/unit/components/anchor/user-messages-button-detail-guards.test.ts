/**
 * UserMessagesButton detail/button guards — re-creation of the original
 * 7-test branch suite (2026-11-22) in its own file after the branches
 * file was taken over by another agent. Branch map:
 *   B1  {#if container !== undefined && groups.some(g => g.kind === 'prompt')}
 *       — container-undefined arm, no-prompt arm, both-true arm.
 *   B2  onpointerdown: e.button === 0 → toggle / other button → no toggle.
 *   B3  onclick: e.detail === 0 (keyboard) → toggle / trusted click → no toggle.
 *   B4  class:active={open} — both sides of the toggle state.
 * Conventions: tests/unit/components/language-menu/language-menu.test.ts
 * (mount/unmount/flushSync, happy-dom, real component, no server seams).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import UserMessagesButton from '$lib/components/anchor/user-msg-anchor/UserMessagesButton.svelte';
import type { TurnGroup } from '$lib/utils/turn-grouping';

/** Minimal prompt group — the button only checks kind; the jumper reads entry.text/time. */
function promptGroup(key: string, text: string): TurnGroup {
	return {
		kind: 'prompt',
		key,
		entry: { kind: 'user-message', id: key, seq: 1, text, time: Date.now() },
		context: []
	} as unknown as TurnGroup;
}

const assistantGroup = {
	kind: 'assistant-turn',
	key: 'a:1',
	entries: []
} as unknown as TurnGroup;

function render(groups: TurnGroup[], container?: HTMLElement) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(UserMessagesButton, {
		target,
		props: { groups, container }
	});
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

function press(el: Element, button: number) {
	el.dispatchEvent(new MouseEvent('pointerdown', { button, bubbles: true }));
	flushSync();
}

function click(el: Element, detail: number) {
	el.dispatchEvent(new MouseEvent('click', { detail, bubbles: true }));
	flushSync();
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('UserMessagesButton — detail/button guards (own file)', () => {
	it('B1: renders NOTHING when container is undefined (even with prompt groups)', () => {
		const h = render([promptGroup('u:1', 'hello')], undefined);
		expect(h.target.querySelector('[data-testid="user-messages-button"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('B1: renders NOTHING when no group is a prompt (assistant-only transcript)', () => {
		const container = document.createElement('main');
		const h = render([assistantGroup], container);
		expect(h.target.querySelector('[data-testid="user-messages-button"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('B1: renders the button when container exists AND a prompt group exists', () => {
		const container = document.createElement('main');
		const h = render([assistantGroup, promptGroup('u:1', 'hello')], container);
		const btn = h.target.querySelector(
			'[data-testid="user-messages-button"]'
		) as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('type')).toBe('button');
		expect(btn.classList.contains('tone-cyan')).toBe(true);
		// title comes from the paraglide catalog through t() — non-empty
		expect((btn.getAttribute('title') ?? '').length).toBeGreaterThan(0);
		// the wrapper div is the jumper's trigger element
		expect(btn.parentElement?.className).toContain('relative');
		cleanup(h.instance, h.target);
	});

	it('B4/B2/B3: primary pointerdown toggles open, then closes (class:active both sides)', () => {
		const container = document.createElement('main');
		const h = render([promptGroup('u:1', 'hello')], container);
		const btn = h.target.querySelector(
			'[data-testid="user-messages-button"]'
		) as HTMLButtonElement;
		expect(btn.classList.contains('active')).toBe(false);
		press(btn, 0);
		expect(btn.classList.contains('active')).toBe(true);
		press(btn, 0);
		expect(btn.classList.contains('active')).toBe(false);
		cleanup(h.instance, h.target);
	});

	it('B2: non-primary pointerdown (button !== 0) never toggles', () => {
		const container = document.createElement('main');
		const h = render([promptGroup('u:1', 'hello')], container);
		const btn = h.target.querySelector(
			'[data-testid="user-messages-button"]'
		) as HTMLButtonElement;
		press(btn, 2); // right button
		expect(btn.classList.contains('active')).toBe(false);
		cleanup(h.instance, h.target);
	});

	it('B3: keyboard click (detail 0) toggles open', () => {
		const container = document.createElement('main');
		const h = render([promptGroup('u:1', 'hello')], container);
		const btn = h.target.querySelector(
			'[data-testid="user-messages-button"]'
		) as HTMLButtonElement;
		click(btn, 0); // Enter/Space keyboard activation
		expect(btn.classList.contains('active')).toBe(true);
		click(btn, 0);
		expect(btn.classList.contains('active')).toBe(false);
		cleanup(h.instance, h.target);
	});

	it('B3: trusted pointer click (detail > 0) never toggles — press-time owns the toggle', () => {
		const container = document.createElement('main');
		const h = render([promptGroup('u:1', 'hello')], container);
		const btn = h.target.querySelector(
			'[data-testid="user-messages-button"]'
		) as HTMLButtonElement;
		click(btn, 1);
		expect(btn.classList.contains('active')).toBe(false);
		cleanup(h.instance, h.target);
	});
});

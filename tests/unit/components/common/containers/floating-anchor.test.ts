/**
 * FloatingAnchor stack tests (OCI port, 2026-08-23): anchor container,
 * leaf button tones, UserMessageJumper prompt-group listing + group-key
 * jump, BackToTheEdgeButton visibility gating.
 */

import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import FloatingAnchor from '$lib/components/common/containers/FloatingAnchor.svelte';
import UserMessagesButton from '$lib/components/anchor/user-messages/UserMessagesButton.svelte';
import UserMessageJumper from '$lib/components/anchor/user-messages/UserMessageJumper.svelte';
import BackToTheEdgeButton from '$lib/components/common/buttons/BackToTheEdgeButton.svelte';
import BackToTheEdgeRaceHost from '../../../../fixtures/BackToTheEdgeRaceHost.svelte';
import EmbeddedAnchorHost from '../../../EmbeddedAnchorHost.svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnGroup } from '$lib/utils/turn-grouping';

function mountInto<T>(component: T, props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(component as any, { target, props });
	return { target, comp, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('FloatingAnchor + UserMessagesButton', () => {
	it('stack renders children with the fixed right-edge contract', () => {
		const { target, cleanup } = mountInto(FloatingAnchor, {
			children: createRawSnippet(() => ({ render: () => '<button data-testid="leaf">go</button>' }))
		});
		const stack = target.querySelector('[data-testid="floating-anchor"]') as HTMLElement;
		// No provider → standalone: viewport-anchored fixed stack.
		expect(stack.className).toContain('fixed');
		expect(stack.className).toContain('right-2');
		expect(stack.className).toContain('bottom-[50vh]');
		expect(stack.className).not.toContain('absolute');
		expect(stack.querySelector('[data-testid="leaf"]')).not.toBeNull();
		cleanup();
	});

	it('embedded prop → absolute per-panel geometry (OCI Floating Host contract)', () => {
		const { target, cleanup } = mountInto(FloatingAnchor, {
			embedded: true,
			children: createRawSnippet(() => ({ render: () => '<button data-testid="leaf">go</button>' }))
		});
		const stack = target.querySelector('[data-testid="floating-anchor"]') as HTMLElement;
		// Explicit prop: absolute, right edge, bottom half — resolves against
		// the panel's `relative` root, never the viewport.
		expect(stack.className).toContain('absolute');
		expect(stack.className).toContain('right-2');
		expect(stack.className).toContain('bottom-1/2');
		expect(stack.className).not.toContain('fixed');
		cleanup();
	});

	it('panel-mode context provides the embedded default (prop wins over context)', () => {
		// Host calls setPanelMode(true) and renders bare <FloatingAnchor> —
		// the exact shape ConversationPanel uses on the floor.
		const { target, cleanup } = mountInto(EmbeddedAnchorHost, {});
		const stack = target.querySelector('[data-testid="floating-anchor"]') as HTMLElement;
		expect(stack.className).toContain('absolute');
		expect(stack.className).not.toContain('fixed');
		cleanup();
	});

	it('source contract: no transform — bottom-anchored, never top+translate (OCI discipline)', () => {
		const src = readFileSync(
			join(process.cwd(), 'src/lib/components/common/containers/FloatingAnchor.svelte'),
			'utf8'
		);
		expect(src).not.toMatch(/-translate-y|translateY|top-1\/2|top: ?50%/);
	});

	it('UserMessagesButton is self-contained: title + cyan tone + popup toggle + prompt gate', () => {
		// 2026-08-26: the button absorbed the jumper wiring (open state,
		// triggerEl wrapper, prompt-group gate) that lived in
		// ConversationFloatingAnchor — one unit now.
		const container = document.createElement('div');
		const groups: TurnGroup[] = [
			{ kind: 'prompt', key: 'u:1', entry: { kind: 'user-message', id: 'u:1', seq: 1, time: 1_000, text: 'first prompt' }, context: [] }
		];
		const { target, cleanup } = mountInto(UserMessagesButton, { groups, container });
		const btn = target.querySelector('[data-testid="user-messages-button"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('title')).toBe('User Messages');
		expect(btn.className).toContain('tone-cyan');
		expect(btn.className).not.toContain('active');
		// Click toggles the popup open — the active tone mirrors it.
		btn.click();
		flushSync();
		expect(btn.className).toContain('active');
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();
		btn.click();
		flushSync();
		expect(btn.className).not.toContain('active');
		cleanup();

		// No prompt groups → nothing renders at all (the gate moved in).
		const bare = mountInto(UserMessagesButton, { groups: [], container });
		expect(bare.target.querySelector('[data-testid="user-messages-button"]')).toBeNull();
		bare.cleanup();
	});
});

describe('UserMessageJumper — group-key identification (OCI port)', () => {
	const groups: TurnGroup[] = [
		{ kind: 'prompt', key: 'u:1', entry: { kind: 'user-message', id: 'u:1', seq: 1, time: 1_000, text: 'first prompt' }, context: [] },
		{ kind: 'assistant-turn', key: 'a:2', entries: [] },
		{ kind: 'context', key: 'u:3', entries: [{ kind: 'user-message', id: 'u:3', seq: 3, time: 3_000, text: 'injected', meta: 'instructions' }] },
		{ kind: 'prompt', key: 'u:4', entry: { kind: 'user-message', id: 'u:4', seq: 4, time: 4_000, text: 'second prompt' }, context: [] }
	];

	it('lists HUMAN prompts only — context groups and turns stay out', () => {
		const container = document.createElement('div');
		const { target, cleanup } = mountInto(UserMessageJumper, { groups, container, triggerEl: undefined, open: true });
		const rows = target.querySelectorAll('[data-testid="user-message-jumper-row"]');
		expect(rows).toHaveLength(2);
		expect(target.textContent).toContain('User Messages (2)');
		expect(target.textContent).toContain('first prompt');
		expect(target.textContent).not.toContain('injected');
		cleanup();
	});

	it('jump resolves the group-key anchor INSIDE the container and centers it', () => {
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:4');
		container.appendChild(anchor);
		document.body.appendChild(container);
		container.scrollTop = 500; // centering math passes it through
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;

		const { target, cleanup } = mountInto(UserMessageJumper, { groups, container, triggerEl: undefined, open: true });
		(target.querySelectorAll('[data-testid="user-message-jumper-row"]')[1] as HTMLElement).click();

		expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });
		cleanup();
		container.remove();
	});

	it('anchor missing inside the container → honest no-op (never a document-wide query)', () => {
		const outside = document.createElement('div');
		const decoy = document.createElement('div');
		decoy.setAttribute('data-group-key', 'u:4');
		outside.appendChild(decoy);
		document.body.appendChild(outside);

		const container = document.createElement('div'); // does NOT contain the anchor
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;

		const { target, cleanup } = mountInto(UserMessageJumper, { groups, container, triggerEl: undefined, open: true });
		(target.querySelectorAll('[data-testid="user-message-jumper-row"]')[1] as HTMLElement).click();
		expect(scrollTo).not.toHaveBeenCalled();
		cleanup();
		outside.remove();
	});

	it('TRUSTED click on the toggle button keeps the popup open (opening click must not close it)', () => {
		// The bug (2026-08-23): the toggle click bubbles to the window
		// outside-click handler — trusted, outside the popup — which closed
		// the popup in the same event, so it never became visible. The
		// triggerEl exclusion is the fix. Synthetic clicks carry
		// isTrusted=false in happy-dom, so the close path never ran in tests;
		// shadowing isTrusted on the instance fakes a real user click.
		const container = document.createElement('div');
		const toggleWrapper = document.createElement('div');
		const toggleBtn = document.createElement('button');
		toggleWrapper.appendChild(toggleBtn);
		document.body.appendChild(toggleWrapper);

		const { target, cleanup } = mountInto(UserMessageJumper, { groups, container, triggerEl: toggleWrapper, open: true });
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();

		const trusted = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(trusted, 'isTrusted', { value: true });
		toggleBtn.dispatchEvent(trusted);
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();

		cleanup();
		toggleWrapper.remove();
	});

	it('TRUSTED click elsewhere closes the popup (real outside click)', () => {
		const container = document.createElement('div');
		const { target, cleanup } = mountInto(UserMessageJumper, { groups, container, triggerEl: undefined, open: true });
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();

		const trusted = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(trusted, 'isTrusted', { value: true });
		document.body.dispatchEvent(trusted);
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).toBeNull();

		cleanup();
	});

	it('Escape closes the popup (jump never closes; Esc is a close path)', () => {
		const container = document.createElement('div');
		const { target, cleanup } = mountInto(UserMessageJumper, { groups, container, triggerEl: undefined, open: true });
		expect(target.querySelector('[data-testid="user-message-jumper"]')).not.toBeNull();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(target.querySelector('[data-testid="user-message-jumper"]')).toBeNull();
		cleanup();
	});
});

describe('BackToTheEdgeButton', () => {
	/** Geometry-controllable container: happy-dom exposes scrollHeight/
	 *  clientHeight as getters, so instance properties override them. */
	function makeContainer(geo: { scrollTop?: number; scrollHeight: number; clientHeight: number }): HTMLElement {
		const el = document.createElement('div');
		Object.defineProperty(el, 'scrollHeight', { value: geo.scrollHeight, configurable: true });
		Object.defineProperty(el, 'clientHeight', { value: geo.clientHeight, configurable: true });
		el.scrollTop = geo.scrollTop ?? 0;
		document.body.appendChild(el);
		return el;
	}

	it('a fitting transcript hides the button — no far end to jump to', () => {
		const fitting = makeContainer({ scrollHeight: 800, clientHeight: 700 });
		const a = mountInto(BackToTheEdgeButton, { container: fitting, threshold: 200 });
		flushSync();
		expect(a.target.querySelector('[data-testid="back-to-top"]')).toBeNull();
		expect(a.target.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
		a.cleanup();
		fitting.remove();
	});

	it('dual mode (2026-08-26, OCI parity): near top = Scroll to bottom, deep = Back to top', () => {
		// Long transcript, viewport near the TOP: OCI's bottom half — the
		// affordance back to the live end the first port dropped.
		const el = makeContainer({ scrollTop: 50, scrollHeight: 3000, clientHeight: 600 });
		const { target, cleanup } = mountInto(BackToTheEdgeButton, { container: el, threshold: 200 });
		flushSync();
		const bottomBtn = target.querySelector('[data-testid="scroll-to-bottom"]');
		expect(bottomBtn).not.toBeNull();
		expect(bottomBtn?.getAttribute('title')).toBe('Scroll to bottom');

		// Scroll past the threshold (a live scroll event, not a remount):
		// the SAME button flips to top mode.
		el.scrollTop = 300;
		el.dispatchEvent(new Event('scroll'));
		flushSync();
		expect(target.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
		const topBtn = target.querySelector('[data-testid="back-to-top"]');
		expect(topBtn).not.toBeNull();
		// Title carries the Shift-drain affordance (2026-08-26) — a mouse
		// modifier has no other discoverability surface.
		expect(topBtn?.getAttribute('title')).toBe('Back to top — Shift+click loads all history');
		cleanup();
		el.remove();
	});

	it('Shift+click (top mode) drains all older pages via onloadall, then lands at the top', async () => {
		// 2026-08-26: a plain top jump reaches only the loaded window's top;
		// Shift awaits the panel's drain FIRST. The unit pins the button's
		// half of the contract: onloadall awaited before the scroll, disabled
		// against a second concurrent drain — the panel's loop has its own
		// e2e (spec 13e, multi-page via the stub's historyPageSize knob).
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		const order: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const { target, cleanup } = mountInto(BackToTheEdgeButton, {
			container: el,
			threshold: 200,
			onloadall: async () => {
				order.push('drain-start');
				await gate;
				order.push('drain-end');
			}
		});
		flushSync();
		const btn = target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();

		// Shift+click while DEEP: the drain gate holds the button busy —
		// no scroll yet, disabled true, and a second click mid-drain no-ops.
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
		await vi.waitFor(() => expect(order).toContain('drain-start'));
		expect(btn.disabled).toBe(true);
		expect(el.scrollTo).not.toHaveBeenCalled();
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));

		// Release: the drain completes, THEN the jump lands at the top —
		// order is the contract (a jump before the drain would land short).
		release();
		await vi.waitFor(() => expect(order).toEqual(['drain-start', 'drain-end']));
		await vi.waitFor(() => expect(el.scrollTo).toHaveBeenCalled());
		expect((el.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ top: 0 });
		expect(btn.disabled).toBe(false);
		cleanup();
		el.remove();
	});

	it('plain click (no Shift) never drains — the jump stays the loaded window\'s far edge', () => {
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		const drain = vi.fn(async () => {});
		const { target, cleanup } = mountInto(BackToTheEdgeButton, {
			container: el,
			threshold: 200,
			onloadall: drain
		});
		flushSync();
		const btn = target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(drain).not.toHaveBeenCalled();
		expect(el.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
		cleanup();
		el.remove();
	});

	it('bind:this nulling the container before unmount does not crash the teardown (2026-08-24)', () => {
		// The panel-close race, pinned: inside a destroyed subtree, Svelte
		// assigns null to the bind:this binding BEFORE BackToTheEdgeButton's
		// $effect teardown runs. Re-reading the prop in the teardown threw
		// "Cannot read properties of null (reading 'removeEventListener')"
		// in production (panel floor, keyed remount). The fixture is the
		// exact production shape: container + button in one {#if} block.
		const host = mountInto(BackToTheEdgeRaceHost, {});
		flushSync();
		expect(host.target.querySelector('div')).not.toBeNull();
		// The teardown contract the crash broke: the scroll listener must
		// detach from the ELEMENT it attached to when the subtree unmounts
		// (whatever the container prop reads by then).
		const el = host.comp.containerEl() as HTMLElement;
		const detach = vi.spyOn(el, 'removeEventListener');
		host.comp.hide();
		flushSync();
		expect(host.target.querySelector('div')).toBeNull();
		expect(detach).toHaveBeenCalledWith('scroll', expect.any(Function));
		host.cleanup();
	});

	it('click in TOP mode smooth-scrolls to the top', () => {
		const container = makeContainer({ scrollTop: 400, scrollHeight: 3000, clientHeight: 600 });
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;
		const { target, cleanup } = mountInto(BackToTheEdgeButton, { container, threshold: 200 });
		flushSync();
		(target.querySelector('[data-testid="back-to-top"]') as HTMLElement).click();
		expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
		cleanup();
		container.remove();
	});

	it('click in BOTTOM mode smooth-scrolls to the live end (the bottom half, 2026-08-26)', () => {
		const container = makeContainer({ scrollTop: 50, scrollHeight: 3000, clientHeight: 600 });
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;
		const { target, cleanup } = mountInto(BackToTheEdgeButton, { container, threshold: 200 });
		flushSync();
		(target.querySelector('[data-testid="scroll-to-bottom"]') as HTMLElement).click();
		expect(scrollTo).toHaveBeenCalledWith({ top: 3000, behavior: 'smooth' });
		cleanup();
		container.remove();
	});

	it('up click reports onleavebottom FIRST — release precedes the viewport move (2026-09-08)', () => {
		const container = makeContainer({ scrollTop: 400, scrollHeight: 3000, clientHeight: 600 });
		const order: string[] = [];
		const scrollTo = vi.fn(() => void order.push('scroll'));
		container.scrollTo = scrollTo;
		const { target, cleanup } = mountInto(BackToTheEdgeButton, {
			container,
			threshold: 200,
			onleavebottom: () => void order.push('release')
		});
		flushSync();
		(target.querySelector('[data-testid="back-to-top"]') as HTMLElement).click();
		// The stick release is the click's FIRST effect — synchronous, not
		// effect-flush-late: the toggle is already OFF when the scroll
		// starts, so no streaming mutation can yank the jump back.
		expect(order).toEqual(['release', 'scroll']);
		expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
		cleanup();
		container.remove();
	});

	it('bottom click never reports onleavebottom — the stick window re-engages that direction', () => {
		const container = makeContainer({ scrollTop: 50, scrollHeight: 3000, clientHeight: 600 });
		container.scrollTo = vi.fn();
		const release = vi.fn();
		const { target, cleanup } = mountInto(BackToTheEdgeButton, {
			container,
			threshold: 200,
			onleavebottom: release
		});
		flushSync();
		(target.querySelector('[data-testid="scroll-to-bottom"]') as HTMLElement).click();
		expect(release).not.toHaveBeenCalled();
		cleanup();
		container.remove();
	});

	it('Shift+click reports onleavebottom before the drain runs (pages load with the stick already off)', async () => {
		const el = makeContainer({ scrollTop: 300, scrollHeight: 3000, clientHeight: 600 });
		el.scrollTo = vi.fn();
		const order: string[] = [];
		const { target, cleanup } = mountInto(BackToTheEdgeButton, {
			container: el,
			threshold: 200,
			onloadall: async () => void order.push('drain'),
			onleavebottom: () => void order.push('release')
		});
		flushSync();
		(target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })
		);
		await vi.waitFor(() => expect(order).toContain('drain'));
		expect(order[0]).toBe('release');
		cleanup();
		el.remove();
	});
});

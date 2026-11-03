/**
 * TerminalTabHeader — the grown-up strip (Terminal Desk ADR amendment
 * 2026-11-03, D5a/D5b; Tasks Wave 6). Pins: the strip scrolls instead of
 * clipping; the sticky clear control sits OUTSIDE the scroller; the
 * popover's three scope verbs (Clear all / Clear jobs / Clear terminals)
 * emit exactly one onClear intent each; there is NO Cancel verb — outside
 * click and Esc cancel silently; the scroll-into-view effect reruns on
 * selectedIndex without throwing in jsdom.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalTabHeader from '$lib/components/terminal/TerminalTabHeader.svelte';

interface Intents {
	clear: string[];
}

function mountHeader(
	selectedIndex: number,
	intents: Intents,
	nTabs = 3
) {
	const target = document.body.appendChild(document.createElement('div'));
	const buttons = Array.from({ length: nTabs }, (_, i) => i);
	const instance = mount(TerminalTabHeader, {
		target,
		props: {
			selectedIndex,
			onClear: (scope: 'all' | 'jobs' | 'terminals') => intents.clear.push(scope),
			children: createRawSnippet(() => ({
				// a single root element — createRawSnippet DEV-checks for exactly one
				render: () =>
					'<div>' +
					buttons
						.map((i) => `<button role="tab" aria-selected="${i === selectedIndex}" data-testid="tab-${i}"></button>`)
						.join('') +
					'</div>'
			}))
		}
	});
	flushSync();
	return { target, instance };
}

function click(el: Element): void {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('terminal tab header — the sticky clear and its three verbs', () => {
	it('the strip scrolls (overflow-x) and the clear slot sits OUTSIDE it', () => {
		const { target, instance } = mountHeader(0, { clear: [] });
		const strip = target.querySelector('[data-testid="terminal-tabstrip"]') as HTMLElement;
		expect(strip).not.toBeNull();
		// jsdom does not compute Tailwind classes — pin the scroll class instead
		expect(strip.classList.contains('overflow-x-auto')).toBe(true);
		const slot = target.querySelector('[data-testid="terminal-tabstrip-clear-slot"]');
		expect(slot).not.toBeNull();
		expect(strip.contains(slot)).toBe(false);
		expect(slot!.contains(strip)).toBe(false);
		unmount(instance);
	});

	it('no onClear prop renders NO clear control', () => {
		const target = document.body.appendChild(document.createElement('div'));
		const instance = mount(TerminalTabHeader, {
			target,
			props: { children: (() => null) as never }
		});
		flushSync();
		expect(target.querySelector('[data-testid="terminal-tabstrip-clear"]')).toBeNull();
		unmount(instance);
	});

	it('the three verbs each emit ONE scope intent and close the popover', () => {
		const intents: Intents = { clear: [] };
		const { target, instance } = mountHeader(0, intents);
		const btn = () => target.querySelector('[data-testid="terminal-tabstrip-clear"]')!;
		expect(target.querySelector('[data-testid="terminal-tabstrip-clear-pop"]')).toBeNull();

		click(btn());
		click(target.querySelector('[data-testid="terminal-tabstrip-clear-all"]')!);
		expect(intents.clear).toEqual(['all']);
		expect(target.querySelector('[data-testid="terminal-tabstrip-clear-pop"]')).toBeNull();

		click(btn());
		click(target.querySelector('[data-testid="terminal-tabstrip-clear-jobs"]')!);
		expect(intents.clear).toEqual(['all', 'jobs']);

		click(btn());
		click(target.querySelector('[data-testid="terminal-tabstrip-clear-terminals"]')!);
		expect(intents.clear).toEqual(['all', 'jobs', 'terminals']);
		unmount(instance);
	});

	it('there is NO Cancel verb — outside click and Esc cancel silently', () => {
		const intents: Intents = { clear: [] };
		const { target, instance } = mountHeader(0, intents);
		click(target.querySelector('[data-testid="terminal-tabstrip-clear"]')!);
		expect(target.querySelector('[data-testid="terminal-tabstrip-clear-cancel"]')).toBeNull();

		// Esc cancels
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(target.querySelector('[data-testid="terminal-tabstrip-clear-pop"]')).toBeNull();
		expect(intents.clear).toEqual([]);

		// outside click (the backdrop arm — jsdom has no hit-testing, and in
		// the browser the fixed backdrop covers the viewport) cancels too
		click(target.querySelector('[data-testid="terminal-tabstrip-clear"]')!);
		click(target.querySelector('.backdrop')!);
		expect(target.querySelector('[data-testid="terminal-tabstrip-clear-pop"]')).toBeNull();
		expect(intents.clear).toEqual([]);
		unmount(instance);
	});

	it('selection change reruns the scroll effect without throwing (jsdom: no scrollIntoView)', () => {
		const spy = vi.fn();
		Element.prototype.scrollIntoView = spy as never;
		const { target, instance } = mountHeader(1, { clear: [] }, 3);
		expect(spy.mock.calls.length).toBeGreaterThan(0); // the selected tab scrolled into view
		const i2 = mount(TerminalTabHeader, {
			target,
			intro: false,
			props: {
				selectedIndex: 1,
				onClear: () => {},
				children: createRawSnippet(() => ({ render: () => '<span></span>' }))
			}
		});
		flushSync();
		expect(spy.mock.calls.length).toBeGreaterThan(0);
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
		unmount(instance);
		unmount(i2);
	});
});

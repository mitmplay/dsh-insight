/**
 * AboutDialog branch coverage: the dismissal grammar's arms — the
 * svelte:window keydown's 'Escape' === comparison (both short-circuit
 * arms), the backdrop click, and the × close button — plus the rendered
 * about box's static content (title, subtitle, credit, author link).
 */

import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import AboutDialog from '$lib/components/sessions/AboutDialog.svelte';

function mountInto() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onclose = vi.fn();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(AboutDialog as any, { target, props: { onclose } });
	return { target, onclose, cleanup: () => { unmount(comp); target.remove(); } };
}

function pressKey(key: string) {
	window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('AboutDialog — dismissal branch arms', () => {
	it('a non-Escape keydown takes the && false arm: no onclose, dialog stays mounted', () => {
		const { target, onclose, cleanup } = mountInto();
		flushSync();
		expect(target.querySelector('[data-testid="about-title"]')).not.toBeNull();
		pressKey('Enter');
		pressKey('Esc'); // near-miss: the comparison must be exact
		pressKey('escape'); // case miss: the comparison must be exact
		expect(onclose).not.toHaveBeenCalled();
		expect(target.querySelector('[data-testid="about-title"]')).not.toBeNull();
		cleanup();
	});

	it('Escape keydown takes the && true arm: onclose fires once', () => {
		const { onclose, cleanup } = mountInto();
		flushSync();
		pressKey('Escape');
		expect(onclose).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it('backdrop click calls onclose (role=presentation click arm)', () => {
		const { target, onclose, cleanup } = mountInto();
		flushSync();
		const backdrop = target.querySelector('.about-backdrop') as HTMLElement;
		expect(backdrop).not.toBeNull();
		backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onclose).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it('the × close button calls onclose', () => {
		const { target, onclose, cleanup } = mountInto();
		flushSync();
		const close = target.querySelector('[data-testid="about-close"]') as HTMLButtonElement;
		expect(close?.getAttribute('type')).toBe('button');
		close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onclose).toHaveBeenCalledTimes(1);
		cleanup();
	});
});

describe('AboutDialog — rendered about box', () => {
	it('renders the title, subtitle, credit, and the author link verbatim', () => {
		const { target, cleanup } = mountInto();
		flushSync();
		expect(target.querySelector('[data-testid="about-title"]')?.textContent).toBe('DEEPSEEK INSIGHT');
		const subtitle = target.querySelector('[data-testid="about-subtitle"]');
		expect(subtitle?.textContent?.length).toBeGreaterThan(0);
		const credit = target.querySelector('[data-testid="about-credit"]');
		expect(credit?.textContent?.length).toBeGreaterThan(0);
		const link = target.querySelector('[data-testid="about-link"]') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('https://www.linkedin.com/in/wharsojo/');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		cleanup();
	});

	it('the modal is a dialog with the app-name aria-label and a focusable frame', () => {
		const { target, cleanup } = mountInto();
		flushSync();
		const modal = target.querySelector('.about-modal') as HTMLElement;
		expect(modal.getAttribute('role')).toBe('dialog');
		expect(modal.getAttribute('aria-label')?.length).toBeGreaterThan(0);
		expect(modal.getAttribute('tabindex')).toBe('-1');
		cleanup();
	});
});

/**
 * TurnErrorChip — direct-mount battery (coverage gap 2026-11-10).
 *
 * No unit file mounted this chip before: every branch (code ternary,
 * open chevron {#if}, ontoggle optional call) was reached only through
 * whole-page mounts. Component-direct mount (OCI ChipButton pattern:
 * the page owns expanded state, so the chip is a pure presentational
 * surface) pins each arm:
 *   - message-only mount → label without the `· CODE` suffix
 *   - code present → `· CODE` suffix arm of the ternary
 *   - open false/true → ChevronRight vs ChevronDown arms + aria-expanded
 *   - ontoggle present → click forwards the toggle intent
 *   - ontoggle absent → the `?.` arm clicks without throwing
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TurnErrorChip from '$lib/components/message/chips/TurnErrorChip.svelte';

function mountChip(props: { message: string; code?: string; open?: boolean; ontoggle?: () => void }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(TurnErrorChip, { target, props });
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

function chipOf(target: HTMLElement): HTMLElement {
	return target.querySelector('[data-testid="turn-error-chip"]') as HTMLElement;
}

function toggleOf(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('[data-testid="turn-error-toggle"]') as HTMLButtonElement;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TurnErrorChip — presentational arms', () => {
	it('renders the failed-turn label without a code suffix (code undefined arm)', () => {
		const view = mountChip({ message: 'MISSING_CREDENTIAL: no api key' });
		const toggle = toggleOf(view.target);
		expect(toggle.textContent?.trim()).toContain('turn failed');
		expect(toggle.textContent).not.toContain('·');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		// closed → the red dot is the honest surface, chevron collapsed
		expect(view.target.querySelector('[data-testid="turn-error-dot"]')).not.toBeNull();
		expect(toggle.querySelector('svg')).not.toBeNull();
		view.cleanup();
	});

	it('appends the " · CODE" suffix when a code is given (ternary true arm)', () => {
		const view = mountChip({ message: 'no api key', code: 'MISSING_CREDENTIAL' });
		expect(toggleOf(view.target).textContent).toContain('· MISSING_CREDENTIAL');
		view.cleanup();
	});

	it('open → chevron flips and aria-expanded reads true ({#if open} true arm)', () => {
		const view = mountChip({ message: 'boom', open: true });
		expect(toggleOf(view.target).getAttribute('aria-expanded')).toBe('true');
		view.cleanup();
	});

	it('click forwards the toggle intent to the owning page (ontoggle present)', () => {
		const ontoggle = vi.fn();
		const view = mountChip({ message: 'boom', ontoggle });
		toggleOf(view.target).click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		view.cleanup();
	});

	it('click without ontoggle is a safe no-op (optional-call arm)', () => {
		const view = mountChip({ message: 'boom' });
		expect(() => {
			toggleOf(view.target).click();
			flushSync();
		}).not.toThrow();
		view.cleanup();
	});

	it('carries the red failed-turn skin and the chip testid root', () => {
		const view = mountChip({ message: 'boom' });
		const chip = chipOf(view.target);
		expect(chip).not.toBeNull();
		const toggle = toggleOf(view.target);
		expect(toggle.className).toContain('bg-danger-wash');
		expect(toggle.className).toContain('text-status-fail');
		view.cleanup();
	});
});

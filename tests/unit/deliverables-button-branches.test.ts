/**
 * DeliverablesButton BRANCH coverage (ADR-0027f D2/D3): exercises every
 * conditional the component owns that deliverables-button.test.ts does not
 * reach — the undefined-deliveries arm of the null-safe gate, the
 * non-primary-button pointerdown guard, the press toggle (open AND close),
 * the keyboard click arm (detail === 0) and its real-mouse exclusion
 * (detail > 0 must NOT toggle).
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import DeliverablesButton from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesButton.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

function mountButton(deliveries: PresentedDelivery[] | null | undefined) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DeliverablesButton, { target, props: { deliveries } });
	flushSync();
	return { target, instance };
}

const FIXTURE: PresentedDelivery[] = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/a.md' }] }
];

function button(target: HTMLElement) {
	return target.querySelector('[data-testid="deliverables-button"]') as HTMLButtonElement;
}

describe('DeliverablesButton branches', () => {
	it('undefined deliveries also render nothing (the ?? arm)', () => {
		const { target, instance } = mountButton(undefined);
		expect(button(target)).toBeNull();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		unmount(instance);
	});

	it('non-primary pointerdown (button !== 0) does NOT toggle', () => {
		const { target, instance } = mountButton(FIXTURE);
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		button(target).dispatchEvent(
			new PointerEvent('pointerdown', { button: 2, bubbles: true })
		);
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		unmount(instance);
	});

	it('primary pointerdown toggles open, second press toggles closed', () => {
		const { target, instance } = mountButton(FIXTURE);
		const b = button(target);
		b.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).not.toBeNull();
		expect(b.classList.contains('active')).toBe(true);
		// second press → toggle off
		b.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		expect(b.classList.contains('active')).toBe(false);
		unmount(instance);
	});

	it('keyboard activation (click with detail === 0) toggles open', () => {
		const { target, instance } = mountButton(FIXTURE);
		const b = button(target);
		b.click(); // happy-dom click() → detail 0, the Enter/Space arm
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).not.toBeNull();
		unmount(instance);
	});

	it('a real-mouse click (detail > 0) does NOT toggle', () => {
		const { target, instance } = mountButton(FIXTURE);
		const b = button(target);
		b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		unmount(instance);
	});
});

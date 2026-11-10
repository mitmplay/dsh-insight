/**
 * TurnErrorChip — the compiler's nullish fallback arm on the
 * `{t(m.turnFailed)}` interpolation (coverage mop 2026-11-10).
 *
 * t() returns a string in every real locale, so the compiled
 * `t(...) ?? ''` fallback arm is unreachable in production. This file
 * mocks the locale seam to yield a nullish message and pins that the
 * chip still renders (empty label, red skin intact) when a catalog
 * key ever goes missing — the arm the direct-mount battery in
 * turn-error-chip.test.ts cannot reach.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/locale/locale-state.svelte', () => ({
	// pass the (undefined) message straight through → nullish
	t: (msg: unknown) => msg as string | undefined
}));
vi.mock('$lib/paraglide/messages', () => ({
	turnFailed: undefined
}));

const { default: TurnErrorChip } = await import('$lib/components/message/chips/TurnErrorChip.svelte');

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

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TurnErrorChip — missing i18n key rides the compiler fallback arm', () => {
	it('renders the chip with an empty label and no crash when t() is nullish', () => {
		const view = mountChip({ message: 'boom', code: 'MISSING_CREDENTIAL' });
		const toggle = view.target.querySelector('[data-testid="turn-error-toggle"]') as HTMLButtonElement;
		expect(toggle).not.toBeNull();
		// the code suffix arm still renders its own text node
		expect(toggle.textContent).toContain('· MISSING_CREDENTIAL');
		// the interpolation fallback produced nothing before it
		expect(toggle.textContent?.trim().startsWith('·')).toBe(true);
		expect(toggle.className).toContain('bg-danger-wash');
		view.cleanup();
	});
});

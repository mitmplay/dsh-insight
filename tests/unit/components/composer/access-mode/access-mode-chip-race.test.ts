/**
 * AccessModeChip mid-mount fold + race edges (complements
 * access-mode-chip.test.ts): the R5 confirm $effect firing in place via a
 * $state permission the test mutates, the confirm timer being cleared by
 * that fold (no stale not-confirmed error), and the timeout landing with
 * the read state moved elsewhere. The remaining guards (`picking !== null ||
 * disabled` in submit, `picking === preset` false arms) are UI-unreachable:
 * every submit entry point is behind disabled controls while a pick is in
 * flight, and a pick is only ever cleared by the same preset's own path.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import AccessModeChip from '$lib/components/composer/access-mode/AccessModeChip.svelte';
import { makePerm } from './_perm.svelte.ts';

function mountChip(perm: ReturnType<typeof makePerm>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpick = vi.fn(async () => true);
	const comp = mount(AccessModeChip, { target, props: { permission: perm, onpick } });
	return { target, onpick, cleanup: () => { unmount(comp); target.remove(); } };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

async function pickReadOnly(target: HTMLElement): Promise<void> {
	(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
	await settle();
	(target.querySelector('[data-testid="access-mode-option"][data-value="read-only"]') as HTMLButtonElement).click();
	await settle();
}

describe('AccessModeChip — the R5 fold confirming mid-mount (RCA fix C)', () => {
	it('a poll fold that catches up IN PLACE clears the pick, the menu, and the confirm timer', async () => {
		vi.useFakeTimers();
		try {
			const perm = makePerm('workspace-write');
			const { target, cleanup } = mountChip(perm);
			await pickReadOnly(target);
			// Optimistic: locked + pending, waiting on the fold.
			let chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(chip.disabled).toBe(true);
			expect(target.querySelector('[data-testid="access-mode-pending"]')).not.toBeNull();

			// The poll's fold arrives — the SAME permission object moves.
			perm.current = 'read-only';
			await settle();
			chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(chip.disabled).toBe(false); // unlocked by the fold, not a remount
			expect(target.querySelector('[data-testid="access-mode-pending"]')).toBeNull();
			expect(target.querySelector('[data-testid="access-mode-error"]')).toBeNull();

			// The confirm timer was cleared by the fold — advancing past its
			// deadline stacks NO stale not-confirmed error on the truth.
			vi.advanceTimersByTime(30_000);
			await settle();
			expect(target.querySelector('[data-testid="access-mode-error"]')).toBeNull();
			cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('the read state moving to a DIFFERENT preset leaves the pick pending until the timeout', async () => {
		vi.useFakeTimers();
		try {
			const perm = makePerm('workspace-write');
			const { target, cleanup } = mountChip(perm);
			await pickReadOnly(target);
			// The host's read state jumps somewhere else entirely — the fold
			// does NOT match the pick, so the optimistic wait continues.
			perm.current = 'danger-full-access';
			await settle();
			let chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(chip.disabled).toBe(true); // still honestly waiting
			expect(target.querySelector('[data-testid="access-mode-error"]')).toBeNull();

			// Deadline passes: the honest not-confirmed receipt clears the pick.
			vi.advanceTimersByTime(12_000);
			await settle();
			chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(chip.disabled).toBe(false);
			expect(target.querySelector('[data-testid="access-mode-error"]')?.textContent).toContain('not confirmed');
			cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

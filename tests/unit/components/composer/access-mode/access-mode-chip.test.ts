/**
 * AccessModeChip tests (ADR-0007, 2026-08-25): the footer's access chip —
 * read state render (aria/label parity with DSH), the menu (custom never
 * switchable), optimistic pick + poll-fold confirmation (R5), and the
 * Full access risk gate (R7 — acknowledged before enable, cancel/Escape
 * submit nothing; 2026-09 placement: the gate portals to document.body
 * and its card centers on the focused panel's column).
 */
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import AccessModeChip from '$lib/components/composer/access-mode/AccessModeChip.svelte';
import { localPermission, type DsiPermission } from '$lib/services/conversation/permission-state';

function permissionWith(current: string): DsiPermission {
	return { ...localPermission(), current };
}

function mountChip(props: Partial<ComponentProps<typeof AccessModeChip>> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpick = vi.fn(async () => true);
	const comp = mount(AccessModeChip, {
		target,
		props: { permission: permissionWith('workspace-write'), onpick, ...props }
	});
	return { target, onpick, cleanup: () => { unmount(comp); target.remove(); } };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

describe('AccessModeChip — read state', () => {
	it('hides entirely without permission (permission-less host)', () => {
		const { target, cleanup } = mountChip({ permission: null });
		expect(target.querySelector('[data-testid="access-mode-chip"]')).toBeNull();
		cleanup();
	});

	it('renders the current label + the DSH aria string; custom reads Custom', () => {
		const { target, cleanup } = mountChip();
		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLElement;
		expect(chip.textContent).toContain('Workspace Write');
		expect(chip.getAttribute('aria-label')).toBe('Access mode, current: Workspace Write');
		cleanup();

		const custom = mountChip({ permission: permissionWith('custom') });
		const customChip = custom.target.querySelector('[data-testid="access-mode-chip"]') as HTMLElement;
		expect(customChip.getAttribute('aria-label')).toBe('Access mode, current: Custom');
		expect(customChip.textContent).toContain('Custom');
		custom.cleanup();
	});

	it('Full access renders the pinned product label, not the machine name', () => {
		const { target, cleanup } = mountChip({ permission: permissionWith('danger-full-access') });
		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLElement;
		expect(chip.textContent).toContain('Full access');
		expect(chip.textContent).not.toContain('danger-full-access');
		cleanup();
	});
});

describe('AccessModeChip — menu + pick (R5)', () => {
	it('the menu lists the presets; custom is never among them', async () => {
		const { target, cleanup } = mountChip();
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		const options = [...target.querySelectorAll('[data-testid="access-mode-option"]')];
		expect(options.map((o) => o.getAttribute('data-value'))).toEqual([
			'read-only',
			'workspace-write',
			'danger-full-access'
		]);
		// current carries the selected marker
		expect(options[1].getAttribute('aria-selected')).toBe('true');
		cleanup();
	});

	it('a safe pick submits once, shows the optimistic label, and clears when the fold confirms', async () => {
		const { target, onpick, cleanup } = mountChip();
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="read-only"]') as HTMLButtonElement).click();
		await settle();
		expect(onpick).toHaveBeenCalledWith('read-only');

		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		expect(chip.textContent).toContain('Read Only'); // optimistic label
		expect(chip.disabled).toBe(true); // disabled until the poll confirms
		expect(target.querySelector('[data-testid="access-mode-pending"]')).not.toBeNull();

		// the poll's fold confirms — but the PROP must move (component-owned
		// confirmation): remount with the new read state and the chip re-enables.
		cleanup();
		const confirmed = mountChip({ permission: permissionWith('read-only') });
		const confirmedChip = confirmed.target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		expect(confirmedChip.disabled).toBe(false);
		expect(confirmedChip.textContent).toContain('Read Only');
		confirmed.cleanup();
	});

	it('a failed POST clears the optimistic pick and surfaces the error', async () => {
		const { target, cleanup } = mountChip({ onpick: async () => false });
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="read-only"]') as HTMLButtonElement).click();
		await settle();
		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		expect(chip.disabled).toBe(false); // unlocked again
		expect(chip.textContent).toContain('Workspace Write'); // honest fallback
		expect(target.querySelector('[data-testid="access-mode-error"]')?.textContent).toContain('switch failed');
		cleanup();
	});

	it('picking the current preset submits nothing', async () => {
		const { target, onpick, cleanup } = mountChip();
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="workspace-write"]') as HTMLButtonElement).click();
		await settle();
		expect(onpick).not.toHaveBeenCalled();
		cleanup();
	});
});

describe('AccessModeChip — the Full access risk gate (R7)', () => {
	async function openGate(target: HTMLElement): Promise<void> {
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="danger-full-access"]') as HTMLButtonElement).click();
		await settle();
	}

	/** The dialog lives in the document.body portal (BC-7), not in target. */
	function dialogOf(): HTMLElement | null {
		return document.body.querySelector('[data-testid="access-mode-confirm"]');
	}

	it('Full access opens the confirmation instead of submitting; Enable stays disabled until acknowledged', async () => {
		const { target, onpick, cleanup } = mountChip();
		await openGate(target);
		expect(onpick).not.toHaveBeenCalled();
		expect(target.querySelector('[data-testid="access-mode-confirm"]')).toBeNull(); // portaled out
		const dialog = dialogOf() as HTMLElement;
		expect(dialog).not.toBeNull();
		const enable = document.body.querySelector('[data-testid="access-mode-enable"]') as HTMLButtonElement;
		expect(enable.disabled).toBe(true);

		(document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement).click();
		await settle();
		expect(enable.disabled).toBe(false);

		enable.click();
		await settle();
		expect(onpick).toHaveBeenCalledWith('danger-full-access');
		expect(dialogOf()).toBeNull(); // gate closed — portal cleanup
		cleanup();
	});

	it('Cancel submits nothing and resets the acknowledgement', async () => {
		const { target, onpick, cleanup } = mountChip();
		await openGate(target);
		(document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement).click();
		await settle();
		(document.body.querySelector('[data-testid="access-mode-cancel"]') as HTMLButtonElement).click();
		await settle();
		expect(onpick).not.toHaveBeenCalled();
		expect(dialogOf()).toBeNull();
		expect(target.querySelector('[data-testid="access-mode-chip"]')).not.toBeNull(); // chip unchanged
		cleanup();
	});

	it('the mask click submits nothing (declined risk leaves no residue)', async () => {
		const { target, onpick, cleanup } = mountChip();
		await openGate(target);
		const mask = dialogOf() as HTMLElement;
		mask.click(); // click lands on the backdrop itself
		await settle();
		expect(onpick).not.toHaveBeenCalled();
		expect(dialogOf()).toBeNull();
		cleanup();
	});
});

describe('AccessModeChip — R7 dialog placement (2026-09: centered on the focused panel)', () => {
	interface Rect {
		left: number;
		top: number;
		right: number;
		bottom: number;
	}

	/** Mount the chip inside a fake floor column and fake its geometry. */
	function mountInColumn(className: string, rect: Rect) {
		const host = document.createElement('div');
		host.className = className;
		document.body.appendChild(host);
		const mounted = mountChip();
		host.appendChild(mounted.target);
		vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
			...rect,
			width: rect.right - rect.left,
			height: rect.bottom - rect.top,
			x: rect.left,
			y: rect.top,
			toJSON: () => rect
		} as DOMRect);
		return { ...mounted, host };
	}

	async function openGate(mounted: { target: HTMLElement }): Promise<void> {
		(mounted.target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(mounted.target.querySelector('[data-testid="access-mode-option"][data-value="danger-full-access"]') as HTMLButtonElement).click();
		await settle();
	}

	function cardStyle(): CSSStyleDeclaration {
		const card = document.body.querySelector('[data-testid="access-mode-confirm"] > div') as HTMLElement;
		return card.style;
	}

	it('the dialog portals to document.body and its card centers on the focused column', async () => {
		const { target, cleanup, host } = mountInColumn('column selected', {
			left: 500,
			top: 0,
			right: 600,
			bottom: 500
		});
		await openGate({ target });
		expect(document.body.querySelector('[data-testid="access-mode-confirm"]')).not.toBeNull();
		// Column center: ((500 + 600) / 2, (0 + 500) / 2) — on-screen, unclamped.
		expect(cardStyle().left).toBe('550px');
		expect(cardStyle().top).toBe('250px');
		(document.body.querySelector('[data-testid="access-mode-cancel"]') as HTMLButtonElement).click();
		await settle();
		expect(document.body.querySelector('[data-testid="access-mode-confirm"]')).toBeNull(); // portal cleanup
		cleanup();
		host.remove();
	});

	it('a column centered off-screen clamps the card into the viewport', async () => {
		const { target, cleanup, host } = mountInColumn('column selected', {
			left: 5000,
			top: 2000,
			right: 5100,
			bottom: 3000
		});
		await openGate({ target });
		// Center (5050, 2500) clamps to (innerWidth − 200, innerHeight − 140).
		expect(cardStyle().left).toBe(`${window.innerWidth - 200}px`);
		expect(cardStyle().top).toBe(`${window.innerHeight - 140}px`);
		cleanup();
		host.remove();
	});

	it('an unfocused column still anchors (any .column ancestor), clamped from the off side', async () => {
		const { target, cleanup, host } = mountInColumn('column', {
			left: -1000,
			top: -1000,
			right: -900,
			bottom: -900
		});
		await openGate({ target });
		// Center (−950, −950) clamps to (200, 140).
		expect(cardStyle().left).toBe('200px');
		expect(cardStyle().top).toBe('140px');
		cleanup();
		host.remove();
	});

	it('without a column ancestor the card centers on the viewport (fallback)', async () => {
		const { target, cleanup } = mountChip();
		await openGate({ target });
		expect(cardStyle().left).toBe(`${window.innerWidth / 2}px`);
		expect(cardStyle().top).toBe(`${window.innerHeight / 2}px`);
		cleanup();
	});

	it('Escape on the focused mask closes the gate', async () => {
		const { target, onpick, cleanup } = mountChip();
		await openGate({ target });
		const mask = document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement;
		// Real keydowns bubble to Svelte's delegated listener; the synthetic one must too.
		mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();
		expect(onpick).not.toHaveBeenCalled();
		expect(document.body.querySelector('[data-testid="access-mode-confirm"]')).toBeNull();
		cleanup();
	});
});

describe('AccessModeChip — honest receipts (2026-08-25 RCA fix C)', () => {
	it('a successful POST whose confirmation never arrives times out honestly (no infinite "switching…")', async () => {
		vi.useFakeTimers();
		try {
			const { target, cleanup } = mountChip();
			(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
			await settle();
			(target.querySelector('[data-testid="access-mode-option"][data-value="read-only"]') as HTMLButtonElement).click();
			await settle();
			// POST succeeded; the fold has NOT confirmed — the chip waits.
			const waiting = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(waiting.disabled).toBe(true);
			expect(target.querySelector('[data-testid="access-mode-pending"]')).not.toBeNull();

			vi.advanceTimersByTime(12_000);
			await settle();

			const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(chip.disabled).toBe(false); // unlocked — no infinite switch
			expect(chip.textContent).toContain('Workspace Write'); // honest read state
			expect(target.querySelector('[data-testid="access-mode-error"]')?.textContent).toContain('not confirmed');
			cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('the timeout clears when the fold confirms in time (no stale error)', async () => {
		vi.useFakeTimers();
		try {
			const { target, cleanup } = mountChip();
			(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
			await settle();
			(target.querySelector('[data-testid="access-mode-option"][data-value="read-only"]') as HTMLButtonElement).click();
			await settle();
			vi.advanceTimersByTime(11_000); // just inside the window
			const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
			expect(chip.disabled).toBe(true); // still honestly waiting
			expect(target.querySelector('[data-testid="access-mode-error"]')).toBeNull();
			cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('AccessModeChip — dismissal contract (spec 2026-11-01)', () => {
	/** A pointerdown on an element that is NOT inside the widget. */
	function outsidePointerDown(): void {
		const stranger = document.createElement('button');
		document.body.appendChild(stranger);
		stranger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		stranger.remove();
	}

	it('outside pointerdown closes the menu', async () => {
		const { target, cleanup } = mountChip();
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('[data-testid="access-mode-menu"]')).not.toBeNull();
		outsidePointerDown();
		await settle();
		expect(target.querySelector('[data-testid="access-mode-menu"]')).toBeNull();
		cleanup();
	});

	it('Escape closes the menu and returns focus to the trigger', async () => {
		const { target, cleanup } = mountChip();
		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		chip.click();
		await settle();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();
		expect(target.querySelector('[data-testid="access-mode-menu"]')).toBeNull();
		expect(document.activeElement).toBe(chip);
		cleanup();
	});

	it('a pointerdown inside the menu does NOT dismiss (picks still land)', async () => {
		const { target, onpick, cleanup } = mountChip();
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		const opt = target.querySelector('[data-testid="access-mode-option"][data-value="read-only"]') as HTMLButtonElement;
		opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await settle();
		expect(target.querySelector('[data-testid="access-mode-menu"]')).not.toBeNull();
		expect(onpick).not.toHaveBeenCalled(); // pointerdown alone never picks
		cleanup();
	});

	it('closed widget carries no live listeners (no crash on stray outside click)', async () => {
		const { target, cleanup } = mountChip();
		outsidePointerDown();
		await settle();
		expect(target.querySelector('[data-testid="access-mode-menu"]')).toBeNull();
		cleanup();
	});
});


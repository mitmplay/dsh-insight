/**
 * PlanModeChip unit tests — the plan-mode pill (2026-08-31, extracted
 * from ToolsAndStatusHeader 2026-09-01): renders while the host's plan
 * projection is ACTIVE, marks an unconfirmed /plan switch with the
 * pending ellipsis, and hides itself otherwise. The accessible name
 * carries the full state (the "…" is visual-only), and the surface/ink
 * token pair stays the measured 5.36:1 contrast pairing.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import PlanModeChip from '../../src/lib/components/conversation/header/PlanModeChip.svelte';

function mountChip(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PlanModeChip, { target, props: props as never });
	flushSync();
	return { target, instance };
}

describe('PlanModeChip — the plan-mode pill', () => {
	it('renders while plan mode is active; pending adds the ellipsis', () => {
		const { target, instance } = mountChip({ plan: { active: true, pending: false } });
		const chip = target.querySelector('[data-testid="plan-mode-chip"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent?.trim()).toBe('plan mode');
		unmount(instance);

		const p = mountChip({ plan: { active: true, pending: true } });
		expect(p.target.querySelector('[data-testid="plan-mode-chip"]')?.textContent?.trim()).toBe('plan mode…');
		unmount(p.instance);
	});

	it('exposes the full state as a polite live-region name, not just the visible ellipsis', () => {
		const { target, instance } = mountChip({ plan: { active: true, pending: false } });
		const chip = target.querySelector('[data-testid="plan-mode-chip"]');
		expect(chip?.getAttribute('role')).toBe('status');
		expect(chip?.getAttribute('aria-label')).toBe('plan mode active — the agent plans before writing');
		expect(chip?.getAttribute('title')).toBe('plan mode active — the agent plans before writing');
		unmount(instance);

		const p = mountChip({ plan: { active: true, pending: true } });
		const pendingChip = p.target.querySelector('[data-testid="plan-mode-chip"]');
		expect(pendingChip?.getAttribute('aria-label')).toBe('plan mode — /plan switch in progress');
		unmount(p.instance);
	});

	it('keeps the measured surface/ink pair (5.36:1, WCAG AA at text-xs)', () => {
		const { target, instance } = mountChip({ plan: { active: true, pending: false } });
		const chip = target.querySelector('[data-testid="plan-mode-chip"]');
		expect(chip?.className).toContain('bg-accent-purple-soft');
		expect(chip?.className).toContain('text-accent-purple-ink');
		const dot = chip?.querySelector('span[aria-hidden="true"]');
		expect(dot?.className).toContain('bg-accent-purple-ink');
		unmount(instance);
	});

	it('hidden when inactive or not delivered', () => {
		const a = mountChip({ plan: { active: false, pending: false } });
		expect(a.target.querySelector('[data-testid="plan-mode-chip"]')).toBeNull();
		unmount(a.instance);
		const b = mountChip({});
		expect(b.target.querySelector('[data-testid="plan-mode-chip"]')).toBeNull();
		unmount(b.instance);
	});
});

/**
 * ToolsAndStatusHeader unit tests — the plan-mode pill (2026-08-31):
 * renders while the host's plan projection is ACTIVE, marks an unconfirmed
 * /plan switch with the pending ellipsis, and hides otherwise.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import ToolsAndStatusHeader from '../../src/lib/components/conversation/header/ToolsAndStatusHeader.svelte';

function mountHeader(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ToolsAndStatusHeader, {
		target,
		props: { agent: null, isStreaming: false, ...props } as never
	});
	flushSync();
	return { target, instance };
}

describe('ToolsAndStatusHeader — the plan-mode pill', () => {
	it('renders while plan mode is active; pending adds the ellipsis', () => {
		const { target, instance } = mountHeader({ plan: { active: true, pending: false } });
		const chip = target.querySelector('[data-testid="plan-mode-chip"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent?.trim()).toBe('plan mode');
		unmount(instance);

		const p = mountHeader({ plan: { active: true, pending: true } });
		expect(p.target.querySelector('[data-testid="plan-mode-chip"]')?.textContent?.trim()).toBe('plan mode…');
		unmount(p.instance);
	});

	it('hidden when inactive or not delivered', () => {
		const a = mountHeader({ plan: { active: false, pending: false } });
		expect(a.target.querySelector('[data-testid="plan-mode-chip"]')).toBeNull();
		unmount(a.instance);
		const b = mountHeader({});
		expect(b.target.querySelector('[data-testid="plan-mode-chip"]')).toBeNull();
		unmount(b.instance);
	});
});

describe('ToolsAndStatusHeader — the parent button (2026-09-01)', () => {
	it('renders BEFORE the agent chip when the session has a fork parent', () => {
		const { target, instance } = mountHeader({
			agent: 'app-dev',
			parentSessionId: 'session-parent'
		});
		const cluster = target.querySelector('.ml-auto')!;
		const children = Array.from(cluster.children);
		const btn = cluster.querySelector('[data-testid="parent-button"]')!;
		const chip = cluster.querySelector('[data-testid="agent-chip"]')!;
		expect(children.indexOf(btn)).toBeLessThan(children.indexOf(chip));
		expect(btn.getAttribute('disabled')).toBeNull(); // parent off-floor default
		unmount(instance);
	});

	it('renders nothing on a root session (no parent, no jump)', () => {
		const { target, instance } = mountHeader({ agent: 'app-dev', parentSessionId: null });
		expect(target.querySelector('[data-testid="parent-button"]')).toBeNull();
		unmount(instance);
	});
});

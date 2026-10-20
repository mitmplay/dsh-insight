/**
 * OpenParentButton — the off-floor fallback arms (parent-button.test.ts
 * pins the registry path): with no workspace state the button stays
 * enabled, a refused registry add falls back to the seed deep link, and
 * an accepted add navigates nowhere.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenParentButton from '$lib/components/conversation/header/OpenParentButton.svelte';
import {
	registerAddPanel,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

function mountButton(props: { parentSessionId: string | null }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(OpenParentButton, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	vi.restoreAllMocks();
	resetPanelRegistryForTests();
	setWorkspaceState(null);
});

describe('OpenParentButton — off-floor fallback', () => {
	it('no workspace state at all still leaves the button enabled', () => {
		const { target, instance } = mountButton({ parentSessionId: 'session-parent' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="parent-button"]')!;
		expect(btn.disabled).toBe(false);
		unmount(instance);
	});

	it('with no floor mounted (no registry handler), click navigates to the seed deep link', () => {
		// addPanelFromSidebar returns false only when no handler is
		// registered — the handler's own return value is discarded.
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const { target, instance } = mountButton({ parentSessionId: 'session-parent' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="parent-button"]')!;
		btn.click();
		flushSync();
		expect(assign).toHaveBeenCalledTimes(1);
		expect(assign).toHaveBeenCalledWith('/?sessionKey=session-parent');
		unmount(instance);
	});

	it('a registered registry add never navigates (its return value is not consulted)', () => {
		registerAddPanel(() => true);
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const { target, instance } = mountButton({ parentSessionId: 'session-parent' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="parent-button"]')!;
		btn.click();
		flushSync();
		expect(assign).not.toHaveBeenCalled();
		unmount(instance);
	});
});

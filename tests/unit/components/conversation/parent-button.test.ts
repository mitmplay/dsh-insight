/**
 * OpenParentButton unit tests — the header's jump back to the fork
 * source (2026-09-01): hidden on roots, enabled while the parent is
 * off-floor (click adds it through the registry), gray + DISABLED once
 * the parent already holds a panel.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenParentButton from '$lib/components/conversation/header/OpenParentButton.svelte';
import { registerAddPanel, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import {
	setWorkspaceState,
	type PanelRow,
	type WorkspaceState
} from '$lib/services/conversation/workspace-context.svelte';
import type { DsiPanelEntry } from '$lib/types';

function panel(id: string, sessionId: string): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width: 730 };
}

function row(p: DsiPanelEntry): PanelRow {
	return { panel: p, title: null, workspace: null, dead: false, running: false };
}

function publishState(rows: PanelRow[]): void {
	const state: WorkspaceState = {
		rows,
		selectedPanelId: rows[0]?.panel.id ?? null,
		profile: null,
		select: () => {},
		remove: () => {}
	};
	setWorkspaceState(state);
}

function mountButton(props: { parentSessionId: string | null }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(OpenParentButton, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	resetPanelRegistryForTests();
	setWorkspaceState(null);
});

describe('OpenParentButton — the jump back to the fork source', () => {
	it('renders nothing when the session has no parent (a root)', () => {
		const { target, instance } = mountButton({ parentSessionId: null });
		expect(target.querySelector('[data-testid="parent-button"]')).toBeNull();
		unmount(instance);
	});

	it('enabled while the parent holds no panel; click adds it through the registry', () => {
		publishState([row(panel('p-child', 'session-child'))]); // parent NOT on the floor
		const add = vi.fn();
		registerAddPanel(add);
		const { target, instance } = mountButton({ parentSessionId: 'session-parent' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="parent-button"]')!;
		expect(btn.disabled).toBe(false);
		btn.click();
		flushSync();
		expect(add).toHaveBeenCalledWith({ sessionId: 'session-parent', agentPreset: null, focus: true });
		unmount(instance);
	});

	it('gray + DISABLED once the parent already holds a panel; click is a no-op', () => {
		publishState([
			row(panel('p-parent', 'session-parent')),
			row(panel('p-child', 'session-child'))
		]);
		const add = vi.fn();
		registerAddPanel(add);
		const { target, instance } = mountButton({ parentSessionId: 'session-parent' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="parent-button"]')!;
		expect(btn.disabled).toBe(true);
		expect(btn.className).toContain('text-text-muted'); // the gray parked state
		expect(btn.getAttribute('title')).toBe('Parent session is already open');
		btn.click();
		flushSync();
		expect(add).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('a DIFFERENT session open on the floor does not park the button', () => {
		publishState([row(panel('p-other', 'session-stranger'))]);
		const { target, instance } = mountButton({ parentSessionId: 'session-parent' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="parent-button"]')!;
		expect(btn.disabled).toBe(false);
		unmount(instance);
	});
});

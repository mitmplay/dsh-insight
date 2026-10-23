/**
 * RowSessionItem × rowTitle() branches (cluster T1, lines 65-70) — the
 * tooltip contract pin: off the floor the raw workspace path stands alone
 * (undefined when the session owns no workspace); on the floor the path is
 * EXTENDED, never replaced (commitment 5), and a workspace-less row still
 * carries the Shift+click affordance by itself.
 * Spec: Panel Floor W4 4.2 — discoverable floor verb.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

// The floor-mounted fact is controlled per test through this mutable
// holder — panelRegistryActive is read at MOUNT time (a row attribute,
// not reactive), so each case mounts its own row.
const floor = vi.hoisted(() => ({ active: false }));

vi.mock('$lib/services/panels/panel-registry', () => ({
	panelRegistryActive: () => floor.active,
	// The row's click verbs — never invoked by these tests; stubs keep the
	// module surface complete for the component's import.
	addPanelFromSidebar: () => false,
	replaceSelectedFromRegistry: () => false,
	summonGlassFromRegistry: () => false
}));

import RowSessionItem from '../../src/lib/components/sessions/RowSessionItem.svelte';

function summary(over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
	return {
		sessionId: 's-title',
		title: 'Title session',
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId: null,
		origin: 'user',
		agentPreset: null,
		...over
	} as DsiSessionSummary;
}

const NO_WORKSPACES: DsiWorkspaceSummary[] = [];

function mountRow(session: DsiSessionSummary) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(RowSessionItem, {
		target,
		props: { session, workspaces: NO_WORKSPACES }
	});
	flushSync();
	return { target, instance };
}

function titleOf(target: HTMLElement): string | null {
	return target.querySelector('[data-testid="sidebar-session-card"]')?.getAttribute('title') ?? null;
}

afterEach(() => {
	floor.active = false;
});

describe('RowSessionItem rowTitle() branches', () => {
	it('off-floor with a workspace: title is the raw workspace path', () => {
		floor.active = false;
		const { target, instance } = mountRow(summary({ workspace: '/tmp/e2e-harness' }));
		expect(titleOf(target)).toBe('/tmp/e2e-harness');
		unmount(instance);
	});

	it('off-floor with no workspace: title attribute is absent (undefined arm)', () => {
		floor.active = false;
		const { target, instance } = mountRow(summary({ workspace: null }));
		expect(titleOf(target)).toBeNull();
		unmount(instance);
	});

	it('on-floor with a workspace: path is EXTENDED with the Shift+click hint', () => {
		floor.active = true;
		const { target, instance } = mountRow(summary({ workspace: '/tmp/e2e-harness' }));
		expect(titleOf(target)).toBe('/tmp/e2e-harness — Shift+click to replace panel');
		unmount(instance);
	});

	it('on-floor with no workspace: the affordance hint stands alone', () => {
		floor.active = true;
		const { target, instance } = mountRow(summary({ workspace: null }));
		expect(titleOf(target)).toBe('Shift+click to replace panel');
		unmount(instance);
	});
});

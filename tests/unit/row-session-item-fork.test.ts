/**
 * RowSessionItem fork ternary (line 112) — the fork prop is
 * parentSessionId != null && origin !== 'subagent' && !isGlass.
 * Observed through WorkspaceRowItem's real render: with depth > 0 the
 * branch slot [data-testid="sidebar-workspace-branch"] carries class
 * "fork" exactly when the fork prop is true (WorkspaceRowItem.svelte
 * line 109 class:fork). No stubbing needed.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RowSessionItem from '../../src/lib/components/sessions/RowSessionItem.svelte';
import type { DsiSessionSummary } from '../../src/lib/types';

vi.stubGlobal('fetch', vi.fn(async () => ({
	ok: true,
	json: async () => ({ ok: true, jobs: [] })
})));

afterEach(() => {
	vi.unstubAllGlobals();
});

const workspaces: never[] = [];

function baseSession(overrides: Partial<DsiSessionSummary>): DsiSessionSummary {
	return {
		sessionId: 'conv-1',
		title: 'row',
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId: null,
		origin: 'user',
		agentPreset: null,
		...overrides
	} as DsiSessionSummary;
}

/** Mount with depth 1 so WorkspaceRowItem renders the branch slot that
 *  exposes the fork prop as the class:fork variant. */
function mountRow(session: DsiSessionSummary) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(RowSessionItem, {
		target,
		props: { session, workspaces, depth: 1 }
	});
	flushSync();
	const branch = target.querySelector('[data-testid="sidebar-workspace-branch"]') as HTMLElement;
	return { instance, target, branch };
}

describe('RowSessionItem fork ternary', () => {
	it('parentSessionId null → fork false (no fork class)', () => {
		const { instance, branch } = mountRow(baseSession({ parentSessionId: null, origin: 'user' }));
		expect(branch).not.toBeNull();
		expect(branch.classList.contains('fork')).toBe(false);
		unmount(instance);
	});

	it("parentSessionId set, origin 'subagent' → fork false", () => {
		const { instance, branch } = mountRow(
			baseSession({ parentSessionId: 'parent-1', origin: 'subagent' })
		);
		expect(branch.classList.contains('fork')).toBe(false);
		unmount(instance);
	});

	it("parentSessionId set, origin normal (not 'browser') → fork true", () => {
		const { instance, branch } = mountRow(
			baseSession({ parentSessionId: 'parent-1', origin: 'user' })
		);
		expect(branch.classList.contains('fork')).toBe(true);
		unmount(instance);
	});

	it("parentSessionId set, origin 'browser' (isGlass) → fork false", () => {
		const { instance, branch } = mountRow(
			baseSession({ parentSessionId: 'parent-1', origin: 'browser' })
		);
		expect(branch.classList.contains('fork')).toBe(false);
		unmount(instance);
	});

	it('parentSessionId undefined (missing) → fork false (the != null false arm)', () => {
		const { instance, branch } = mountRow(
			baseSession({ parentSessionId: undefined as unknown as null, origin: 'user' })
		);
		expect(branch.classList.contains('fork')).toBe(false);
		unmount(instance);
	});
});

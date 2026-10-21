/**
 * SidebarSessionsList unit tests — the empty states + row mapping.
 *
 * Component-direct mount (sidebar-session-container.test.ts pattern):
 * the list is purely presentational, so every behavior reads from the
 * DOM through its own and RowSessionItem's data-testids:
 *
 *  - empty state without a current session → "No sessions match."
 *  - empty state WITH a pinned current → "No other sessions match."
 *  - depthById default: rows mount WITHOUT the prop → depth 0
 *  - depthById supplied: the row's depth marker + interior indent change
 *  - one RowSessionItem per visible session, keyed by sessionId
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SidebarSessionsList from '$lib/components/sessions/SidebarSessionsList.svelte';
import { defaultSpineGroupPrefs } from '$lib/utils/spine-group-prefs';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

/** One summary row — the full DsiSessionSummary shape. */
function summary(
	sessionId: string,
	over: Partial<DsiSessionSummary> = {}
): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now(),
		workspace: '/tmp/e2e-harness',
		turns: null,
		...over
	};
}

const NO_WORKSPACES: DsiWorkspaceSummary[] = [];

function mountList(props: {
	current?: DsiSessionSummary | null;
	visible?: DsiSessionSummary[];
	depthById?: Record<string, number>;
	workspaces?: DsiWorkspaceSummary[];
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: props.current ?? null,
			visible: props.visible ?? [],
			...(props.depthById !== undefined ? { depthById: props.depthById } : {}),
			workspaces: props.workspaces ?? NO_WORKSPACES,
			spine: defaultSpineGroupPrefs()
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarSessionsList — empty states', () => {
	it('empty list, no current session: the "No sessions match." hint', () => {
		const { target, instance } = mountList({ visible: [] });
		const hint = target.querySelector('[data-testid="sidebar-sessions-empty"]');
		expect(hint).not.toBeNull();
		expect(hint?.textContent).toBe('No sessions match.');
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(0);
		unmount(instance);
	});

	it('empty list WITH a pinned current: the OTHER hint, a different message', () => {
		const { target, instance } = mountList({ visible: [], current: summary('s-current') });
		const hint = target.querySelector('[data-testid="sidebar-sessions-empty"]');
		expect(hint).not.toBeNull();
		expect(hint?.textContent).toBe('No other sessions match.');
		// The two empty branches never render the same string.
		expect(hint?.textContent).not.toBe('No sessions match.');
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(0);
		unmount(instance);
	});
});

describe('SidebarSessionsList — depthById prop', () => {
	it('default (prop omitted): every row renders at depth 0', () => {
		const { target, instance } = mountList({ visible: [summary('s-one')] });
		const row = target.querySelector('[data-testid="sidebar-session-card"]');
		// RowSessionItem's depth marker: data-depth on the anchor.
		expect(row?.getAttribute('data-depth')).toBe('0');
		// Depth 0 keeps the workspace chip, no branch slot.
		expect(row?.querySelector('[data-testid="sidebar-workspace-chip"]')).not.toBeNull();
		expect(row?.querySelector('[data-testid="sidebar-workspace-branch"]')).toBeNull();
		unmount(instance);
	});

	it('depthById depth 2: the depth marker and the interior indent change', () => {
		const { target, instance } = mountList({
			visible: [summary('kid')],
			depthById: { kid: 2 }
		});
		const row = target.querySelector('[data-testid="sidebar-session-card"]')!;
		expect(row.getAttribute('data-depth')).toBe('2');
		// The depth cue insets the branch slot INSIDE the workspace slot:
		// depth × 0.75rem — 2 × 0.75 = 1.5rem, unlike the default 0.
		const branch = row.querySelector('[data-testid="sidebar-workspace-branch"]')!;
		expect((branch as HTMLElement).style.paddingLeft).toBe('1.5rem');
		unmount(instance);
	});
});

describe('SidebarSessionsList — row mapping', () => {
	it('one RowSessionItem per visible session, keyed by sessionId', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one'), summary('s-two'), summary('s-three')]
		});
		const rows = [
			...target.querySelectorAll('[data-testid="sidebar-session-card"]')
		];
		expect(rows).toHaveLength(3);
		// Each row carries its session — data-session-id mirrors the key.
		expect(rows.map((r) => r.getAttribute('data-session-id'))).toEqual([
			's-one',
			's-two',
			's-three'
		]);
		unmount(instance);
	});
});

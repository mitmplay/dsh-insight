/**
 * SidebarSessionContainer unit tests — the sidebar's session-rows shell.
 *
 * Component-direct mount (sidebar-panel-list.test.ts pattern): the
 * container is purely presentational, so every behavior reads from the
 * DOM through its own and its child's data-testids:
 *
 *  - the scrolling column assembles the separator + the recency spine
 *    (SidebarSessionList) from (current, visible, workspaces)
 *  - the paneledSessionIds prop is OPTIONAL — the default [] path
 *    (the uncovered L35 branch) and the explicit-array path render
 *    identically through the spine
 *  - the spine's empty-state hints pass through the shell (no current
 *    → "No sessions match."; a current with no others → "No other
 *    sessions match.")
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SidebarSessionContainer from '$lib/components/sessions/SidebarSessionContainer.svelte';
import { defaultSpineGroupPrefs, type SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
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

function mountContainer(props: {
	current?: DsiSessionSummary | null;
	visible?: DsiSessionSummary[];
	workspaces?: DsiWorkspaceSummary[];
	paneledSessionIds?: string[];
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionContainer, {
		target,
		props: {
			current: props.current ?? null,
			visible: props.visible ?? [],
			workspaces: props.workspaces ?? NO_WORKSPACES,
			...(props.paneledSessionIds !== undefined ? { paneledSessionIds: props.paneledSessionIds } : {}),
			spine: defaultSpineGroupPrefs(),
			onspinechange: () => {}
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarSessionContainer — shell render', () => {
	it('renders the list shell: its own testid, the separator, and the spine rows', () => {
		const { target, instance } = mountContainer({
			visible: [summary('s-one'), summary('s-two')]
		});
		expect(target.querySelector('[data-testid="sidebar-sessions-list"]')).not.toBeNull();
		// The separator rides the shell (the pills end, the rows begin).
		expect(target.querySelector('[data-testid="sidebar-sessions-list"] hr')).not.toBeNull();
		// Rows arrive through the child spine (sidebar-session-card testids).
		const rows = target.querySelectorAll('[data-testid="sidebar-session-card"]');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('Session s-one');
		expect(rows[1].textContent).toContain('Session s-two');
		unmount(instance);
	});

	it('paneledSessionIds defaults to [] when the prop is omitted (default-prop path)', () => {
		// Mount WITHOUT paneledSessionIds — the $props() default branch.
		// The spine renders every visible row; nothing is paneled away by
		// the shell itself (paneled filtering is the OWNER's derivation).
		const { target, instance } = mountContainer({
			current: summary('s-current'),
			visible: [summary('s-one'), summary('s-two')]
		});
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		unmount(instance);
	});

	it('an explicit paneledSessionIds array renders the same spine (prop-carrying path)', () => {
		const { target, instance } = mountContainer({
			current: summary('s-current'),
			visible: [summary('s-one'), summary('s-two')],
			paneledSessionIds: ['s-one']
		});
		// The container passes rows through verbatim — the owner already
		// removed paneled sessions from `visible` by contract.
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		unmount(instance);
	});

	it('empty state without a current session: "No sessions match."', () => {
		const { target, instance } = mountContainer({ visible: [] });
		const hint = target.querySelector('[data-testid="sidebar-sessions-empty"]');
		expect(hint?.textContent).toBe('No sessions match.');
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(0);
		unmount(instance);
	});

	it('empty state with a pinned current: "No other sessions match."', () => {
		const { target, instance } = mountContainer({
			current: summary('s-current'),
			visible: []
		});
		expect(target.querySelector('[data-testid="sidebar-sessions-empty"]')?.textContent).toBe(
			'No other sessions match.'
		);
		unmount(instance);
	});

	it('zero workspaces still renders rows (no chip column breakage)', () => {
		const { target, instance } = mountContainer({
			visible: [summary('s-one', { workspace: null })],
			workspaces: NO_WORKSPACES
		});
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(1);
		unmount(instance);
	});
});

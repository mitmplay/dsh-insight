/**
 * RowSessionItem × Sub-Agent Parent count (ADR-0078 D2, task 2.1-T) —
 * the caller pins: a parent with 3 subagent children in the threaded
 * list shows "3"; a parent whose children are all forks shows none; a
 * child row itself shows none. Spec: dev/specs/2026-11/2026-11-23 -
 * Sub-Agent Parent Badge.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import RowSessionItemHost from '../fixtures/RowSessionItemHost.svelte';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

const workspaces: DsiWorkspaceSummary[] = [];

function sess(sessionId: string, parentSessionId: string | null, origin: DsiSessionSummary['origin']): DsiSessionSummary {
	return {
		sessionId,
		title: 's-' + sessionId,
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId,
		origin,
		agentPreset: null
	} as DsiSessionSummary;
}

const PARENT = 'parent-1';
const list: DsiSessionSummary[] = [
	sess(PARENT, null, null),
	sess('sub-1', PARENT, 'subagent'),
	sess('sub-2', PARENT, 'subagent'),
	sess('sub-3', PARENT, 'subagent'),
	sess('fork-1', PARENT, 'scheduled'),
	sess('child-of-sub', 'sub-2', 'subagent')
];

function mountRow(session: DsiSessionSummary): { target: HTMLElement; c: Record<string, unknown> } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const c = mount(RowSessionItemHost, { target, props: { session, workspaces, rows: list } });
	flushSync();
	return { target, c };
}

function teardown(target: HTMLElement, c: Record<string, unknown>): void {
	unmount(c);
	target.remove();
}

describe('row-session-item — sub-agent parent count (ADR-0078 2.1-T)', () => {
	it('a parent with 3 subagent children in the list shows "3"', () => {
		const { target, c } = mountRow(list[0]);
		const badge = target.querySelector('[data-testid="sidebar-sub-badge"]');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toBe('3');
		teardown(target, c);
	});

	it('fork/scheduled children do NOT count — but the subagent children still do', () => {
		const { target, c } = mountRow(list[0]);
		// 3 subagents + 1 scheduled fork: the fork is not counted.
		expect(target.querySelector('[data-testid="sidebar-sub-badge"]')?.textContent).toBe('3');
		teardown(target, c);
	});

	it('a child row itself shows NO badge (ADR-0078 D1)', () => {
		const { target, c } = mountRow(list[1]);
		expect(target.querySelector('[data-testid="sidebar-sub-badge"]')).toBeNull();
		teardown(target, c);
	});

	it('a deep child row (child of a child) shows NO badge', () => {
		const { target, c } = mountRow(list[5]);
		expect(target.querySelector('[data-testid="sidebar-sub-badge"]')).toBeNull();
		teardown(target, c);
	});

	it('an absent rows list (direct mount) renders NO badge anywhere', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const c = mount(RowSessionItemHost, { target, props: { session: list[0], workspaces } });
		flushSync();
		expect(target.querySelector('[data-testid="sidebar-sub-badge"]')).toBeNull();
		unmount(c);
		target.remove();
	});
});

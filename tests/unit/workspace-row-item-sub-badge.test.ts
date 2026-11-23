/**
 * WorkspaceRowItem × Sub-Agent Parent Badge (ADR-0078 D2/D4, task 1.1-T) —
 * the presenter pins: subagents > 0 paints the muted Bot+count pill with
 * the EXACT count text and testid sidebar-sub-badge; 0 or absent paints
 * none; the Bot glyph is aria-hidden; the label string is never modified;
 * scheduled + subagents coexist on one row. No behavior keys to the
 * badge (D3). Spec: dev/specs/2026-11/2026-11-23 - Sub-Agent Parent Badge.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import WorkspaceRowItem from '../../src/lib/components/sessions/WorkspaceRowItem.svelte';
import type { DsiWorkspaceSummary } from '../../src/lib/types';

const workspaces: DsiWorkspaceSummary[] = [];

interface RowProps {
	running?: boolean;
	workspace?: string | null;
	label?: string;
	scheduled?: boolean;
	subagents?: number;
}

function mountRow(props: RowProps): { target: HTMLElement; c: Record<string, unknown> } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const c = mount(WorkspaceRowItem, {
		target,
		props: {
			running: false,
			workspace: null,
			label: 'Container Base',
			workspaces,
			...props
		}
	});
	flushSync();
	return { target, c };
}

function teardown(target: HTMLElement, c: Record<string, unknown>): void {
	unmount(c);
	target.remove();
}

describe('workspace-row-item — sub badge (ADR-0078 1.1-T)', () => {
	it('subagents=5 renders the pill with EXACT text "5" and the pinned testid', () => {
		const { target, c } = mountRow({ subagents: 5 });
		const badge = target.querySelector('[data-testid="sidebar-sub-badge"]');
		expect(badge).not.toBeNull();
		// The count is readable text; the aria-hidden glyph is not.
		expect(badge?.textContent).toBe('5');
		teardown(target, c);
	});

	it('subagents=0 renders NO pill', () => {
		const { target, c } = mountRow({ subagents: 0 });
		expect(target.querySelector('[data-testid="sidebar-sub-badge"]')).toBeNull();
		teardown(target, c);
	});

	it('an absent prop renders NO pill (pre-wave byte-identical rows)', () => {
		const { target, c } = mountRow({});
		expect(target.querySelector('[data-testid="sidebar-sub-badge"]')).toBeNull();
		teardown(target, c);
	});

	it('the Bot glyph is aria-hidden (the count is the readable text)', () => {
		const { target, c } = mountRow({ subagents: 3 });
		const glyph = target.querySelector('[data-testid="sidebar-sub-badge"] svg');
		expect(glyph).not.toBeNull();
		expect(glyph?.getAttribute('aria-hidden')).toBe('true');
		teardown(target, c);
	});

	it('D2: the label string is never modified — the pill is separate DOM', () => {
		const { target, c } = mountRow({ subagents: 5 });
		expect(target.querySelector('.label')?.textContent).toBe('Container Base');
		teardown(target, c);
	});

	it('scheduled=true AND subagents=2 — both pills render on one row', () => {
		const { target, c } = mountRow({ scheduled: true, subagents: 2 });
		expect(target.querySelector('[data-testid="sidebar-sch-badge"]')).not.toBeNull();
		const sub = target.querySelector('[data-testid="sidebar-sub-badge"]');
		expect(sub).not.toBeNull();
		expect(sub?.textContent).toBe('2');
		// Pill order: the sub badge rides before the label like the SCH pill.
		const label = target.querySelector('.label');
		expect(label?.previousElementSibling).toBe(sub);
		teardown(target, c);
	});
});

/**
 * WorkflowRunCard — branch-closing tests: the terminal status words the
 * main suite never mounts (completed / cancelled), the cancelled glyph's
 * muted class arm, and the duration formatter's over-a-minute arm plus
 * its null (no-duration) arm on a settled row.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import WorkflowRunCard from '$lib/components/message/cards/WorkflowRunCard.svelte';
import type { DsiEntry, DsiWorkflowAgent } from '$lib/types';

function mountCard(entry: Extract<DsiEntry, { kind: 'workflow-run' }>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkflowRunCard, { target, props: { entry } });
	flushSync();
	return { target, instance };
}

const agent = (over: Partial<DsiWorkflowAgent> = {}): DsiWorkflowAgent => ({
	seq: 0,
	label: 'member',
	childId: 'child-0',
	status: 'completed',
	startedAt: 1000,
	endedAt: 2000,
	...over
});

describe('WorkflowRunCard — terminal status words and glyph classes', () => {
	it('a completed run says "completed"', () => {
		const { target, instance } = mountCard({
			kind: 'workflow-run',
			id: 'wf:1',
			seq: 1,
			time: 0,
			runId: 'r1',
			name: 'done run',
			status: 'completed',
			agents: [agent()]
		});
		expect(target.querySelector('[data-testid="workflow-run-status"]')?.textContent?.trim()).toBe('completed');
		const row = target.querySelector('[data-testid="workflow-agent-row"]') as HTMLElement;
		expect(row.querySelector('span')?.className).toContain('text-status-pass');
		unmount(instance);
	});

	it('a cancelled run says "cancelled" and renders its glyph muted', () => {
		const { target, instance } = mountCard({
			kind: 'workflow-run',
			id: 'wf:2',
			seq: 2,
			time: 0,
			runId: 'r2',
			name: 'stopped run',
			status: 'cancelled',
			agents: [agent({ status: 'cancelled' })]
		});
		expect(target.querySelector('[data-testid="workflow-run-status"]')?.textContent?.trim()).toBe('cancelled');
		const row = target.querySelector('[data-testid="workflow-agent-row"]') as HTMLElement;
		expect(row.querySelector('span')?.className).toContain('text-text-muted');
		unmount(instance);
	});

	it('a failed member renders its glyph in the fail color', () => {
		const { target, instance } = mountCard({
			kind: 'workflow-run',
			id: 'wf:3',
			seq: 3,
			time: 0,
			runId: 'r3',
			name: 'bad run',
			status: 'failed',
			agents: [agent({ status: 'failed' })]
		});
		const row = target.querySelector('[data-testid="workflow-agent-row"]') as HTMLElement;
		expect(row.querySelector('span')?.className).toContain('text-status-fail');
		unmount(instance);
	});

	it('a running member renders its glyph in the accent color and no duration', () => {
		const { target, instance } = mountCard({
			kind: 'workflow-run',
			id: 'wf:4',
			seq: 4,
			time: 0,
			runId: 'r4',
			name: 'live run',
			status: 'running',
			agents: [agent({ status: 'running', endedAt: undefined })]
		});
		const row = target.querySelector('[data-testid="workflow-agent-row"]') as HTMLElement;
		expect(row.querySelector('span')?.className).toContain('text-accent-purple');
		// endedAt undefined → duration() null → no duration span.
		expect(row.textContent).not.toMatch(/\d+s/);
		unmount(instance);
	});
});

describe('WorkflowRunCard — duration formatter arms', () => {
	it('a span over a minute formats as "Nm SSs"', () => {
		// 65_000 ms → 1m 05s
		const { target, instance } = mountCard({
			kind: 'workflow-run',
			id: 'wf:5',
			seq: 5,
			time: 0,
			runId: 'r5',
			name: 'long member',
			status: 'completed',
			agents: [agent({ startedAt: 1_000, endedAt: 66_000 })]
		});
		const row = target.querySelector('[data-testid="workflow-agent-row"]') as HTMLElement;
		expect(row.textContent).toContain('1m 05s');
		unmount(instance);
	});

	it('a wire glitch (endedAt < startedAt) renders no duration span', () => {
		const { target, instance } = mountCard({
			kind: 'workflow-run',
			id: 'wf:6',
			seq: 6,
			time: 0,
			runId: 'r6',
			name: 'clock skew',
			status: 'completed',
			agents: [agent({ startedAt: 5000, endedAt: 1000 })]
		});
		const row = target.querySelector('[data-testid="workflow-agent-row"]') as HTMLElement;
		expect(row.textContent).not.toMatch(/\d+s/);
		unmount(instance);
	});
});

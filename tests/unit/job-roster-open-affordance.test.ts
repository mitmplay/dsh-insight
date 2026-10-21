/**
 * JobRosterList click affordance tests (ADR-0035 D2/D3): live rows emit
 * openJobTab on the follow-client bus; settled rows are inert.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JobRosterList from '../../src/lib/components/jobs/JobRosterList.svelte';
import { registerJobTabOpener, registerJobTabClearer, clearJobTab } from '$lib/services/jobs/follow-client.svelte';
import type { DsiJobView } from '$lib/types';

let mounted: ReturnType<typeof mount> | null = null;

function job(p: Partial<DsiJobView> & { id: string }): DsiJobView {
	return {
		kind: 'bash',
		label: 'nodejs code-coverage',
		status: 'running',
		startedAt: 1_000,
		output: { total: 42, earliest: 0 },
		...p
	};
}

function mountList(jobs: DsiJobView[]) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(JobRosterList, { target, props: { jobs, sessionId: 'session-a' } as never });
	flushSync();
	return target;
}

afterEach(() => {
	if (mounted) {
		unmount(mounted);
		mounted = null;
	}
});

describe('JobRosterList — follower affordance', () => {
	it('a live row click emits openJobTab with owner, id, label', () => {
		const opener = vi.fn();
		const unregister = registerJobTabOpener(opener);
		const target = mountList([job({ id: 'j1', owner: 'session-a' })]);
		const btn = target.querySelector('[data-testid="job-open-j1"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		btn.click();
		flushSync();
		expect(opener).toHaveBeenCalledWith('session-a', 'j1', 'nodejs code-coverage');
		unregister();
	});

	it('an unowned live row emits with an empty owner', () => {
		const opener = vi.fn();
		const unregister = registerJobTabOpener(opener);
		const target = mountList([job({ id: 'j2' })]);
		(target.querySelector('[data-testid="job-open-j2"]') as HTMLButtonElement).click();
		flushSync();
		expect(opener).toHaveBeenCalledWith('', 'j2', 'nodejs code-coverage');
		unregister();
	});

	it('a settled row is ALSO clickable (operator spec 2026-10-21)', () => {
		const opener = vi.fn();
		const unregister = registerJobTabOpener(opener);
		const target = mountList([job({ id: 'j3', status: 'completed', owner: 'session-a' })]);
		const btn = target.querySelector('[data-testid="job-open-j3"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		btn.click();
		flushSync();
		expect(opener).toHaveBeenCalledWith('session-a', 'j3', 'nodejs code-coverage');
		unregister();
	});
});

describe('JobRosterList — clear button', () => {
	it('the row clear button dispatches clearJobTab for that job', () => {
		const cleared: string[] = [];
		const unregister = registerJobTabClearer((owner, jobId) => cleared.push(owner + '|' + jobId));
		const target = mountList([job({ id: 'j4', status: 'completed', owner: 'session-a' })]);
		(target.querySelector('[data-testid="job-clear-j4"]') as HTMLButtonElement).click();
		flushSync();
		expect(cleared).toEqual(['session-a|j4']);
		unregister();
	});
});

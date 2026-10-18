/**
 * JobRosterList component tests — branch coverage mop (2026-10-17).
 *
 * Pins the shared readout's rendering contract (Job Badge Waves 2+3,
 * ADR-0026): empty roster vs rows; each status icon branch (running
 * spins, stopping dims, completed/failed/killed settle, unknown status
 * falls through to the dashed fallback); the live class only on
 * running/stopping rows; the kill arm→confirm two-click flow calling
 * jobsRoster.refresh(sessionId) after BOTH a successful fetch and a
 * rejected one (the finally at JobRosterList.svelte:48).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JobRosterList from '../../src/lib/components/jobs/JobRosterList.svelte';
import { jobsRoster } from '$lib/services/jobs/roster-store.svelte';
import type { DsiJobStatus, DsiJobView } from '$lib/types';

let mounted: ReturnType<typeof mount> | null = null;

function job(p: Partial<DsiJobView> & { id: string }): DsiJobView {
	return {
		kind: 'bash',
		label: 'job ' + p.id,
		status: 'running',
		startedAt: 1_000,
		output: { total: 42, earliest: 0 },
		...p
	};
}

/** Mount with props exactly the popups feed them. */
function mountList(props: { jobs: DsiJobView[]; sessionId?: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(JobRosterList, {
		target,
		props: { sessionId: 'session-a', ...props } as never
	});
	flushSync();
	return target;
}

function rows(target: HTMLElement): HTMLElement[] {
	return Array.from(target.querySelectorAll('.job')) as HTMLElement[];
}

afterEach(() => {
	if (mounted) {
		unmount(mounted);
		mounted = null;
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('JobRosterList — empty vs rows', () => {
	it('renders the empty marker when the roster is empty', () => {
		const target = mountList({ jobs: [] });
		expect(target.querySelector('[data-testid="job-roster-empty"]')).not.toBeNull();
		expect(rows(target)).toHaveLength(0);
	});

	it('renders one row per job with label and byte total', () => {
		const target = mountList({
			jobs: [job({ id: 'j1', label: 'run tests', output: { total: 128, earliest: 0 } })]
		});
		const list = rows(target);
		expect(list).toHaveLength(1);
		expect(list[0].querySelector('.label')?.textContent).toContain('run tests');
		expect(list[0].querySelector('.bytes')?.textContent).toContain('128B');
	});
});

describe('JobRosterList — status icon branches', () => {
	const cases: Array<{ status: DsiJobStatus; live: boolean }> = [
		{ status: 'running', live: true },
		{ status: 'stopping', live: true },
		{ status: 'completed', live: false },
		{ status: 'failed', live: false },
		{ status: 'killed', live: false }
	];

	it.each(cases)('$status renders an icon and live class $live', ({ status, live }) => {
		const target = mountList({ jobs: [job({ id: 's-' + status, status })] });
		const row = rows(target)[0];
		expect(row.querySelector('.status svg')).not.toBeNull();
		expect(row.getAttribute('title') ?? row.querySelector('.status')?.getAttribute('title')).toBe(
			status
		);
		expect(row.classList.contains('live')).toBe(live);
		// kill button only on live rows
		expect(row.querySelector('.kill') !== null).toBe(live);
	});

	it('an unknown status falls through to the dashed fallback icon, non-live', () => {
		const target = mountList({
			jobs: [job({ id: 'odd', status: 'teleporting' as DsiJobStatus })]
		});
		const row = rows(target)[0];
		expect(row.querySelector('.status svg')).not.toBeNull();
		expect(row.classList.contains('live')).toBe(false);
		expect(row.querySelector('.kill')).toBeNull();
	});

	it('a mixed roster shows the live class only on running/stopping rows', () => {
		const target = mountList({
			jobs: cases.map((c) => job({ id: 'm-' + c.status, status: c.status }))
		});
		const list = rows(target);
		expect(list).toHaveLength(5);
		expect(list.filter((r) => r.classList.contains('live'))).toHaveLength(2);
		expect(list.filter((r) => r.querySelector('.kill'))).toHaveLength(2);
	});
});

describe('JobRosterList — kill arm/confirm flow', () => {
	it('first click arms (shows confirm), second click kills and refreshes', async () => {
		const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const refreshSpy = vi.spyOn(jobsRoster, 'refresh').mockResolvedValue(undefined);
		const target = mountList({ jobs: [job({ id: 'k1' })] });

		const btn = target.querySelector('[data-testid="job-kill-k1"]') as HTMLButtonElement;
		btn.click();
		flushSync();
		// armed: no fetch yet, button re-labelled
		expect(fetchMock).not.toHaveBeenCalled();
		expect(btn.classList.contains('armed')).toBe(true);

		btn.click();
		flushSync();
		await Promise.resolve();
		await Promise.resolve();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/dsh/jobs');
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(JSON.parse(String(init.body))).toEqual({
			sessionId: 'session-a',
			jobId: 'k1'
		});
		// JobRosterList.svelte:48 — refresh after the kill, with the sessionId
		expect(refreshSpy).toHaveBeenCalledWith('session-a');
		// disarmed afterwards
		expect(btn.classList.contains('armed')).toBe(false);
	});

	it('a rejected kill fetch STILL calls jobsRoster.refresh (finally branch)', async () => {
		// the host refuses the kill (500) — refresh STILL runs via finally
		const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response('nope', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);
		const refreshSpy = vi.spyOn(jobsRoster, 'refresh').mockResolvedValue(undefined);
		const target = mountList({ jobs: [job({ id: 'k2' })] });

		const btn = target.querySelector('[data-testid="job-kill-k2"]') as HTMLButtonElement;
		btn.click();
		flushSync();
		btn.click();
		flushSync();
		await vi.waitFor(() => expect(refreshSpy).toHaveBeenCalledWith('session-a'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a REJECTED kill fetch still runs the finally arm (refresh fires, no catch)', async () => {
		// kill() has try/finally with NO catch (JobRosterList.svelte:39-50):
		// the rejection escapes kill() and the dropped onclick promise turns
		// into an unhandled rejection — swallow it here so vitest stays clean
		// while we pin that refresh STILL fires.
		const onUnhandled = (): void => {};
		process.on('unhandledRejection', onUnhandled);
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('socket down'))));
		const refreshSpy = vi.spyOn(jobsRoster, 'refresh').mockResolvedValue(undefined);
		const target = mountList({ jobs: [job({ id: 'k4' })] });

		const btn = target.querySelector('[data-testid="job-kill-k4"]') as HTMLButtonElement;
		btn.click();
		flushSync();
		btn.click();
		flushSync();
		await vi.waitFor(() => expect(refreshSpy).toHaveBeenCalledWith('session-a'));
		process.off('unhandledRejection', onUnhandled);
	});

	it('arm expires after KILL_ARM_MS — the next click re-arms instead of killing', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(jobsRoster, 'refresh').mockResolvedValue(undefined);
		const target = mountList({ jobs: [job({ id: 'k3' })] });

		const btn = target.querySelector('[data-testid="job-kill-k3"]') as HTMLButtonElement;
		btn.click();
		flushSync();
		expect(btn.classList.contains('armed')).toBe(true);
		// past the 3s arm window the stale arm disarms silently
		vi.advanceTimersByTime(3_000);
		flushSync();
		expect(btn.classList.contains('armed')).toBe(false);
		// and this click arms again rather than firing the kill
		btn.click();
		flushSync();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(btn.classList.contains('armed')).toBe(true);
	});

	it('arming a second job disarms the first (single armed id)', () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
		vi.spyOn(jobsRoster, 'refresh').mockResolvedValue(undefined);
		const target = mountList({ jobs: [job({ id: 'ka' }), job({ id: 'kb' })] });

		const btnA = target.querySelector('[data-testid="job-kill-ka"]') as HTMLButtonElement;
		const btnB = target.querySelector('[data-testid="job-kill-kb"]') as HTMLButtonElement;
		btnA.click();
		flushSync();
		expect(btnA.classList.contains('armed')).toBe(true);
		btnB.click();
		flushSync();
		expect(btnA.classList.contains('armed')).toBe(false);
		expect(btnB.classList.contains('armed')).toBe(true);
	});
});

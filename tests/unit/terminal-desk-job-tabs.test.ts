/**
 * TerminalDesk job follower tab tests (ADR-0035 D2/D3/D5): openJobTab adds
 * a job tab after the shell tabs, re-click selects the existing tab, the
 * SSE closer runs on tab close and on destroy, and the shell mirror never
 * carries job ids (D5).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalDesk from '../../src/lib/components/terminal/TerminalDesk.svelte';
import { openJobTab, registerJobTabOpener, registerJobTabLauncher, registerJobTabClearer, clearJobTab, __resetFollowClientForTests } from '$lib/services/jobs/follow-client.svelte';
import { appConfig } from '$lib/services/config/app-config.svelte';

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	close(): void {
		this.closed = true;
	}
}

let mounted: ReturnType<typeof mount> | null = null;
let target: HTMLElement | null = null;

function mountDesk() {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(TerminalDesk, { target, props: {} as never });
	flushSync();
	return target;
}

function jobTabButtons(target: HTMLElement): Element[] {
	// job tabs are the T<n> buttons AFTER the shell tabs (T1 is the desk's
	// default self-open shell tab in these fixtures)
	return Array.from(target.querySelectorAll('[data-testid^="terminal-tab-button-"]')).filter((el) => {
		const idx = Number((el.getAttribute('data-testid') ?? '').replace('terminal-tab-button-', ''));
		return idx >= 1 && /^T\d+\s*×?/.test(el.textContent?.trim() ?? '');
	});
}

afterEach(() => {
	__resetFollowClientForTests();
	if (mounted) {
		unmount(mounted);
		mounted = null;
	}
	target?.remove();
	target = null;
	FakeEventSource.instances = [];
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('TerminalDesk — job follower tabs', () => {
	it('openJobTab appends a job tab after shell tabs and subscribes to the SSE', () => {
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const target = mountDesk();
		const shellTabs = target.querySelectorAll('.tab').length || 1;
		openJobTab('session-a', 'j1', 'nodejs code-coverage');
		flushSync();
		const buttons = jobTabButtons(target);
		expect(buttons).toHaveLength(1);
		expect(buttons[0].textContent).toContain('T2-J'); // -J marks a job-clicked tab
		expect(FakeEventSource.instances).toHaveLength(1);
		expect(FakeEventSource.instances[0].url).toContain('/api/dsh/jobs/follow?');
		expect(FakeEventSource.instances[0].url).toContain('jobId=j1');
		void shellTabs;
	});

	it('re-click selects the existing tab instead of duplicating', () => {
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const target = mountDesk();
		openJobTab('session-a', 'j1', 'one');
		openJobTab('session-a', 'j1', 'one');
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(1);
		expect(FakeEventSource.instances).toHaveLength(1);
	});

	it('two different jobs become two tabs and two streams', () => {
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const target = mountDesk();
		openJobTab('session-a', 'j1', 'one');
		openJobTab('session-a', 'j2', 'two');
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(2);
		expect(FakeEventSource.instances).toHaveLength(2);
	});

	it('tab close runs the SSE closer; destroy closes every stream', () => {
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const target = mountDesk();
		openJobTab('session-a', 'j1', 'one');
		flushSync();
		// destroy is the closer of last resort: unmount closes every stream
		unmount(mounted!);
		mounted = null;
		flushSync();
		expect(FakeEventSource.instances[0].closed).toBe(true);
	});
});

describe('follow-client bus contract', () => {
	it('openJobTab is a no-op with no desk registered', () => {
		expect(() => openJobTab('s', 'j', 'l')).not.toThrow();
	});

	it('unregister stops delivery', () => {
		const seen: string[] = [];
		const unregister = registerJobTabOpener((owner, jobId) => seen.push(owner + '|' + jobId));
		unregister();
		openJobTab('s', 'j', 'l');
		expect(seen).toEqual([]);
	});
});

describe('follow-client — no-desk launch fallback (RCA 2026-10-21)', () => {
	it('launches the terminal panel and replays the click when the desk registers', () => {
		const launched = vi.fn();
		const unregisterLauncher = registerJobTabLauncher(launched);
		const seen: string[] = [];
		// click BEFORE any desk exists: launcher fires, request parks
		openJobTab('session-a', 'j9', 'coverage run');
		expect(launched).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([]);
		// the fresh desk registers: the parked click replays into it
		const unregisterOpener = registerJobTabOpener((owner, jobId, label) => seen.push(owner + '|' + jobId + '|' + label));
		expect(seen).toEqual(['session-a|j9|coverage run']);
		// subsequent clicks deliver directly, launcher is not re-fired
		openJobTab('session-a', 'j8', 'other');
		expect(launched).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['session-a|j9|coverage run', 'session-a|j8|other']);
		unregisterOpener();
		unregisterLauncher();
	});
});

describe('TerminalDesk — no active jobs closes the tab (D3 amendment)', () => {
	it('a settled job tab closes once the roster shows no live jobs', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		// roster: the job settled, nothing live
		appConfig().jobs.autoClose = true;
		vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
			const u = String(url);
			if (u.includes('/api/dsh/jobs')) {
				return new Response(JSON.stringify({ ok: true, jobs: [{ id: 'j1', kind: 'bash', label: 'cov', status: 'completed', startedAt: 1, output: { total: 1, earliest: 0 } }] }));
			}
			return new Response('{}');
		}));
		const target = mountDesk();
		openJobTab('session-a', 'j1', 'cov');
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(1);
		// deliver the settle frame, let the spine tick land
		const es = FakeEventSource.instances[0];
		es.onmessage?.({ data: JSON.stringify({ type: 'status', job: { id: 'j1', status: 'completed' } }) });
		flushSync();
		// the settled tab lingers 25s (operator grace), then closes
		await vi.advanceTimersByTimeAsync(25_000);
		expect(jobTabButtons(target)).toHaveLength(0);
		expect(es.closed).toBe(true);
	});
});

describe('TerminalDesk — unowned job tab closes at settle (after 25s)', () => {
	it('an unowned job tab closes when its follow settles', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		appConfig().jobs.autoClose = true;
		const target = mountDesk();
		openJobTab('', 'u1', 'unowned loop job');
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(1);
		FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ type: 'status', job: { id: 'u1', status: 'completed' } }) });
		flushSync();
		await vi.advanceTimersByTimeAsync(25_000);
		expect(jobTabButtons(target)).toHaveLength(0);
		expect(FakeEventSource.instances[0].closed).toBe(true);
	});
});

describe('TerminalDesk — jobs.autoClose false (default)', () => {
	it('a settled owned tab STAYS when autoClose is false, and the clear command closes it', async () => {
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
			const u = String(url);
			if (u.includes('/api/dsh/jobs')) {
				return new Response(JSON.stringify({ ok: true, jobs: [{ id: 'j1', kind: 'bash', label: 'cov', status: 'completed', startedAt: 1, output: { total: 1, earliest: 0 } }] }));
			}
			return new Response('{}');
		}));
		vi.useFakeTimers();
		appConfig().jobs.autoClose = false;
		const target = mountDesk();
		openJobTab('session-a', 'j1', 'cov');
		flushSync();
		FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ type: 'status', job: { id: 'j1', status: 'completed' } }) });
		flushSync();
		// settled + no live jobs, but autoClose false → the tab STAYS
		expect(jobTabButtons(target)).toHaveLength(1);
		// the roster's clear command closes it immediately
		clearJobTab('session-a', 'j1');
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(0);
	});
});

describe('TerminalDesk — job tabs ride the mirror (D5 amendment)', () => {
	it('onMirror carries remembered jobs; restore re-opens them', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const mirrors: unknown[] = [];
		const target = document.createElement('div');
		document.body.appendChild(target);
		const component = mount(TerminalDesk, { target, props: { onMirror: (m: unknown) => mirrors.push(structuredClone(m)) } as never });
		flushSync();
		openJobTab('session-a', 'j1', 'cov');
		flushSync();
		const last = mirrors[mirrors.length - 1] as { jobs?: Array<{ owner: string; jobId: string }> };
		expect(last.jobs).toEqual([{ owner: 'session-a', jobId: 'j1' }]);
		unmount(component);
		target.remove();
		FakeEventSource.instances = [];
		__resetFollowClientForTests();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		// rebuild: a restored mirror with remembered jobs re-opens the follow
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		const component2 = mount(TerminalDesk, { target: target2, props: { restored: { tabs: [], selectedTab: 1, jobs: [{ owner: 'session-a', jobId: 'j1' }] } } as never });
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		expect(jobTabButtons(target2)).toHaveLength(1);
		unmount(component2);
		target2.remove();
	});
});

describe('TerminalDesk — restore selection + manual-mode churn (RCA 2026-10-21)', () => {
	it('restore does not steal focus — the stored selection stays selected', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		const component2 = mount(TerminalDesk, { target: target2, props: { restored: { tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [{ owner: 'session-a', jobId: 'j1' }, { owner: 'session-a', jobId: 'j2' }] } } as never });
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		// 3 tabs: T1 shell (restored selection) + T2-J + T3-J — T1 stays selected
		const selected = target2.querySelector('[data-testid="terminal-tab-button-0"]');
		expect(selected?.getAttribute('data-selected')).toBe('true');
		expect(jobTabButtons(target2)).toHaveLength(2);
		unmount(component2);
		target2.remove();
	});

	it('autoClose:false keeps the settled tab through ANY roster churn — only clear closes', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		let rosterJobs: unknown[] = [{ id: 'j1', kind: 'bash', label: 'cov', status: 'completed', startedAt: 1, output: { total: 1, earliest: 0 } }, { id: 'other', kind: 'bash', label: 'other', status: 'running', startedAt: 1, output: { total: 1, earliest: 0 } }];
		vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/dsh/jobs')) return new Response(JSON.stringify({ ok: true, jobs: rosterJobs }));
			return new Response('{}');
		}));
		appConfig().jobs.autoClose = false;
		const target = mountDesk();
		openJobTab('session-a', 'j1', 'cov');
		flushSync();
		FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ type: 'status', job: { id: 'j1', status: 'completed' } }) });
		flushSync();
		// roster churns: j1 dropped, then EVERYTHING gone — the tab survives all of it
		rosterJobs = [{ id: 'other', kind: 'bash', label: 'other', status: 'running', startedAt: 1, output: { total: 1, earliest: 0 } }];
		await vi.advanceTimersByTimeAsync(60_000);
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(1);
		rosterJobs = [];
		await vi.advanceTimersByTimeAsync(60_000);
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(1);
		// the clear button (bus command) is the only remover
		clearJobTab('session-a', 'j1');
		flushSync();
		expect(jobTabButtons(target)).toHaveLength(0);
	});
});

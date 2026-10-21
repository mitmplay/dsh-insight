/**
 * RowJobBadge unit tests (Job Badge Wave 2, Task 2.1-T) — the render gates:
 * NOTHING renders at zero live jobs; dot + count render for a running job;
 * the popover lists status/label/bytes per job; the kill button needs TWO
 * clicks (arm then confirm, 3 s window) and POSTs the fence pair; a settled
 * job shows no kill button; unmount releases the store watch (badge never
 * outlives its row). Spec: dev/specs/2026-10/2026-10-16 - Job Badge.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RowJobBadge from '../../src/lib/components/sessions/RowJobBadge.svelte';
import { jobsRoster } from '../../src/lib/services/jobs/roster-store.svelte';
import { heartbeatScope } from '../../src/lib/services/jobs/heartbeat-scope.svelte';

const job = (id: string, status: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status,
	startedAt: 1,
	output: { total: 512, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;
let jobs: unknown[] = [];

beforeEach(() => {
	vi.useFakeTimers();
	jobs = [job('bash-1', 'running')];
	fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true, outcome: 'requested' }) };
		const params = new URL(String(url), 'http://localhost').searchParams;
		// ADR-0032 D5 — the tick now rides the batch dialect; the first load
		// still uses the singular form. Both must answer the fixture's jobs.
		const batchIds = params.get('sessionIds');
		if (batchIds !== null) {
			const rosters: Record<string, unknown> = {};
			for (const id of batchIds.split(',').filter(Boolean)) {
				rosters[id] = id === 'conv-1' ? { jobs } : { jobs: [], pending: true };
			}
			return { ok: true, json: async () => ({ ok: true, rosters }) };
		}
		const sessionId = params.get('sessionId');
		return { ok: true, json: async () => ({ ok: true, sessionId, jobs: sessionId === 'conv-1' ? jobs : [] }) };
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	heartbeatScope.reset(); // the scope singleton owns cross-test watch state
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function host() {
	const div = document.createElement('div');
	document.body.appendChild(div);
	return div;
}

async function mountBadge(sessionId = 'conv-1') {
	const target = host();
	// bind:props pattern — mount with props, keep the accessor for unmount
	const component = mount(RowJobBadge, { target, props: { sessionId } });
	// ADR-0034 D2 — the badge is a pure reader; the SCOPE arms the watch
	heartbeatScope.setViewport([sessionId]);
	await vi.advanceTimersByTimeAsync(250); // arm debounce + batch fetch
	console.log('[probe] urls:', fetchMock.mock.calls.map(c => String(c[0]).replace('http://localhost', '')), '| store:', JSON.stringify(jobsRoster.jobs(sessionId)).slice(0, 60));
	flushSync();
	await vi.advanceTimersByTimeAsync(0);
	flushSync();
	console.log('[probe] html:', target.innerHTML.slice(0, 100) || '(empty)');
	return { component, target };
}

describe('RowJobBadge', () => {
	it('renders NOTHING at zero live jobs', async () => {
		jobs = [job('bash-done', 'completed')];
		const { component, target } = await mountBadge();
		expect(target.querySelector('[data-testid="job-badge"]')).toBeNull();
		unmount(component);
	});

	it('renders dot + live count for a running job', async () => {
		const { component, target } = await mountBadge();
		const trigger = target.querySelector('[data-testid="job-badge-trigger"]');
		expect(trigger).not.toBeNull();
		expect(trigger?.textContent).toContain('1');
		unmount(component);
	});

	it('popover lists status, label and output bytes per job', async () => {
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		const pop = target.querySelector('[data-testid="job-badge-popover"]');
		// status is an icon now (2026-10-17) — the word survives as the tooltip
		expect(pop?.querySelector('.status[title="running"]')).not.toBeNull();
		expect(pop?.textContent).toContain('job bash-1');
		expect(pop?.textContent).toContain('512B');
		unmount(component);
	});

	it('kill needs arm + confirm within the window, then POSTs sessionId + jobId', async () => {
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		const btn = () => target.querySelector('[data-testid="job-kill-bash-1"]') as HTMLButtonElement;
		expect(btn().textContent).not.toContain('Confirm');
		btn().click(); // arm
		flushSync();
		expect(btn().textContent).toContain('Confirm');
		btn().click(); // confirm within the window
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
		expect(post).toBeTruthy();
		expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
			sessionId: 'conv-1',
			jobId: 'bash-1'
		});
		unmount(component);
	});

	it('an armed kill EXPIRES after 3 s — a later click cannot fire blind', async () => {
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		const btn = () => target.querySelector('[data-testid="job-kill-bash-1"]') as HTMLButtonElement;
		btn().click(); // arm
		flushSync();
		await vi.advanceTimersByTimeAsync(3001);
		expect(btn().textContent).not.toContain('Confirm'); // disarmed
		btn().click(); // re-arms, does NOT fire
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
		expect(posts).toHaveLength(0);
		unmount(component);
	});

	it('a settled job shows no kill button', async () => {
		jobs = [job('bash-1', 'killed'), job('bash-2', 'running')];
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="job-kill-bash-1"]')).toBeNull();
		expect(target.querySelector('.status[title="killed"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="job-kill-bash-2"]')).not.toBeNull();
		unmount(component);
	});

	it('a window click OUTSIDE an open badge closes the popover', async () => {
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="job-badge-popover"]')).not.toBeNull();
		window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="job-badge-popover"]')).toBeNull();
		// gate survives closing — badge still shows while jobs are live
		expect(target.querySelector('[data-testid="job-badge"]')).not.toBeNull();
		unmount(component);
	});

	it('a window click while CLOSED is a no-op (short-circuit)', async () => {
		jobs = [job('bash-done', 'completed')]; // badge renders nothing, rootEl undefined
		const { component, target } = await mountBadge();
		window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="job-badge"]')).toBeNull();
		unmount(component);
	});

	it('a click on the badge BODY (not the trigger) is swallowed', async () => {
		const { component, target } = await mountBadge();
		const badge = target.querySelector('[data-testid="job-badge"]') as HTMLElement;
		badge.click();
		flushSync();
		// swallowed → no toggle, no navigation; badge stays put
		expect(target.querySelector('[data-testid="job-badge"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="job-badge-popover"]')).toBeNull();
		unmount(component);
	});

	it('live count 2 renders "2" — many, not just one', async () => {
		jobs = [job('bash-1', 'running'), job('bash-2', 'stopping'), job('bash-3', 'completed')];
		const { component, target } = await mountBadge();
		const trigger = target.querySelector('[data-testid="job-badge-trigger"]');
		expect(trigger?.textContent).toContain('2');
		unmount(component);
	});

	it('the popover click is swallowed — a click INSIDE keeps it open', async () => {
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		const pop = target.querySelector('[data-testid="job-badge-popover"]') as HTMLElement;
		pop.click(); // stopPropagation + contains-true arm — stays open
		flushSync();
		expect(target.querySelector('[data-testid="job-badge-popover"]')).not.toBeNull();
		unmount(component);
	});

	it('open survives liveCount hitting ZERO — the || open arm keeps the badge', async () => {
		const { component, target } = await mountBadge();
		(target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="job-badge-popover"]')).not.toBeNull();
		jobs = [job('bash-1', 'completed')]; // every job settles while reading
		jobsRoster.refreshWatched(); // the spine tick's hook — the page owns the cadence
		await vi.advanceTimersByTimeAsync(250); // the batch refresh replaces the set
		flushSync();
		// liveCount === 0, yet open — badge must still render (render gate)
		expect(target.querySelector('[data-testid="job-badge"]')).not.toBeNull();
		const trigger = target.querySelector('[data-testid="job-badge-trigger"]');
		expect(trigger?.textContent).toContain('0');
		unmount(component);
	});

	it('unmount releases the watch — the badge never outlives its row', async () => {
		const { component } = await mountBadge();
		const calls = fetchMock.mock.calls.length;
		unmount(component);
		const after = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(6000);
		expect(fetchMock.mock.calls.length - after).toBe(0);
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(calls);
	});
});

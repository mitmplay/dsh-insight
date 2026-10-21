/**
 * JobsButton unit tests (Job Badge Wave 3, Task 3.1-T) — the render gates:
 * NOTHING renders at zero live jobs; count renders for a running job; the
 * popup lists status/label/bytes; kill needs arm + confirm and POSTs the
 * fence pair; unmount releases the store watch. Spec: dev/specs/2026-10/
 * 2026-10-16 - Job Badge. Extends the RowJobBadge (2.1-T) conventions.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JobsButton from '../../src/lib/components/anchor/job-anchor/JobsButton.svelte';

const job = (id: string, status: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status,
	startedAt: 1,
	output: { total: 256, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;
let jobs: unknown[] = [];

beforeEach(() => {
	vi.useFakeTimers();
	jobs = [job('bash-1', 'running')];
	fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true, outcome: 'requested' }) };
		const sessionId = new URL(String(url), 'http://localhost').searchParams.get('sessionId');
		return { ok: true, json: async () => ({ ok: true, sessionId, jobs: sessionId === 'conv-1' ? jobs : [] }) };
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function host() {
	const div = document.createElement('div');
	document.body.appendChild(div);
	return div;
}

async function mountButton(sessionId = 'conv-1') {
	const target = host();
	const component = mount(JobsButton, { target, props: { sessionId } });
	flushSync(); // run the mount effect → watch() fires
	await vi.advanceTimersByTimeAsync(0); // settle the snapshot fetch chain
	flushSync();
	return { component, target };
}

describe('JobsButton', () => {
	it('renders the IDLE roster button at zero live jobs (autoClose:false spec)', async () => {
		jobs = [job('bash-1', 'completed')];
		const { component, target } = await mountButton();
		const btn = target.querySelector('[data-testid="jobs-button-trigger"]');
		expect(btn).not.toBeNull();
		expect(btn?.textContent).toContain('1'); // roster count when none live
		unmount(component); // release the watch — the next test re-arms fresh
	});
	it('renders count for a running job', async () => {
		const { component, target } = await mountButton();
		const trigger = target.querySelector('[data-testid="jobs-button-trigger"]');
		expect(trigger).not.toBeNull();
		expect(trigger?.textContent).toContain('1');
		unmount(component);
	});

	it('popup lists status, label and output bytes per job', async () => {
		const { component, target } = await mountButton();
		(target.querySelector('[data-testid="jobs-button-trigger"]') as HTMLElement).click();
		flushSync();
		const pop = target.querySelector('[data-testid="jobs-button-popup"]');
		// status is an icon now (2026-10-17) — the word survives as the tooltip
		expect(pop?.querySelector('.status[title="running"]')).not.toBeNull();
		expect(pop?.textContent).toContain('job bash-1');
		expect(pop?.textContent).toContain('256B');
		unmount(component);
	});

	it('kill needs arm + confirm within the window, then POSTs sessionId + jobId', async () => {
		const { component, target } = await mountButton();
		(target.querySelector('[data-testid="jobs-button-trigger"]') as HTMLElement).click();
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

	it('unmount releases the watch — the poll never outlives the button', async () => {
		const { component } = await mountButton();
		unmount(component);
		const after = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(6000);
		expect(fetchMock.mock.calls.length - after).toBe(0);
	});
});

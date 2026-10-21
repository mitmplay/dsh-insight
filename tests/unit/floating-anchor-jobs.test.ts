/**
 * ConversationFloatingAnchor × JobsButton (Job Badge Wave 3, Task 3.2-T):
 * the anchor renders the JobsButton ONLY when the roster store has rows
 * for the fed session — and nothing job-shaped when the session is empty
 * or the prop is ''. Extends the 3.1-T spec. The anchor mounts with a
 * real container element so its FloatingAnchor gate opens.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationFloatingAnchor from '../../src/lib/components/conversation/panel/ConversationFloatingAnchor.svelte';

const job = (id: string, status: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status,
	startedAt: 1,
	output: { total: 0, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;
let jobs: unknown[] = [];

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	jobs = [job('bash-1', 'running')];
	fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
		const sessionId = new URL(String(url), 'http://localhost').searchParams.get('sessionId');
		return { ok: true, json: async () => ({ ok: true, sessionId, jobs: sessionId === 'conv-1' ? jobs : [] }) };
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function mountAnchor(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(ConversationFloatingAnchor, {
		target,
		props: { groups: [], container: document.createElement('div'), ...props }
	});
	flushSync();
	await vi.advanceTimersByTimeAsync(0); // settle the snapshot fetch chain
	flushSync();
	console.log('DEBUG fetch calls:', fetchMock.mock.calls.map((c) => String(c[0])));
	console.log('DEBUG html:', target.innerHTML.slice(0, 200));
	return { component, target };
}

describe('ConversationFloatingAnchor JobsButton', () => {
	it('renders the JobsButton when the session owns a live job', async () => {
		const { component, target } = await mountAnchor({ jobsessionid: 'conv-1' });
		expect(target.querySelector('[data-testid="jobs-button-trigger"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="jobs-button-trigger"]')?.textContent).toContain('1');
		unmount(component);
	});

	it('renders the jobs button idle (0 live) when only settled jobs remain', async () => {
		jobs = [job('bash-done', 'completed')];
		const { component, target } = await mountAnchor({ jobsessionid: 'conv-1' });
		// Job Follower Tab (ADR-0035): settled rows stay in the roster — the button
		// renders with the idle tone and reports 0 live via its title.
		const trigger = target.querySelector('[data-testid="jobs-button-trigger"]');
		expect(trigger).not.toBeNull();
		expect(trigger?.getAttribute('title')).toContain('0 live');
		expect(trigger?.textContent).toContain('1'); // total roster rows
		unmount(component);
	});

	it('renders NO jobs button when no sessionId is fed', async () => {
		const { component, target } = await mountAnchor({});
		expect(target.querySelector('[data-testid="jobs-button"]')).toBeNull();
		unmount(component);
	});

	it('never polls for a session the anchor was not fed', async () => {
		const { component } = await mountAnchor({ jobsessionid: '' });
		await vi.advanceTimersByTimeAsync(6000);
		const polled = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/dsh/jobs'));
		expect(polled).toHaveLength(0);
		unmount(component);
	});
});

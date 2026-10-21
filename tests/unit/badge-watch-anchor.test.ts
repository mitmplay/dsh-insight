/**
 * JobsButton watch tests (ADR-0033 D1 as narrowed by ADR-0034 D2): the
 * sidebar badges are pure readers under the heartbeat scope, so the only
 * self-watching surface left is JobsButton — whose sessionId is a plain
 * string prop that may genuinely change in place. Pinned: re-watch on a
 * real change, silence on an equal one.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BadgeAnchorWrapper from '../fixtures/badge-anchor-wrapper.svelte';
import JobsButtonWrapper from '../fixtures/jobs-button-anchor-wrapper.svelte';

const job = (id: string, status: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status,
	startedAt: 1,
	output: { total: 0, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn(async (url: string | URL | Request) => {
		const u = new URL(String(url), 'http://localhost');
		const batch = u.searchParams.get('sessionIds');
		if (batch !== null) {
			const rosters: Record<string, unknown> = {};
			for (const id of batch.split(',').filter(Boolean)) {
				rosters[id] = { jobs: [job('j-' + id, 'running')] };
			}
			return { ok: true, json: async () => ({ ok: true, rosters }) };
		}
		const sid = u.searchParams.get('sessionId');
		return { ok: true, json: async () => ({ ok: true, sessionId: sid, jobs: sid ? [job('j-' + sid, 'running')] : [] }) };
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function host(): HTMLElement {
	const div = document.createElement('div');
	document.body.appendChild(div);
	return div;
}

describe('JobsButton watch (ADR-0033 D1, ADR-0034 D2)', () => {
	it('JobsButton re-watches ONLY on a real id change — not on tick noise', async () => {
		const target = host();
		const component = mount(JobsButtonWrapper, { target, props: { initial: 'sid-a' } });
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		const afterMount = fetchMock.mock.calls.length;
		expect(afterMount).toBe(1);

		// same id again → no-op
		component.setSid('sid-a');
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock.mock.calls.length).toBe(afterMount);

		// REAL id change → exactly unwatch(old) + watch(new): one new fetch
		component.setSid('sid-b');
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock.mock.calls.length).toBe(afterMount + 1);
		const lastUrl = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);
		expect(lastUrl).toContain('sessionId=sid-b');
		unmount(component);
	});
});

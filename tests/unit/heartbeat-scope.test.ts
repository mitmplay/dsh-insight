/**
 * Heartbeat scope tests (ADR-0034, Task 2.1-T): the scope is THE watch
 * owner — viewport mode fetches only visible∪always ids, ticker mode the
 * whole spine, scroll bursts coalesce into one debounced batch, and gone
 * ids evict after grace without a boundary re-fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function fresh() {
	vi.resetModules();
	const store = await import('../../src/lib/services/jobs/roster-store.svelte.ts');
	const scope = await import('../../src/lib/services/jobs/heartbeat-scope.svelte.ts');
	return { jobsRoster: store.jobsRoster, heartbeatScope: scope.heartbeatScope };
}

const job = (id: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status: 'running',
	startedAt: 1,
	output: { total: 0, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;
let batchCalls: string[][];

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn(async (url: string | URL | Request) => {
		const u = new URL(String(url), 'http://localhost');
		const batch = u.searchParams.get('sessionIds');
		if (batch !== null) {
			const ids = batch.split(',').filter(Boolean);
			batchCalls.push(ids);
			const rosters: Record<string, unknown> = {};
			for (const id of ids) rosters[id] = { jobs: [job(id)] };
			return { ok: true, json: async () => ({ ok: true, rosters }) };
		}
		const sid = u.searchParams.get('sessionId');
		return { ok: true, json: async () => ({ ok: true, sessionId: sid, jobs: sid ? [job(sid)] : [] }) };
	});
	batchCalls = [];
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('heartbeat scope (ADR-0034)', () => {
	it('viewport-cap fetches ONLY visible ∪ always — offscreen never fetched', async () => {
		const { heartbeatScope, jobsRoster } = await fresh();
		heartbeatScope.setMode('viewport-cap');
		heartbeatScope.setAlways(['panel-1']);
		heartbeatScope.setViewport(['vis-1', 'vis-2']);
		await vi.advanceTimersByTimeAsync(250); // arm debounce
		// one debounced batch, exactly the wanted ids
		expect(batchCalls).toHaveLength(1);
		expect(new Set(batchCalls[0])).toEqual(new Set(['panel-1', 'vis-1', 'vis-2']));
		// an offscreen id the scope never saw must never appear in ANY call
		for (const ids of batchCalls) expect(ids).not.toContain('offscreen');
		expect(jobsRoster.liveCount('vis-1')).toBe(1); // visible badge has data
	});

	it('ticker-cap fetches the whole spine set', async () => {
		const { heartbeatScope } = await fresh();
		heartbeatScope.setMode('ticker-cap');
		heartbeatScope.setSpine(['a', 'b', 'c']);
		await vi.advanceTimersByTimeAsync(250);
		expect(batchCalls).toHaveLength(1);
		expect(new Set(batchCalls[0])).toEqual(new Set(['a', 'b', 'c']));
	});

	it('a scroll burst coalesces into ONE debounced batch', async () => {
		const { heartbeatScope } = await fresh();
		heartbeatScope.setMode('viewport-cap');
		heartbeatScope.setAlways([]);
		heartbeatScope.setViewport(['v1']);
		heartbeatScope.setViewport(['v1', 'v2']);
		heartbeatScope.setViewport(['v1', 'v2', 'v3']);
		await vi.advanceTimersByTimeAsync(250);
		expect(batchCalls).toHaveLength(1);
		expect(new Set(batchCalls[0])).toEqual(new Set(['v1', 'v2', 'v3']));
	});

	it('gone ids evict after grace; a return within grace does NOT re-fetch', async () => {
		const { heartbeatScope } = await fresh();
		heartbeatScope.setMode('viewport-cap');
		heartbeatScope.setAlways([]);
		heartbeatScope.setViewport(['v1']);
		await vi.advanceTimersByTimeAsync(250);
		const armedFetches = fetchMock.mock.calls.length;

		heartbeatScope.setViewport([]); // scrolled out — grace holds the data
		await vi.advanceTimersByTimeAsync(1000);
		heartbeatScope.setViewport(['v1']); // wobble back within grace
		await vi.advanceTimersByTimeAsync(250);
		expect(fetchMock.mock.calls.length).toBe(armedFetches); // no re-fetch

		heartbeatScope.setViewport([]); // really gone now
		await vi.advanceTimersByTimeAsync(6_500); // past GRACE_MS (6s)
		heartbeatScope.setViewport(['v1']); // re-entry MUST re-fetch
		await vi.advanceTimersByTimeAsync(250);
		expect(fetchMock.mock.calls.length).toBe(armedFetches + 1);
	});

	it('a collapsed sidebar (empty viewport) heartbeats only the always set', async () => {
		const { heartbeatScope } = await fresh();
		heartbeatScope.setMode('viewport-cap');
		heartbeatScope.setAlways(['current-1']);
		heartbeatScope.setViewport([]); // collapsed: no rows on screen
		await vi.advanceTimersByTimeAsync(250);
		expect(batchCalls).toHaveLength(1);
		expect(batchCalls[0]).toEqual(['current-1']);
	});
});

/**
 * spine-feed.svelte.ts branch mop — the degrade/guard arms the lifecycle
 * suite does not reach: non-ok and throwing spine fetches, the a2a join's
 * every arm (no senders / ok / non-ok / body-not-ok / throw), the
 * generation guard (a stale in-flight tick never clobbers fresher rows),
 * and unsubscribe over-fire after teardown. Client-runes module — runs
 * under the 'dom' project like submit-ladder.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	refreshSpineFeed,
	resetSpineFeedForTests,
	spineFeed,
	subscribeSpineFeed
} from '$lib/services/conversation/spine-feed.svelte';

function okSpine(): Response {
	return new Response(
		JSON.stringify({ ok: true, sessions: [{ sessionId: 's1', title: 't' }], presets: [] }),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}
function okA2a(): Response {
	return new Response(
		JSON.stringify({ ok: true, rows: [{ exchangeId: 'e1' }] }),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
});

describe('spine fetch degrade arms', () => {
	it('a NON-OK spine response returns early — rows untouched AND the a2a join skipped', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('down', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);
		const off = subscribeSpineFeed(() => ['s1']);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		refreshSpineFeed(); // a second tick, same early return
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('/api/dsh/sessions'))).toBe(true);
		expect(spineFeed.rows).toEqual([]);
		expect(spineFeed.a2aRows).toEqual([]);
		off();
	});

	it('a THROWING spine fetch falls through to the a2a join (best-effort catch)', async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/dsh/sessions')) throw new Error('offline');
			return okA2a();
		});
		vi.stubGlobal('fetch', fetchMock);
		const off = subscribeSpineFeed(() => ['s1']);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(spineFeed.rows).toEqual([]); // previous (empty) rows kept
		expect(spineFeed.a2aRows.length).toBe(1); // the join still ran
		off();
	});
});

describe('a2a join arms', () => {
	it('no senders → NO /api/a2a fetch at all', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) => okSpine());
		vi.stubGlobal('fetch', fetchMock);
		const off = subscribeSpineFeed(() => []);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		refreshSpineFeed();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('/api/dsh/sessions'))).toBe(true);
		off();
	});

	it('no senders provider installed at all → the ?? [] arm, no /api/a2a fetch', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) => okSpine());
		vi.stubGlobal('fetch', fetchMock);
		const off = subscribeSpineFeed();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('/api/dsh/sessions'))).toBe(true);
		off();
	});

	it('a NON-OK a2a response keeps the previous window rows', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL | Request) =>
				String(url).includes('/api/a2a') ? new Response('down', { status: 500 }) : okSpine()
			)
		);
		spineFeed.a2aRows = [{ id: 'keep' } as never];
		const off = subscribeSpineFeed(() => ['s1']);
		await vi.waitFor(() => expect(spineFeed.rows.length).toBe(1));
		expect(spineFeed.a2aRows[0].id).toBe('keep');
		off();
	});

	it('an a2a body with ok:false keeps the previous window rows', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL | Request) =>
				String(url).includes('/api/a2a')
					? new Response(JSON.stringify({ ok: false }), { status: 200 })
					: okSpine()
			)
		);
		spineFeed.a2aRows = [{ id: 'keep' } as never];
		const off = subscribeSpineFeed(() => ['s1']);
		await vi.waitFor(() => expect(spineFeed.rows.length).toBe(1));
		expect(spineFeed.a2aRows[0].id).toBe('keep');
		off();
	});

	it('a THROWING a2a fetch keeps the previous window rows (chip convenience, never a gate)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL | Request) => {
				if (String(url).includes('/api/a2a')) throw new Error('ledger down');
				return okSpine();
			})
		);
		spineFeed.a2aRows = [{ id: 'keep' } as never];
		const off = subscribeSpineFeed(() => ['s1']);
		await vi.waitFor(() => expect(spineFeed.rows.length).toBe(1));
		expect(spineFeed.a2aRows[0].id).toBe('keep');
		off();
	});

	it('the FIRST sender window is fetched, URL-encoded, with the fixed limit', async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) =>
			String(url).includes('/api/a2a') ? okA2a() : okSpine()
		);
		vi.stubGlobal('fetch', fetchMock);
		const off = subscribeSpineFeed(() => ['a b', 'second']);
		await vi.waitFor(() => expect(spineFeed.a2aRows.length).toBe(1));
		const a2aCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/a2a'));
		expect(String(a2aCall?.[0])).toBe('/api/a2a?limit=100&from=a%20b');
		off();
	});
});

describe('generation guard + teardown over-fire', () => {
	it('a reset mid-flight invalidates the slow tick — stale rows never land', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/dsh/sessions')) {
				await gate;
				return new Response(
					JSON.stringify({ ok: true, sessions: [{ sessionId: 'stale', title: 'STALE' }], presets: [] }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			return okA2a();
		});
		vi.stubGlobal('fetch', fetchMock);
		const off = subscribeSpineFeed();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		resetSpineFeedForTests(); // generation += 1 while the load hangs
		release();
		await vi.waitFor(() => expect(spineFeed.a2aRows.length).toBe(0)); // the join's rows are guarded too
		expect(spineFeed.rows).toEqual([]); // the stale spine payload never lands
		off();
	});

	it('double-unsubscribe after teardown is a clamped no-op, never a throw', () => {
		const off = subscribeSpineFeed();
		off();
		expect(() => off()).not.toThrow();
		expect(() => resetSpineFeedForTests()).not.toThrow();
	});
});

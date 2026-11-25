/**
 * The Job Bridge (ADR-0081 D1, the PUSH stage), Task 1.3-T:
 * GET /api/dsh/jobs/stream — the roster-push SSE route. Pins:
 *   - the text/event-stream headers
 *   - ONE relay listener per connection; a dispatched roster frame is
 *     forwarded VERBATIM as ONE unnamed `data:` line `{ sessionId, jobs }`
 *   - fan-out: two connected desks each receive the frame
 *   - NO replay: a frame dispatched before connect produces no bytes
 *   - the listener is RELEASED on body-cancel AND on request abort — the
 *     relay's listener count returns to its prior value, and a frame
 *     dispatched after the release writes no further bytes
 *
 * The relay behind the route is the REAL RpcRelay (its roster registry is
 * pinned in jobs-relay.test.ts); only getDshConnection is mocked. The
 * listener count is read off the real registry — TS `private` compiles to
 * a plain property, so no production test seam is added for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ relay: null as unknown }));

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ relay: holder.relay })
}));

import { RpcRelay } from '../../src/lib/server/connection/rpc-relay';
import type { DsiJobView } from '../../src/lib/types';
import { GET } from '../../src/routes/api/dsh/jobs/stream/+server';

type Registry = { jobRosterListeners: Set<unknown> };

const running: DsiJobView = {
	id: 'bash-1',
	kind: 'bash',
	label: 'npm test',
	owner: 'conv-1',
	status: 'running',
	startedAt: 1,
	output: { total: 0, earliest: 0 }
};

let relay: RpcRelay;
let listenerCount: () => number;

/** Open the route. `start()` runs synchronously on ReadableStream construction,
 *  so the relay listener is registered before GET returns. */
function open(signal?: AbortSignal): Response {
	const request = new Request('http://localhost/api/dsh/jobs/stream', signal ? { signal } : undefined);
	return GET({ request } as never) as Response;
}

async function readOne(res: Response): Promise<string> {
	const reader = res.body!.getReader();
	const chunk = await reader.read();
	expect(chunk.done).toBe(false);
	await reader.cancel();
	return new TextDecoder().decode(chunk.value);
}

const frame = (sessionId: string, jobs: readonly DsiJobView[]): string =>
	'data: ' + JSON.stringify({ sessionId, jobs }) + '\n\n';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
	relay = new RpcRelay({ rpc: vi.fn(() => ({})) } as never, () => 50, {
		answerReapGraceMs: 1000,
		staleGenerationRetryMs: 1000
	});
	holder.relay = relay;
	const registry = relay as unknown as Registry;
	listenerCount = () => registry.jobRosterListeners.size;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/dsh/jobs/stream — the roster push route (The Job Bridge 1.3-T)', () => {
	it('subscribes exactly one relay listener and answers with an SSE stream', async () => {
		const prior = listenerCount();
		const res = open();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(res.headers.get('cache-control')).toBe('no-cache');
		expect(res.headers.get('connection')).toBe('keep-alive');
		expect(listenerCount()).toBe(prior + 1);
		await res.body!.cancel();
		expect(listenerCount()).toBe(prior);
	});

	it('forwards a dispatched roster frame VERBATIM as one unnamed data: line', async () => {
		const res = open();
		relay.dispatchJobRoster('s1', [running]);
		const chunk = await readOne(res);
		expect(chunk).toBe(frame('s1', [running]));
		expect(chunk.startsWith('data: ')).toBe(true);
		expect(chunk.includes('event:')).toBe(false); // named events never reach onmessage
		expect(JSON.parse(chunk.slice(6))).toEqual({ sessionId: 's1', jobs: [running] });
	});

	it('forwards consecutive frames whole and in order — one data: line each', async () => {
		const res = open();
		const stopped: DsiJobView = { ...running, id: 'bash-2', status: 'stopping' };
		relay.dispatchJobRoster('s1', [running, stopped]);
		relay.dispatchJobRoster('s1', [stopped]);
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		const a = decoder.decode((await reader.read()).value);
		const b = decoder.decode((await reader.read()).value);
		await reader.cancel();
		expect(a).toBe(frame('s1', [running, stopped]));
		expect(b).toBe(frame('s1', [stopped]));
	});

	it('fans out — two connected desks each get the frame, each holding its own listener', async () => {
		const prior = listenerCount();
		const deskA = open();
		const deskB = open();
		expect(listenerCount()).toBe(prior + 2);
		relay.dispatchJobRoster('s1', [running]);
		expect(await readOne(deskA)).toBe(frame('s1', [running]));
		expect(await readOne(deskB)).toBe(frame('s1', [running]));
	});

	it('does NOT replay a frame dispatched before connect — the stream stays silent until a live frame', async () => {
		relay.dispatchJobRoster('s1', [running]); // before any listener exists
		const res = open();
		const reader = res.body!.getReader();
		let settled = false;
		const pending = reader.read().then((chunk) => {
			settled = true;
			return chunk;
		});
		await sleep(25);
		expect(settled).toBe(false); // nothing buffered, nothing replayed
		relay.dispatchJobRoster('s2', [running]);
		const chunk = await pending;
		expect(new TextDecoder().decode(chunk.value)).toBe(frame('s2', [running]));
		await reader.cancel();
	});

	it('cancelling the body releases the listener exactly once — a later frame writes nothing', async () => {
		const prior = listenerCount();
		const offs: Array<() => void> = [];
		const orig = relay.onJobRoster.bind(relay);
		vi.spyOn(relay, 'onJobRoster').mockImplementation((listener) => {
			const off = vi.fn(orig(listener));
			offs.push(off);
			return off;
		});
		const res = open();
		expect(listenerCount()).toBe(prior + 1);
		await res.body!.cancel();
		await res.body!.cancel(); // a second cancel must not double-release
		expect(listenerCount()).toBe(prior); // the registry is back to its prior value
		expect(offs).toHaveLength(1);
		expect(offs[0]).toHaveBeenCalledTimes(1);
		// a frame after the release reaches no listener and throws nowhere
		expect(() => relay.dispatchJobRoster('s1', [running])).not.toThrow();
		expect(listenerCount()).toBe(prior);
	});

	it('request abort releases the listener and closes the body — a frame after abort yields NO further bytes', async () => {
		const prior = listenerCount();
		const ac = new AbortController();
		const res = open(ac.signal);
		const reader = res.body!.getReader();
		relay.dispatchJobRoster('s1', [running]);
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame('s1', [running]));

		ac.abort();
		expect(listenerCount()).toBe(prior); // released on abort
		relay.dispatchJobRoster('s1', [running]); // after the release
		const next = await reader.read();
		expect(next.done).toBe(true); // closed — not the frame, not an error
		expect(next.value).toBeUndefined();
	});

	it('abort and cancel on the same connection release once (idempotent release)', async () => {
		const prior = listenerCount();
		const offs: Array<() => void> = [];
		const orig = relay.onJobRoster.bind(relay);
		vi.spyOn(relay, 'onJobRoster').mockImplementation((listener) => {
			const off = vi.fn(orig(listener));
			offs.push(off);
			return off;
		});
		const ac = new AbortController();
		const res = open(ac.signal);
		await res.body!.cancel();
		ac.abort();
		expect(listenerCount()).toBe(prior);
		expect(offs[0]).toHaveBeenCalledTimes(1);
	});

	it('a RELEASED listener is inert — a frame racing the release writes nothing and throws nowhere', async () => {
		// The route's own guard: once released (cancel OR abort), a listener that
		// still fires — a frame already in flight — returns before touching the
		// controller. Drive it DIRECTLY: the relay no longer knows the listener,
		// so only the route's guard stands between the frame and a dead stream.
		const prior = listenerCount();
		let listener: ((sessionId: string, jobs: readonly DsiJobView[]) => void) | null = null;
		const orig = relay.onJobRoster.bind(relay);
		vi.spyOn(relay, 'onJobRoster').mockImplementation((fn) => {
			listener = fn;
			return orig(fn);
		});
		// cancel path
		const cancelled = open();
		const afterCancel = listener!;
		await cancelled.body!.cancel();
		expect(listenerCount()).toBe(prior);
		expect(() => afterCancel('s1', [running])).not.toThrow(); // closed → inert
		// abort path
		const ac = new AbortController();
		open(ac.signal);
		const afterAbort = listener!;
		ac.abort();
		expect(listenerCount()).toBe(prior);
		expect(() => afterAbort('s1', [running])).not.toThrow(); // closed → inert
	});
});

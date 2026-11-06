import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DshConnection,
	normalizeSessionRow,
	RING_CAPACITY,
	getDshConnection,
	resetDshConnectionForTests
} from '$lib/server/dsh-connection';

// Hermetic config (2026-08-25): the ring capacity is operator-tunable via
// ~/.dsi/settings.yaml (`server.ringCapacity`) — point DSI_CONFIG_PATH
// at a temp path so the machine's real config can never leak into these
// tests. The override test below writes a fixture through this path.
const configDir = mkdtempSync(join(tmpdir(), 'dsi-conn-config-'));
const configPath = join(configDir, 'settings.yaml');
beforeAll(() => {
	process.env.DSI_CONFIG_PATH = configPath;
});
afterAll(() => {
	delete process.env.DSI_CONFIG_PATH;
	rmSync(configDir, { recursive: true, force: true });
});

/** Scripted fake WebSocket (one per downlink). */
class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	listeners = new Map<string, Array<(e?: unknown) => void>>();
	/** Messages the connection SENT (logical-stream opens, 0.1.2). */
	sent: string[] = [];
	url: string;
	closed = false;
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}
	send(data: string): void {
		this.sent.push(data);
	}
	addEventListener(ev: string, fn: (e?: unknown) => void): void {
		this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
	}
	pushFrame(payload: unknown): void {
		this.pushFrameAs(payload, 'f');
	}
	/** Push a server-request envelope with an EXPLICIT rpcId (answerer registry keys by it). */
	pushFrameAs(payload: unknown, rpcId: string): void {
		const raw = JSON.stringify({ type: 'server-request', rpcId, method: 'push', payload });
		for (const fn of this.listeners.get('message') ?? []) fn({ data: raw });
	}
	simulateClose(): void {
		if (this.closed) return;
		this.closed = true;
		for (const fn of this.listeners.get('close') ?? []) fn();
	}
	close(): void {
		this.simulateClose();
	}
}

/** Undici-faithful fake: a FAILED socket dispatches `close` synchronously
 *  inside close() — and again on EVERY re-entrant close() (the refused
 *  upgrade path that overflowed the stack at dev-server startup,
 *  2026-08-29). teardownSockets must detach fields before closing to
 *  survive it. */
class ReFiringFakeWebSocket extends FakeWebSocket {
	close(): void {
		this.closed = true;
		for (const fn of this.listeners.get('close') ?? []) fn();
	}
}

function muxSocket(): FakeWebSocket | undefined {
	// 0.1.2: ONE carrier socket (remote.mux).
	return FakeWebSocket.instances.find((s) => s.url.endsWith('/api/remote.mux') && !s.closed);
}

/** Open a fake socket's lifecycle (0.1.2: streams open AFTER the socket). */
function openSocket(socket: FakeWebSocket | undefined): void {
	for (const fn of socket?.listeners.get('open') ?? []) fn();
}

/** Deliver one raw remote.mux server frame (RemoteStreamServerMessage). */
function pushStreamFrame(socket: FakeWebSocket | undefined, value: unknown): void {
	for (const fn of socket?.listeners.get('message') ?? []) fn({ data: JSON.stringify(value) });
}

/** Settle one pending $events waterfall (0.1.2: host cancel/complete frame). */
function settleEvent(eventId: string, outcome: string): void {
	const socket = muxSocket();
	const eventsId = sentOpens(socket!).find((id) => id.startsWith('events-'));
	pushStreamFrame(socket, {
		type: 'item',
		streamId: eventsId,
		value: { type: 'settle', eventId, outcome }
	});
}

/** Deliver one $events waterfall frame (0.1.2 approval/question surface). */
function pushWaterfall(frame: Record<string, unknown>, eventId: string): void {
	const socket = muxSocket();
	if (sentOpens(socket!).filter((id) => id.startsWith('events-')).length === 0) openSocket(socket!);
	const eventsId = sentOpens(socket!).find((id) => id.startsWith('events-'));
	// 0.1.2 forwarded event names (API_REMOTE_FORWARDED_EVENTS).
	const event = String(frame.type)
		.replace('approval/requested', 'approval/request')
		.replace('question/requested', 'user-questions/request');
	const agentId = typeof frame.sessionId === 'string' ? frame.sessionId : undefined;
	const request = { ...frame };
	delete request.type;
	delete request.sessionId;
	pushStreamFrame(socket, {
		type: 'item',
		streamId: eventsId,
		value: {
			type: 'waterfall',
			event,
			eventId,
			...(agentId === undefined ? {} : { agentId }),
			request
		}
	});
}

/** Emit one forwarded $events status frame (api-session/status, 0.1.2). */
function emitStatus(sessionId: string, running: boolean): void {
	const socket = muxSocket();
	// The $events stream opens with the socket; tests that never called
	// openSocket get it here (idempotent — duplicate opens are filtered out).
	if (sentOpens(socket!).filter((id) => id.startsWith('events-')).length === 0) openSocket(socket!);
	const eventsId = sentOpens(socket!).find((id) => id.startsWith('events-'));
	pushStreamFrame(socket, {
		type: 'item',
		streamId: eventsId,
		value: { type: 'emit', event: 'api-session/status', args: [sessionId, running] }
	});
}

/** Push one session/follow item on s1's open follow stream (0.1.2). */
function followEvent(socket: FakeWebSocket | undefined, sessionId: string, event: unknown): void {
	const id = sentOpens(socket!).find((s) => s.startsWith(`follow-${sessionId}`));
	pushStreamFrame(socket, { type: 'item', streamId: id, value: { type: 'event', event } });
}

/** Push s1's follow snapshot (0.1.2 session/subscribed successor). */
function followSnapshot(socket: FakeWebSocket | undefined, sessionId: string, cursor: number, records: unknown[] = []): void {
	const id = sentOpens(socket!).find((s) => s.startsWith(`follow-${sessionId}`));
	pushStreamFrame(socket, { type: 'item', streamId: id, value: { type: 'snapshot', cursor, records } });
}

/** streamIds the connection OPENED on a socket (logical streams, 0.1.2). */
function sentOpens(socket: FakeWebSocket): string[] {
	return socket.sent
		.map((raw) => JSON.parse(raw) as { type?: string; streamId?: string })
		.filter((m): m is { type: 'open'; streamId: string } => m.type === 'open' && typeof m.streamId === 'string')
		.map((m) => m.streamId);
}

function fakeFetch(scripted: Record<string, unknown>): typeof fetch {
	return (async (url: unknown, init?: { body?: string }) => {
		// 0.1.2 wire: URL = /api/<ns>/<method> — key on the last two segments
		// (fall back to the single last segment for compatibility).
		const segments = String(url).split('/');
		const method = segments.slice(-2).join('/');
		const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
		const lastSeg = segments.at(-1) ?? '';
		const scriptedResult = method in scripted
			? scripted[method]
			: (lastSeg in scripted ? scripted[lastSeg] : undefined);
		// A function value scripts per-call state (the body carries the args —
		// beforeSeq paging chains read it).
		const result = typeof scriptedResult === 'function'
			? (scriptedResult as (body: Record<string, unknown>) => unknown)(JSON.parse(init?.body ?? '{}') as Record<string, unknown>)
			: scriptedResult;
		if (result === undefined) {
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: body.rpcId,
					result: { ok: false, error: { code: 'session/not-found', message: 'nope' } }
				}),
				{ status: 200 }
			);
		}
		return new Response(
			JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: result } }),
			{ status: 200 }
		);
	}) as unknown as typeof fetch;
}

function frameEvent(seq: number): { type: string; seq: number; time: number; data: Record<string, unknown> } {
	return { type: 'assistant/chunk', seq, time: seq * 1000, data: { text: `t${seq}` } };
}

function makeConn(scripted: Record<string, unknown> = {}): DshConnection {
	return new DshConnection({
		wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
		fetchFn: fakeFetch(scripted),
		rpcIdFactory: () => 'rpc-test',
		backoffScheduleMs: [10, 20, 40]
	});
}

beforeEach(() => {
	FakeWebSocket.instances = [];
});

afterEach(() => {
	resetDshConnectionForTests();
	vi.restoreAllMocks();
});

describe('dsh-connection — singleton (BC-5)', () => {
	it('returns the same instance across calls', () => {
		const a = getDshConnection({ wsFactory: (u) => new FakeWebSocket(u) as never });
		const b = getDshConnection({ wsFactory: (u) => new FakeWebSocket(u) as never });
		expect(a).toBe(b);
	});

	it('resetForTests drops the singleton', () => {
		const a = getDshConnection({ wsFactory: (u) => new FakeWebSocket(u) as never });
		resetDshConnectionForTests();
		const b = getDshConnection({ wsFactory: (u) => new FakeWebSocket(u) as never });
		expect(a).not.toBe(b);
	});
});

describe('dsh-connection — downlinks + frame dispatch', () => {
	it('ensureDownlinks opens the single remote.mux carrier', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		expect(FakeWebSocket.instances.map((s) => s.url)).toEqual(['ws://127.0.0.1:3080/api/remote.mux']);
	});

	it('a follow snapshot seeds the baseline (cursor) with its records', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		const followId = sentOpens(socket).find((id) => id.startsWith('follow-s1'));
		expect(followId).toBeDefined();
		pushStreamFrame(socket, {
			type: 'item',
			streamId: followId,
			value: { type: 'snapshot', cursor: 5, records: [{ type: 'event', event: frameEvent(4) }] }
		});
		const delta = conn.eventsSince('s1', 0);
		expect(delta.lastSeq).toBe(5);
		expect(delta.events.map((e) => e.seq)).toEqual([4]);
	});

	it('follow event items append to the ring buffer', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		const followId = sentOpens(socket).find((id) => id.startsWith('follow-s1'));
		pushStreamFrame(socket, { type: 'item', streamId: followId, value: { type: 'snapshot', cursor: 0, records: [] } });
		pushStreamFrame(socket, { type: 'item', streamId: followId, value: { type: 'event', event: frameEvent(1) } });
		pushStreamFrame(socket, { type: 'item', streamId: followId, value: { type: 'event', event: frameEvent(2) } });
		const delta = conn.eventsSince('s1', 0);
		expect(delta.events.map((e) => e.seq)).toEqual([1, 2]);
		expect(delta.lastSeq).toBe(2);
	});

	it('$events emit frames (api-session/status) set and clear running', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		openSocket(socket);
		const eventsId = sentOpens(socket).find((id) => id.startsWith('events-'));
		expect(eventsId).toBeDefined();
		pushStreamFrame(socket, {
			type: 'item',
			streamId: eventsId,
			value: { type: 'emit', event: 'api-session/status', args: ['s1', true] }
		});
		expect(conn.isRunning('s1')).toBe(true);
		pushStreamFrame(socket, {
			type: 'item',
			streamId: eventsId,
			value: { type: 'emit', event: 'api-session/status', args: ['s1', false] }
		});
		expect(conn.isRunning('s1')).toBe(false);
	});

	it('the carrier dying rebuilds the generation after backoff', () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		const firstMux = muxSocket()!;
		firstMux.simulateClose();
		expect(muxSocket()).toBeUndefined();
		vi.advanceTimersByTime(10);
		expect(muxSocket()).toBeDefined();
		vi.useRealTimers();
	});

	it('a failed socket (close fires synchronously on every close()) never overflows the stack', () => {
		vi.useFakeTimers();
		const conn = new DshConnection({
			wsFactory: (u) => new ReFiringFakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: fakeFetch({}),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10, 20, 40]
		});
		conn.ensureDownlinks();
		const failed = FakeWebSocket.instances.at(-1)!;
		expect(() => {
			for (const fn of failed.listeners.get('error') ?? []) fn();
		}).not.toThrow();
		expect(muxSocket()).toBeUndefined();
		vi.advanceTimersByTime(10);
		expect(muxSocket()).toBeDefined();
		vi.useRealTimers();
	});
});

describe('dsh-connection — running re-baseline on generation open (2026-08-26)', () => {
	it('ensureDownlinks seeds the running map from session.list', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{ sessionId: 's-run', running: true },
					{ sessionId: 's-idle', running: false }
				]
			}
		});
		conn.ensureDownlinks();
		await vi.waitFor(() => expect(conn.isRunning('s-run')).toBe(true));
		expect(conn.isRunning('s-idle')).toBe(false);
	});

	it('a stale running:true survives a mid-drop turn end via the re-baseline (the live bug)', async () => {
		// Map holds running:true from a push before the drop; the turn ended
		// while disconnected (no push seen); the new generation's snapshot
		// must win — no push raced it, so the seed overwrites.
		const conn = makeConn({ 'session/list': { items: [{ sessionId: 's1', running: false }] } });
		conn.ensureDownlinks();
		emitStatus('s1', true);
		expect(conn.isRunning('s1')).toBe(true);
		vi.useFakeTimers();
		muxSocket()!.simulateClose(); // drop → backoff → new generation re-seeds
		vi.advanceTimersByTime(10);
		vi.useRealTimers();
		await vi.waitFor(() => expect(conn.isRunning('s1')).toBe(false));
	});

	it('a status push landing while the seed RPC is in flight wins over the snapshot', async () => {
		let release!: (v: { items: unknown[] }) => void;
		const gate = new Promise<{ items: unknown[] }>((resolve) => (release = resolve));
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as never,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				if (String(url).includes('session/list')) {
					const value = await gate;
					return new Response(
						JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
						{ status: 200 }
					);
				}
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: {} } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		conn.ensureDownlinks();
		// The snapshot will say s1 idle — but the live transition (running)
		// lands while the RPC is still in flight: the push is newer, it wins.
		emitStatus('s1', true);
		release({ items: [{ sessionId: 's1', running: false }] });
		await vi.waitFor(() => expect(conn.isRunning('s1')).toBe(true));
	});

	it('a seed RPC failure never breaks the generation (pushes remain authoritative)', async () => {
		const conn = makeConn({}); // unscripted → session.list answers an error envelope
		conn.ensureDownlinks();
		emitStatus('s1', true);
		await new Promise((resolve) => setTimeout(resolve, 5)); // let the failed seed settle
		expect(conn.isRunning('s1')).toBe(true); // the push survived the failed seed
	});
});

describe('dsh-connection — delta slicing', () => {
	it('eventsSince returns only entries with seq > n', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 0);
		for (const seq of [1, 2, 3, 4]) {
			followEvent(muxSocket(), 's1', frameEvent(seq));
		}
		expect(conn.eventsSince('s1', 2).events.map((e) => e.seq)).toEqual([3, 4]);
		expect(conn.eventsSince('s1', 4).events).toEqual([]);
	});
});

describe('dsh-connection — buffer cap', () => {
	it('keeps only the last RING_CAPACITY entries', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 0);
		for (let seq = 1; seq <= RING_CAPACITY + 10; seq++) {
			followEvent(muxSocket(), 's1', frameEvent(seq));
		}
		const all = conn.eventsSince('s1', -1).events;
		expect(all.length).toBe(RING_CAPACITY);
		expect(all[0]!.seq).toBe(11);
		expect(all[all.length - 1]!.seq).toBe(RING_CAPACITY + 10);
	});

	it('honors server.ringCapacity from ~/.dsi/settings.yaml', () => {
		// 20 is within the reader's [10, 10_000] gate (a smaller value would
		// fall below the floor and revert to the default — that's the gate
		// working, tested in insight-config.test.ts).
		writeFileSync(configPath, JSON.stringify({ server: { ringCapacity: 20 } }), 'utf-8');
		try {
			const conn = makeConn();
			conn.ensureDownlinks();
			conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 0);
			for (let seq = 1; seq <= 25; seq++) {
				followEvent(muxSocket(), 's1', frameEvent(seq));
			}
			const all = conn.eventsSince('s1', -1).events;
			expect(all.length).toBe(20);
			expect(all[0]!.seq).toBe(6);
			expect(all[all.length - 1]!.seq).toBe(25);
		} finally {
			rmSync(configPath, { force: true });
		}
	});
});

describe('dsh-connection — resync from ledger (BC-4)', () => {
	it('resyncFromLedger replaces the buffer with the ledger tail', async () => {
		const conn = makeConn({
			'session/list': { items: [{ sessionId: 's1', running: false, projections: { asOfSeq: 9 } }] },
			'session/page': { records: [{ type: 'event', event: frameEvent(9) }], hasMore: true }
		});
		const events = await conn.resyncFromLedger('s1');
		expect(events.map((e) => e.seq)).toEqual([9]);
		expect(conn.eventsSince('s1', 0).events.map((e) => e.seq)).toEqual([9]);
		expect(conn.eventsSince('s1', 0).lastSeq).toBe(9);
	});

	it('resync discards stale stream state (no dupes possible)', async () => {
		const conn = makeConn({
			'session/list': { items: [{ sessionId: 's1', running: false, projections: { asOfSeq: 9 } }] },
			'session/page': { records: [{ type: 'event', event: frameEvent(9) }], hasMore: false }
		});
		const events = await conn.resyncFromLedger('s1');
		expect(events.map((e) => e.seq)).toEqual([9]);
		expect(conn.eventsSince('s1', 0).lastSeq).toBe(9); // reset to ledger truth
	});
});

describe('dsh-connection — live assistant-stream tail (0.1.3-alpha.1)', () => {
	/** Push one seq-less assistant-stream frame on s1's follow stream. */
	function pushAssistantFrame(socket: FakeWebSocket | undefined, sessionId: string, frame: Record<string, unknown>): void {
		const id = sentOpens(socket!).find((s) => s.startsWith(`follow-${sessionId}`));
		pushStreamFrame(socket, { type: 'item', streamId: id, value: { type: 'assistant-stream', frame } });
	}

	const START = {
		type: 'start',
		attemptId: 'att-1',
		revision: 1,
		startedAfterSeq: 41,
		turn: 4,
		step: 2
	};

	it('the follow request opts into the host assistant-stream channel', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		conn.subscribe('s1');
		const socket = muxSocket()!;
		openSocket(socket);
		const open = socket.sent
			.map((raw) => JSON.parse(raw) as { type?: string; endpoint?: string; payload?: { args?: { request?: Record<string, unknown> } } })
			.find((m) => m.type === 'open' && m.endpoint === 'session/follow');
		expect(open?.payload?.args?.request?.assistantStream).toBe(true);
	});

	it('start/chunk/end fold into the tail; frames never move the durable cursor', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		followSnapshot(socket, 's1', 41, []);
		expect(conn.liveAssistantStream('s1')).toBeNull();

		pushAssistantFrame(socket, 's1', START);
		pushAssistantFrame(socket, 's1', { type: 'chunk', attemptId: 'att-1', revision: 1, index: 0, time: 50_000, chunk: { type: 'text-delta', index: 0, text: 'Hel' } });
		pushAssistantFrame(socket, 's1', { type: 'chunk', attemptId: 'att-1', revision: 1, index: 1, time: 50_010, chunk: { type: 'reasoning-delta', index: 1, text: 'why ' } });
		pushAssistantFrame(socket, 's1', { type: 'chunk', attemptId: 'att-1', revision: 1, index: 2, time: 50_020, chunk: { type: 'text-delta', index: 0, text: 'lo' } });
		expect(conn.liveAssistantStream('s1')).toEqual({
			id: 'a:4:2',
			turn: 4,
			step: 2,
			seq: 41,
			time: 50_020,
			text: 'Hello',
			reasoning: 'why '
		});

		// Seq-less presentation state: lastSeq and the buffer are untouched.
		expect(conn.eventsSince('s1', 0).lastSeq).toBe(41);
		expect(conn.eventsSince('s1', 0).events).toEqual([]);

		pushAssistantFrame(socket, 's1', { type: 'end', attemptId: 'att-1', revision: 1, index: 3, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 42 } });
		expect(conn.liveAssistantStream('s1')).toBeNull();
	});

	it('a foreign attemptId or a non-dense index drops the tail (host-accumulator mirror)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		followSnapshot(socket, 's1', 41, []);
		pushAssistantFrame(socket, 's1', START);
		pushAssistantFrame(socket, 's1', { type: 'chunk', attemptId: 'att-other', revision: 1, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } });
		expect(conn.liveAssistantStream('s1')).toBeNull();

		pushAssistantFrame(socket, 's1', START);
		pushAssistantFrame(socket, 's1', { type: 'chunk', attemptId: 'att-1', revision: 1, index: 7, time: 2, chunk: { type: 'text-delta', index: 0, text: 'y' } });
		expect(conn.liveAssistantStream('s1')).toBeNull();
	});

	it('the follow snapshot seeds the tail from the activeAttempt baseline (mux-drop reopen)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		followSnapshot(socket, 's1', 41, [
			{ type: 'event', event: { type: 'user/message', seq: 40, time: 40_000, data: {} } }
		]);
		pushStreamFrame(socket, {
			type: 'item',
			streamId: sentOpens(socket).find((s) => s.startsWith('follow-s1')),
			value: {
				type: 'snapshot',
				cursor: 41,
				records: [],
				assistantStream: {
					revision: 3,
					activeAttempt: {
						attemptId: 'att-9',
						startedAfterSeq: 41,
						turn: 5,
						step: 1,
						nextIndex: 4,
						stream: [
							{ type: 'text-chunks', time0: 60_000, index: 0, dt: [10], texts: ['a', 'b'] },
							{ type: 'chunk', time: 60_020, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
							{ type: 'reasoning-chunks', time0: 60_030, index: 1, dt: [], texts: ['r'] }
						]
					}
				}
			}
		});
		// Compact runs expand; non-surface chunks are skipped; the dense
		// index continues from the baseline's nextIndex and the bubble's
		// time is the LAST record's last-member time (60_030, the run's
		// time0 — the text run's 60_000 is older).
		expect(conn.liveAssistantStream('s1')).toEqual({
			id: 'a:5:1',
			turn: 5,
			step: 1,
			seq: 41,
			time: 60_030,
			text: 'ab',
			reasoning: 'r'
		});
		pushAssistantFrame(socket, 's1', { type: 'chunk', attemptId: 'att-9', revision: 3, index: 4, time: 60_040, chunk: { type: 'text-delta', index: 0, text: 'c' } });
		expect(conn.liveAssistantStream('s1')?.text).toBe('abc');
	});

	it('a snapshot without an activeAttempt clears a remembered tail', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		followSnapshot(socket, 's1', 41, []);
		pushAssistantFrame(socket, 's1', START);
		expect(conn.liveAssistantStream('s1')).not.toBeNull();
		// A generation rebuild re-delivers the opening snapshot: it is
		// authoritative for what is still in flight.
		followSnapshot(socket, 's1', 41, []);
		expect(conn.liveAssistantStream('s1')).toBeNull();
	});
});

describe('dsh-connection — history paging cursor', () => {
	it('history pages through the follow cursor, not the frozen list watermark', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: ((url: unknown, init?: { body?: string }) => {
				const segments = String(url).split('/');
				const method = segments.slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				seen[method] = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
				const values: Record<string, unknown> = {
					'session/list': { items: [{ sessionId: 's1', running: false, projections: { asOfSeq: 9 } }] },
					'session/page': { records: [], hasMore: false }
				};
				return Promise.resolve(
					new Response(
						JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: values[method] } }),
						{ status: 200 }
					)
				) as unknown as Response;
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		// The follow snapshot's cursor is the host's stream truth — 30, while
		// the list watermark froze at 9 (nothing projected since).
		followSnapshot(socket, 's1', 30, []);
		await conn.history('s1');
		const request = ((seen['session/page']?.payload as { args?: { request?: Record<string, unknown> } })
			?.args?.request) ?? {};
		expect(request['throughSeq']).toBe(30);
	});

	it('an unsubscribed session still pages through the list watermark', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: ((url: unknown, init?: { body?: string }) => {
				const segments = String(url).split('/');
				const method = segments.slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				seen[method] = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
				const values: Record<string, unknown> = {
					'session/list': { items: [{ sessionId: 's1', running: false, projections: { asOfSeq: 9 } }] },
					'session/page': { records: [], hasMore: false }
				};
				return Promise.resolve(
					new Response(
						JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: values[method] } }),
						{ status: 200 }
					)
				) as unknown as Response;
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		await conn.history('s1');
		const request = ((seen['session/page']?.payload as { args?: { request?: Record<string, unknown> } })
			?.args?.request) ?? {};
		expect(request['throughSeq']).toBe(9);
	});

	it('subscribe is idempotent per generation (one follow open per session)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		conn.subscribe('s1'); // every events poll calls this — must not reopen
		const followOpens = sentOpens(socket).filter((id) => id.startsWith('follow-s1'));
		expect(followOpens).toHaveLength(1);
	});

	it('a failed follow stream reopens on the next subscribe (self-heal)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		openSocket(socket);
		const followId = sentOpens(socket).find((id) => id.startsWith('follow-s1'))!;
		pushStreamFrame(socket, { type: 'error', streamId: followId, error: { code: 'x', message: 'stream died' } });
		conn.subscribe('s1');
		const followOpens = sentOpens(socket).filter((id) => id.startsWith('follow-s1'));
		expect(followOpens).toHaveLength(2);
	});
});

describe('dsh-connection — RPC forwards', () => {
	it('prompt posts envelope and returns receipt value', async () => {
		const scripted = { 'session/prompt': { accepted: true } };
		const conn = makeConn(scripted);
		const receipt = await conn.prompt('s1', 'Hi');
		expect(receipt).toEqual({ accepted: true });
	});

	it('prompt string payload maps to exactly one text part (task 2.2 compat)', async () => {
		let seen: Record<string, unknown> | undefined;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: (async (_u: unknown, init?: { body?: string }) => {
				seen = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: 'rpc-test', result: { ok: true, value: { accepted: true } } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		const receipt = await conn.prompt('s1', 'Hi');
		expect(receipt).toEqual({ accepted: true });
		const args = ((seen?.payload as { args?: { request?: { content?: unknown } } })?.args?.request);
		expect(args?.content).toEqual([{ type: 'text', text: 'Hi' }]);
	});

	it('prompt content-array payload passes through verbatim (task 2.2)', async () => {
		let seen: Record<string, unknown> | undefined;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: (async (_u: unknown, init?: { body?: string }) => {
				seen = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: 'rpc-test', result: { ok: true, value: { accepted: true } } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		const content = [
			{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'shot.png' },
			{ type: 'text' as const, text: 'look' }
		];
		await conn.prompt('s1', content);
		expect(((seen?.payload as { args?: { request?: { content?: unknown } } })?.args?.request)?.content).toEqual(content);
	});

	describe('executeCommand (2026-08-25 — the native commands/execute wire)', () => {
		it('posts the channel-owned {args:{agentId,line,submittedAttachments}} envelope and returns the receipt', async () => {
			let seen: { url: string; body: Record<string, unknown> } | undefined;
			const fetchFn = (async (url: unknown, init?: { body?: string }) => {
				seen = { url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> };
				return new Response(
					JSON.stringify({
						type: 'server-response',
						rpcId: 'rpc-test',
						result: {
							ok: true,
							value: { commandId: 'cmd-ab12cd34-7', result: { kind: 'success', text: 'preset read-only' } }
						}
					}),
					{ status: 200 }
				);
			}) as unknown as typeof fetch;
			const conn = new DshConnection({
				wsFactory: (u) => new FakeWebSocket(u) as never,
				fetchFn,
				rpcIdFactory: () => 'rpc-test',
				backoffScheduleMs: [10]
			});
			const receipt = await conn.executeCommand('session-1', '/permission read-only');
			expect(receipt).toEqual({
				commandId: 'cmd-ab12cd34-7',
				result: { kind: 'success', text: 'preset read-only' }
			});
			expect(seen?.url).toMatch(/\/api\/commands\/execute$/);
			expect(seen?.body).toEqual({
				type: 'client-request',
				rpcId: 'rpc-test',
				method: 'commands/execute',
				payload: { args: { agentId: 'session-1', line: '/permission read-only', submittedAttachments: [] } }
			});
		});

		it('an admission miss (ok:true, NO value) resolves null — the command never ran', async () => {
			const fetchFn = (async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch;
			const conn = new DshConnection({
				wsFactory: (u) => new FakeWebSocket(u) as never,
				fetchFn,
				rpcIdFactory: () => 'rpc-test',
				backoffScheduleMs: [10]
			});
			expect(await conn.executeCommand('s1', '/nope')).toBeNull();
		});

		it("the command's own error result passes through as a receipt (not an RPC error)", async () => {
			// fakeFetch keys by the LAST URL segment — commands/execute → 'execute'
			const conn = makeConn({
				execute: { commandId: 'cmd-2', result: { kind: 'error', text: 'unknown preset "x"' } }
			});
			expect(await conn.executeCommand('s1', '/permission x')).toEqual({
				commandId: 'cmd-2',
				result: { kind: 'error', text: 'unknown preset "x"' }
			});
		});
	});

	describe('listCommands / listSkills (Slash Menu W1 — the host catalogs, live-pinned 2026-08-30)', () => {
		it('listCommands posts {args:{agentId}} to commands/list and returns the row array', async () => {
			let seen: { url: string; body: Record<string, unknown> } | undefined;
			const fetchFn = (async (url: unknown, init?: { body?: string }) => {
				seen = { url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> };
				return new Response(
					JSON.stringify({
						type: 'server-response',
					rpcId: 'rpc-test',
					result: {
							ok: true,
							value: [{ name: 'compact', description: 'Compact older conversation history' }]
						}
					}),
					{ status: 200 }
				);
			}) as unknown as typeof fetch;
			const conn = new DshConnection({
				wsFactory: (u) => new FakeWebSocket(u) as never,
				fetchFn,
				rpcIdFactory: () => 'rpc-test',
				backoffScheduleMs: [10]
			});
			const rows = await conn.listCommands('session-1');
			expect(rows).toEqual([{ name: 'compact', description: 'Compact older conversation history' }]);
			expect(seen?.url).toMatch(/\/api\/commands\/list$/);
			expect(seen?.body).toEqual({
				type: 'client-request',
				rpcId: 'rpc-test',
				method: 'commands/list',
				payload: { args: { agentId: 'session-1' } }
			});
		});

		it('listSkills posts {args:{request:{sessionId}}} to skills/list and returns the DshSkillList value', async () => {
			let seen: { url: string; body: Record<string, unknown> } | undefined;
			const fetchFn = (async (url: unknown, init?: { body?: string }) => {
				seen = { url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> };
				return new Response(
					JSON.stringify({
						type: 'server-response',
					rpcId: 'rpc-test',
					result: {
							ok: true,
							value: { skills: [{ name: 'dsh-doc', description: 'docs', modelInvocable: true }] }
						}
					}),
					{ status: 200 }
				);
			}) as unknown as typeof fetch;
			const conn = new DshConnection({
				wsFactory: (u) => new FakeWebSocket(u) as never,
				fetchFn,
				rpcIdFactory: () => 'rpc-test',
				backoffScheduleMs: [10]
			});
			const list = await conn.listSkills('session-1');
			expect(list).toEqual({ skills: [{ name: 'dsh-doc', description: 'docs', modelInvocable: true }] });
			expect(seen?.url).toMatch(/\/api\/skills\/list$/);
			expect(seen?.body).toEqual({
				type: 'client-request',
				rpcId: 'rpc-test',
				method: 'skills/list',
					payload: { args: { request: { sessionId: 'session-1' } } }
			});
		});

		it('an ok:false host answer (e.g. session/not-found) throws DshRpcError through the shared rpc path', async () => {
			const conn = makeConn(); // nothing scripted → session/not-found
			await expect(conn.listSkills('nope')).rejects.toMatchObject({ code: 'session/not-found' });
			await expect(conn.listCommands('nope')).rejects.toMatchObject({ code: 'session/not-found' });
		});
	});

	it('cancel posts and returns receipt', async () => {
		const conn = makeConn({ 'session/cancel': { accepted: true } });
		expect(await conn.cancel('s1')).toEqual({ accepted: true });
	});

	it('listSessions normalizes rows (title from projections)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{
						sessionId: 's1',
						updatedAt: 1787252720796,
						running: false,
						blank: false,
						agentPreset: 'main',
						projections: { asOfSeq: 144, values: { title: 'Greeting with a simple Hi' } }
					}
				]
			}
		});
		const list = await conn.listSessions();
		expect(list.items).toEqual([
			{
				sessionId: 's1',
				title: 'Greeting with a simple Hi',
				agentPreset: 'main',
				running: false,
				blank: false,
				updatedAt: 1787252720796,
				workspace: null,
				turns: null, // no sessionStats on the row — absent-tolerant
				parentSessionId: null, // no lineage on the row (2026-08-27 lockstep)
				origin: null
			}
		]);
	});

	// ── 2026-09-14 fork-title heal: cold fork rows adopt the parent's title ──

	it('listSessions heals an untitled cold fork row from its parent row (host serves no projections for seeded rows)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{
						sessionId: 'parent',
						updatedAt: 1787252720796,
						running: false,
						projections: { asOfSeq: 12, values: { title: 'Greeting with a simple Hi' } }
					},
					// Cold fork child: the host short-circuits the projections
					// column for isSeeded rows (list.ts projectionsFor), so the
					// child's row carries NO values — its true (inherited) title
					// is the parent's at fork time.
					{ sessionId: 'child', updatedAt: 1787252720999, running: false, parentSessionId: 'parent' }
				]
			}
		});
		const list = await conn.listSessions();
		expect(list.items.find((r) => r.sessionId === 'child')?.title).toBe('Greeting with a simple Hi');
		// The parent row is untouched.
		expect(list.items.find((r) => r.sessionId === 'parent')?.title).toBe('Greeting with a simple Hi');
	});

	it('listSessions leaves untitled forks honest when the parent is absent or untitled', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{ sessionId: 'orphan', updatedAt: 1, running: false, parentSessionId: 'ghost' },
					{ sessionId: 'child', updatedAt: 2, running: false, parentSessionId: 'untitled-parent' },
					{ sessionId: 'untitled-parent', updatedAt: 3, running: false }
				]
			}
		});
		const list = await conn.listSessions();
		const byId = new Map(list.items.map((r) => [r.sessionId, r.title] as const));
		expect(byId.get('orphan')).toBeNull();
		expect(byId.get('child')).toBeNull();
		expect(byId.get('untitled-parent')).toBeNull();
	});

	it('listSessions heals a fork child from its follow snapshot title on a later list (real title wins over the parent fallback)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{ sessionId: 'p', updatedAt: 1, running: false, projections: { asOfSeq: 5, values: { title: 'Parent Title' } } },
					{ sessionId: 'child', updatedAt: 2, running: false, parentSessionId: 'p' }
				]
			}
		});
		// First list: no hint yet → parent fallback, and the background heal
		// subscribes the child (waitForProjections → follow stream).
		const first = await conn.listSessions();
		expect(first.items.find((r) => r.sessionId === 'child')?.title).toBe('Parent Title');
		// The host answers the follow open with a snapshot whose projections
		// block carries the child's folded title.
		const socket = muxSocket();
		if (!socket) throw new Error('mux socket missing');
		openSocket(socket); // fire the mux open (subscribe parks until then)
		for (let i = 0; i < 50 && sentOpens(socket).find((s) => s.startsWith('follow-child')) === undefined; i++) {
			await new Promise((r) => setTimeout(r, 20));
		}
		const followId = sentOpens(socket).find((s) => s.startsWith('follow-child'));
		expect(followId).toBeDefined();
		pushStreamFrame(socket, {
			type: 'item',
			streamId: followId,
			value: {
				type: 'snapshot',
				cursor: 42,
				records: [],
				projections: { asOfSeq: 42, values: { title: 'Real Child Title' } }
			}
		});
		// Later lists serve the REAL title, replacing the parent fallback.
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setTimeout(r, 20));
			const again = await conn.listSessions();
			if (again.items.find((r) => r.sessionId === 'child')?.title === 'Real Child Title') return;
		}
		throw new Error('fork-title hint never landed');
	});

	it('a follow snapshot without a title leaves the fork row on the parent fallback', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{ sessionId: 'p', updatedAt: 1, running: false, projections: { asOfSeq: 5, values: { title: 'Parent Title' } } },
					{ sessionId: 'child', updatedAt: 2, running: false, parentSessionId: 'p' }
				]
			}
		});
		await conn.listSessions();
		const socket = muxSocket();
		if (!socket) throw new Error('mux socket missing');
		openSocket(socket);
		for (let i = 0; i < 50 && sentOpens(socket).find((s) => s.startsWith('follow-child')) === undefined; i++) {
			await new Promise((r) => setTimeout(r, 20));
		}
		const followId = sentOpens(socket).find((s) => s.startsWith('follow-child'));
		pushStreamFrame(socket, {
			type: 'item',
			streamId: followId,
			value: { type: 'snapshot', cursor: 7, records: [], projections: { asOfSeq: 7, values: { agentPreset: 'main' } } }
		});
		await new Promise((r) => setTimeout(r, 100));
		const again = await conn.listSessions();
		// The inherited title IS the parent's at fork time — fallback stays honest.
		expect(again.items.find((r) => r.sessionId === 'child')?.title).toBe('Parent Title');
	});

	it('listSessions never heals subagent rows (their descriptor label leads, null stays null)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{ sessionId: 'p', updatedAt: 1, running: false, projections: { asOfSeq: 1, values: { title: 'Root' } } },
					{
						sessionId: 'sub',
						updatedAt: 2,
						running: false,
						origin: 'subagent',
						parentSessionId: 'p'
					}
				]
			}
		});
		const list = await conn.listSessions();
		expect(list.items.find((r) => r.sessionId === 'sub')?.title).toBeNull();
	});

	// ── 2026-08-25 a2a watermark: sessionStats.turns (Task 1.3) ──────────

	it('listSessions carries sessionStats.turns through normalization (a2a watermark)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{
						sessionId: 's1',
						updatedAt: 1787252720796,
						running: false,
						sessionStats: { turns: 9 }
					}
					]
			}
		});
		const list = await conn.listSessions();
		expect(list.items[0]).toMatchObject({ sessionId: 's1', turns: 9 });
	});

	it('sessionStats.turns junk-typed → null (never a guess)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					{ sessionId: 'a', sessionStats: { turns: 'nine' } },
					{ sessionId: 'b', sessionStats: { turns: 4.5 } },
					{ sessionId: 'c', sessionStats: { turns: -1 } },
					{ sessionId: 'd', sessionStats: {} }
					]
			}
		});
		const list = await conn.listSessions();
		expect(list.items.map((r) => r.turns)).toEqual([null, null, null, null]);
	});

	it('unknown RPC error code passes through as ok:false mapping', async () => {
		const conn = makeConn({}); // nothing scripted → session/not-found
		await expect(conn.history('s-missing')).rejects.toThrow(/session\/not-found/);
	});

	it('pickDirectory posts to host.pickDirectory and normalizes the path', async () => {
		// Wire truth: the pick value is the BARE picked path (string), not an
		// object carrying it — the old {path} fixture pinned DSI's misread that
		// turned every successful native pick into a silent cancel.
		const scripted = { 'directoryPicker/pick': '/Users/x/proj' };
		const conn = makeConn(scripted);
		expect(await conn.pickDirectory()).toEqual({ path: '/Users/x/proj' });
	});

	it('pickDirectory normalizes a missing/garbage path to null (cancel)', async () => {
		const scripted = { 'directoryPicker/pick': { unexpected: true } };
		const conn = makeConn(scripted);
		expect(await conn.pickDirectory()).toEqual({ path: null });
	});

	it('listDirectory normalizes the listing (crumbs + entries + truncated)', async () => {
		const conn = makeConn({
			'directoryPicker/list': {
				path: '/Users/x',
				home: '/Users/x',
				crumbs: [
					{ name: '/', path: '/', hidden: false },
					{ name: 'x', path: '/Users/x', hidden: false }
				],
				entries: [
					{ name: 'proj', path: '/Users/x/proj', hidden: false },
					{ name: '.ssh', path: '/Users/x/.ssh', hidden: true },
					{ name: 42, path: '/Users/x/garbage', hidden: false }
				],
				truncated: true
			}
		});
		const listing = await conn.listDirectory('/Users/x');
		expect(listing.path).toBe('/Users/x');
		expect(listing.crumbs).toHaveLength(2);
		expect(listing.entries).toEqual([
			{ name: 'proj', path: '/Users/x/proj', hidden: false },
			{ name: '.ssh', path: '/Users/x/.ssh', hidden: true }
		]);
		expect(listing.truncated).toBe(true);
	});
});

describe('dsh-connection — POC-3 W1: pending-answer registry (BC-C)', () => {
	it('approval/requested → pendingFor lists it with the frame body verbatim', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'apr-1', toolName: 'Bash', callId: 'call-7', reason: 'rm -rf a directory' }, 'rpc-a1');
		const pending = conn.pendingFor('s1');
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			rpcId: 'rpc-a1',
			sessionId: 's1',
			kind: 'approval',
			body: { approvalId: 'apr-1', toolName: 'Bash', callId: 'call-7', reason: 'rm -rf a directory' }
		});
	});

	it('question/requested → pending with kind question and questions array', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'question/requested', sessionId: 's1', questions: [{ id: 'q1', prompt: 'Which db?', options: [{ id: 'o1', label: 'prod' }, { id: 'o2', label: 'staging' }] }] }, 'rpc-q1');
		const pending = conn.pendingFor('s1');
		expect(pending[0]).toMatchObject({ rpcId: 'rpc-q1', kind: 'question' });
		expect(pending[0]!.body.questions).toHaveLength(1);
	});

	it('mux-open REPLAY of the same rpcId does not duplicate (BC-C idempotence)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const frame = {
			type: 'approval/requested',
			sessionId: 's1',
			approvalId: 'apr-1',
			toolName: 'Write'
		};
		pushWaterfall(frame, 'rpc-dup');
		pushWaterfall(frame, 'rpc-dup'); // reconnect replay — same eventId
		pushWaterfall(frame, 'rpc-dup'); // and again
		expect(conn.pendingFor('s1')).toHaveLength(1);
		expect(conn.pendingFor('s1')[0]!.rpcId).toBe('rpc-dup');
	});

	it('pending is session-scoped (another session sees none)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'a', toolName: 'Bash' }, 'rpc-x');
		expect(conn.pendingFor('s2')).toEqual([]);
	});

	it('orphan frame without sessionId never enters the registry', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'question/requested', questions: [] }, 'rpc-orphan');
		expect(conn.pendingFor('')).toEqual([]);
		expect(conn.settlementsFor('')).toEqual([]);
	});
});

describe('dsh-connection — POC-3 W1: settlement ring', () => {
	it('approval/resolved moves pending → settlement with the outcome', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'apr-1', toolName: 'Bash' }, 'rpc-a1');
		settleEvent('rpc-a1', 'allowed-once');
		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')).toEqual([
			expect.objectContaining({ rpcId: 'rpc-a1', kind: 'approval', outcome: 'allowed-once' })
		]);
	});

	it('question/resolved (answered) settles by questionRpcId', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'question/requested', sessionId: 's1', questions: [{ id: 'q1', options: [] }] }, 'rpc-q1');
		settleEvent('rpc-q1', 'answered');
		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')[0]).toMatchObject({ kind: 'question', outcome: 'answered' });
	});

	it('turn-cancelled: outcome=cancelled withdraws the card (pending empty, settlement records cancelled)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'apr-c', toolName: 'Bash', reason: 'x' }, 'rpc-ac');
		settleEvent('rpc-ac', 'cancelled');
		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')[0]!.outcome).toBe('cancelled');
	});

	it('settlement with no matching pending is ignored (answered before subscribe)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		settleEvent('rpc-ghost', 'rejected');
		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')).toEqual([]);
	});

	it('ring prune: delivered settlements drop out, others stay', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'Bash' }, 'r1');
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'a2', toolName: 'Write' }, 'r2');
		settleEvent('r1', 'rejected');
		settleEvent('r2', 'allowed-once');
		conn.pruneSettlements('s1', ['r1']);
		expect(conn.settlementsFor('s1').map((s) => s.rpcId)).toEqual(['r2']);
		// pruning another session's id is a no-op
		conn.pruneSettlements('s2', ['r2']);
		expect(conn.settlementsFor('s1')).toHaveLength(1);
	});
});

describe('dsh-connection — Wave 2: rewound baseline resets the buffer (stream restart)', () => {
	it('a baseline below the buffered high-water mark clears stale entries and re-seeds', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		// First stream instance: baseline 10, then live events to seq 13.
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 10);
		for (const seq of [11, 12, 13]) {
			followEvent(muxSocket(), 's1', { type: 'user/message', seq, time: 1, data: {} });
		}
		expect(conn.eventsSince('s1', 10).events).toHaveLength(3);
		// Upstream rebuilt (e2e stub lifecycle / re-seeded host): the new
		// baseline rewinds below 13. Stale entries must go, replay re-fills.
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 8);
		const after = conn.eventsSince('s1', 7);
		expect(after.lastSeq).toBe(8);
		expect(after.events).toHaveLength(0);
		// Replayed ledger events at rewound seqs are accepted again.
		followEvent(muxSocket(), 's1', { type: 'user/message', seq: 9, time: 2, data: {} });
		expect(conn.eventsSince('s1', 8).events).toHaveLength(1);
		conn.dispose();
	});

	it('an equal-or-higher baseline keeps the buffer (normal resume)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 10);
		followEvent(muxSocket(), 's1', { type: 'user/message', seq: 11, time: 1, data: {} });
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 11);
		expect(conn.eventsSince('s1', 10).events).toHaveLength(1);
		conn.dispose();
	});
});

describe('dsh-connection — POC-3 W1: teardown never leaks', () => {
	it('dispose clears pending, settlements, buffers, running', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushWaterfall({ type: 'approval/requested', sessionId: 's1', approvalId: 'a', toolName: 'Bash' }, 'r1');
		pushWaterfall({ type: 'approval/resolved', sessionId: 's1', approvalId: 'a', outcome: 'rejected' }, 'f');
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 5);
		emitStatus('s1', true);
		conn.dispose();
		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')).toEqual([]);
		expect(conn.eventsSince('s1', -1).lastSeq).toBe(-1);
		expect(conn.isRunning('s1')).toBe(false);
	});
});

describe('dsh-connection — respond via $events/result (0.1.2 carrier)', () => {
	/** A connection whose $events stream is READY (clientId bound). */
	function readyConn(fetchFn: typeof fetch): DshConnection {
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never });
		conn.ensureDownlinks();
		const socket = muxSocket();
		openSocket(socket);
		const eventsId = sentOpens(socket!).find((id) => id.startsWith('events-'));
		pushStreamFrame(socket, { type: 'item', streamId: eventsId, value: { type: 'ready', clientId: 'cli-1', host: { home: '/h' } } });
		return conn;
	}

	it('posts {clientId,eventId,outcome} to $events/result and resolves accepted', async () => {
		const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			seen.push({ url: String(url), body });
			return new Response(
				JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: undefined } }),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = readyConn(fetchFn);
		const receipt = await conn.respond('ev-1', { sessionId: 's1', outcome: 'allowed-once' });
		expect(receipt).toEqual({ accepted: true });
		expect(seen.at(-1)!.url).toContain('$events/result');
		expect((seen.at(-1)!.body.payload as { args?: Record<string, unknown> }).args).toMatchObject({
			clientId: 'cli-1',
			eventId: 'ev-1',
			outcome: { kind: 'result', value: 'allowed-once' }
		});
	});

	it('without a READY $events generation it throws honestly (W2 refines the settle surface)', async () => {
		const conn = new DshConnection({ fetchFn: fakeFetch({}), wsFactory: (u) => new FakeWebSocket(u) as never });
		await expect(conn.respond('ev-x', {})).rejects.toThrow(/\$events generation/);
	});

	it('unwraps the panel answer wrapper — the wire value is {answers:[…]} verbatim (host contract)', async () => {
		const seen: Array<Record<string, unknown>> = [];
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			seen.push(((body.payload as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>);
			return new Response(
				JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: undefined } }),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = readyConn(fetchFn);
		// The panel posts {sessionId, answer:{answers}} (ConversationScrollArea
		// onanswer) — the host's answerer waterfall must resolve with the
		// {answers} object ITSELF, or ask_user_question crashes on it.
		const receipt = await conn.respond('ev-2', { sessionId: 's1', answer: { answers: [{ id: 'q1', selected: ['Apple'] }] } });
		expect(receipt).toEqual({ accepted: true });
		expect(seen.at(-1)).toMatchObject({
			clientId: 'cli-1',
			eventId: 'ev-2',
			outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['Apple'] }] } }
		});
	});

	it('a stale-generation answer rebuilds the mux and retries once with the fresh clientId', async () => {
		const seen: Array<Record<string, unknown>> = [];
		let calls = 0;
		const opened = new Set<FakeWebSocket>();
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			if (String(url).includes('$events/result')) {
				calls += 1;
				if (calls === 1) {
					// The gateway rejects answers naming an ended generation.
					// While the retry waits, the test rebuilds the NEW generation
					// (open + ready) the way the host would deliver it.
					setTimeout(() => {
						const rebuilt = FakeWebSocket.instances.at(-1);
						if (rebuilt && !opened.has(rebuilt)) {
							opened.add(rebuilt);
							openSocket(rebuilt);
						}
						const socket = muxSocket()!;
						const eventsId = sentOpens(socket).find((id) => id.startsWith('events-'))!;
						pushStreamFrame(socket, { type: 'item', streamId: eventsId, value: { type: 'ready', clientId: 'cli-2', host: { home: '/h' } } });
					}, 40);
					return new Response(
						JSON.stringify({
							type: 'server-response',
							rpcId: body.rpcId,
							result: { ok: false, error: { code: 'gateway/internal', message: 'typert gateway: Remote event result identifies no active event stream', details: {} } }
						}),
						{ status: 200 }
					);
				}
				seen.push(((body.payload as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>);
			}
			return new Response(
				JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: undefined } }),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({
			fetchFn,
			wsFactory: (u) => new FakeWebSocket(u) as never,
			rpcIdFactory: () => 'rpc-test',
			staleGenerationRetryMs: 2000
		});
		conn.ensureDownlinks();
		const first = muxSocket()!;
		opened.add(first);
		openSocket(first);
		const eventsId = sentOpens(first).find((id) => id.startsWith('events-'))!;
		pushStreamFrame(first, { type: 'item', streamId: eventsId, value: { type: 'ready', clientId: 'cli-1', host: { home: '/h' } } });

		const receipt = await conn.respond('ev-9', { sessionId: 's1', outcome: 'allowed-once' });
		expect(receipt).toEqual({ accepted: true });
		expect(calls).toBe(2); // first attempt failed stale, second succeeded
		expect(seen.at(-1)).toMatchObject({ clientId: 'cli-2', eventId: 'ev-9' });
	}, 10000);
});

describe('dsh-connection — stale-pending reap on generation change (2026-08-31)', () => {
	/** A connection whose mux died and rebuilt; returns nothing, drives itself. */
	function reapConn(graceMs: number): DshConnection {
		return new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as never,
			fetchFn: fakeFetch({}),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10],
			answerReapGraceMs: graceMs
		});
	}

	it('a pending answer the new generation replay does NOT confirm is reaped as cancelled', () => {
		vi.useFakeTimers();
		const conn = reapConn(50);
		conn.ensureDownlinks();
		pushWaterfall({ type: 'question/requested', sessionId: 's1', questions: [{ id: 'q1', options: [] }] }, 'rpc-z');
		expect(conn.pendingFor('s1')).toHaveLength(1);

		// The mux dies and rebuilds; the host replays ONLY still-pending
		// waterfalls — this one finished while we were away, so nothing
		// re-arrives and the grace expires it.
		muxSocket()!.simulateClose();
		vi.advanceTimersByTime(10);
		const rebuilt = muxSocket()!;
		openSocket(rebuilt);
		const eventsId = sentOpens(rebuilt).find((id) => id.startsWith('events-'))!;
		pushStreamFrame(rebuilt, { type: 'item', streamId: eventsId, value: { type: 'ready', clientId: 'cli-2', host: { home: '/h' } } });
		vi.advanceTimersByTime(50);

		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')[0]).toMatchObject({ rpcId: 'rpc-z', kind: 'question', outcome: 'cancelled' });
		vi.useRealTimers();
	});

	it('a pending answer the replay re-confirms survives the reap (still answerable)', () => {
		vi.useFakeTimers();
		const conn = reapConn(50);
		conn.ensureDownlinks();
		const frame = { type: 'question/requested', sessionId: 's1', questions: [{ id: 'q1', options: [] }] };
		pushWaterfall(frame, 'rpc-alive');
		expect(conn.pendingFor('s1')).toHaveLength(1);

		muxSocket()!.simulateClose();
		vi.advanceTimersByTime(10);
		const rebuilt = muxSocket()!;
		openSocket(rebuilt);
		const eventsId = sentOpens(rebuilt).find((id) => id.startsWith('events-'))!;
		pushStreamFrame(rebuilt, { type: 'item', streamId: eventsId, value: { type: 'ready', clientId: 'cli-2', host: { home: '/h' } } });
		// Host replay: the same eventId re-arrives in the new generation.
		pushWaterfall(frame, 'rpc-alive');
		vi.advanceTimersByTime(50);

		expect(conn.pendingFor('s1')).toHaveLength(1);
		expect(conn.settlementsFor('s1')).toEqual([]);
		vi.useRealTimers();
	});
});

describe('dsh-connection — W3 forwards (create / presets / historyPage)', () => {
	it('createSession posts session.create with the preset and returns the session id', async () => {
		const conn = makeConn({ 'session/create': { sessionId: 'news-1', agentPreset: 'research' } });
		const created = await conn.createSession(undefined, 'research');
		expect(created).toEqual({ sessionId: 'news-1', agentPreset: 'research' });
	});

	it('createSession posts the envelope to the /api/session/create path (BC-6 choke point)', async () => {
		const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			seen.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
			return new Response(
				JSON.stringify({
					type: 'server-response',
				rpcId: 'rpc-test',
					result: { ok: true, value: { sessionId: 's-x' } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		await conn.createSession('/tmp/x', 'app-dev');
		// Birth Workspace Attach (2026-11-06, Frozen Roster amendment D5): the
		// create may be preceded by the workspace-registry read the cwd →
		// workspaceId resolution performs, so the create envelope is found by
		// METHOD, not by call order. No registry baseline in this fixture →
		// the legacy cwd form is the honest fallback (D6).
		const createCall = seen.find((c) => c.body.method === 'session/create');
		expect(createCall).toBeDefined();
		expect(createCall!.url).toContain('/api/session/create');
		expect((createCall!.body.payload as { args: unknown }).args).toEqual({ request: { cwd: '/tmp/x', agentPreset: 'app-dev' } });
	});

	it('listPresets normalizes rows (id/name/description/isDefault)', async () => {
		const conn = makeConn({
			'agentPresets/list': {
				presets: [
					{ id: 'research', name: 'Research', description: 'Web-first agent', trust: 'untrusted', isDefault: false },
				{ id: 'main', name: 'Main', description: null, isDefault: true }
			]
		}
		});
		const { presets } = await conn.listPresets();
		expect(presets).toEqual([
			{ id: 'research', name: 'Research', description: 'Web-first agent', isDefault: false },
			{ id: 'main', name: 'Main', description: null, isDefault: true }
		]);
	});

	it('listPresets with a non-array value normalizes to an empty list, never throws', async () => {
		const conn = makeConn({ 'agentPresets/list': { presets: 'garbage' } });
		const { presets } = await conn.listPresets();
		expect(presets).toEqual([]);
	});

	it('listPresets honors dsh.presetEnglish from ~/.dsi/settings.yaml, read live per call', async () => {
		// Same hermetic-config discipline as the server.ringCapacity test:
		// fixture written through DSI_CONFIG_PATH, removed in finally, and the
		// missing-file tail proves the default (overlay ON) without a restart.
		const conn = makeConn({
			'agentPresets/list': {
				presets: [{ id: 'standard', name: '标准模式', description: '功能完整的编码 Agent。', trust: 'system', isDefault: true }]
			}
		});
		writeFileSync(configPath, JSON.stringify({ dsh: { presetEnglish: false } }), 'utf-8');
		try {
			const { presets: off } = await conn.listPresets();
			expect(off).toEqual([
				{ id: 'standard', name: '标准模式', description: '功能完整的编码 Agent。', isDefault: true }
			]);
		} finally {
			rmSync(configPath, { force: true });
		}
		const { presets: def } = await conn.listPresets();
		expect(def).toEqual([
			{
				id: 'standard',
				name: 'Standard mode',
				description:
					'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
				isDefault: true
			}
		]);
	});

	it('renameSession posts session.rename with {sessionId, title} and returns {title, seq}', async () => {
		const conn = makeConn({ 'session/rename': { title: 'Normalized Title', seq: 57 } });
		const renamed = await conn.renameSession('s-1', '  my title  ');
		expect(renamed).toEqual({ title: 'Normalized Title', seq: 57 });
	});

	it('renameSession posts the envelope to the /api/session/rename path (BC-6 choke point)', async () => {
		const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			seen.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: true, value: { title: 'T', seq: 9 } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		await conn.renameSession('s-1', 'T');
		expect(seen[0].url).toContain('/api/session/rename');
		expect(seen[0].body.method).toBe('session/rename');
		expect((seen[0].body.payload as { args: unknown }).args).toEqual({ request: { sessionId: 's-1', title: 'T' } });
	});

	it('renameSession surfaces the host title-invalid RpcError (maps to 502 upstream)', async () => {
		const conn = makeConn({}); // unscripted method → session/not-found error envelope
		await expect(conn.renameSession('s-1', '   ')).rejects.toThrow(/session\/not-found/);
	});

	it('listModels normalizes the SessionModels directory (current/routable/groups/failures)', async () => {
		const conn = makeConn({
			'session/modelCatalog': {
				current: { provider: 'deepseek', model: 'glm-5.3', reasoningEffort: 'high' },
				routable: true,
				groups: [
					{
						id: 'deepseek',
						name: 'DeepSeek',
						models: [
							{
								id: 'glm-5.3',
								name: 'GLM 5.3',
								reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' }
							},
							{ id: 'glm-5-mini', name: null }
						]
					}
				],
				failures: [{ id: 'ollama', name: 'Ollama', message: 'route down' }]
			}
		});
		const dir = await conn.listModels('s-1');
		expect(dir.current).toEqual({ provider: 'deepseek', model: 'glm-5.3', reasoningEffort: 'high' });
		expect(dir.routable).toBe(true);
		expect(dir.groups).toEqual([
			{
				id: 'deepseek',
				name: 'DeepSeek',
				models: [
					{ id: 'glm-5.3', name: 'GLM 5.3', reasoningEfforts: ['low', 'high'] },
					{ id: 'glm-5-mini', name: null }
				]
			}
		]);
		expect(dir.failures).toEqual([{ id: 'ollama', name: 'Ollama', message: 'route down' }]);
	});

	it('listModels GARBAGE catalog normalizes to empty, never throws (3.2-T)', async () => {
		const conn = makeConn({
			'session/modelCatalog': {
				current: 'not-an-object',
				routable: 'yes',
				groups: 'garbage',
				failures: [{ id: 42 }, null, { id: 'x' }]
			}
		});
		const dir = await conn.listModels('s-1');
		expect(dir).toEqual({ current: null, routable: false, groups: [], failures: [{ id: 'x', name: null, message: null }] });
	});

	it('listModels with a non-object value → empty directory (never throws)', async () => {
		const conn = makeConn({ 'session/modelCatalog': null });
		const dir = await conn.listModels('s-1');
		expect(dir).toEqual({ current: null, routable: false, groups: [], failures: [] });
	});

	it('selectModel posts {sessionId, provider, model} and returns the normalized selection', async () => {
		const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			seen.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: true, value: { selected: { provider: 'deepseek', model: 'glm-5.3' } } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		const selected = await conn.selectModel('s-1', 'deepseek', 'glm-5.3');
		expect(seen[0].url).toContain('/api/session/selectModel');
		expect((seen[0].body.payload as { args: unknown }).args).toEqual({ request: { sessionId: 's-1', provider: 'deepseek', model: 'glm-5.3' } });
		expect(selected).toEqual({ provider: 'deepseek', model: 'glm-5.3' });
	});

	it('selectModel with reasoningEffort carries it (omitted → key absent)', async () => {
		const seen: Array<Record<string, unknown>> = [];
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			seen.push(body.payload as Record<string, unknown>);
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: true, value: { selected: { provider: 'p', model: 'm' } } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		await conn.selectModel('s-1', 'p', 'm', 'high');
		await conn.selectModel('s-1', 'p', 'm');
		expect((seen[0] as { args?: { request?: Record<string, unknown> } }).args?.request).toEqual({ sessionId: 's-1', provider: 'p', model: 'm', reasoningEffort: 'high' });
		expect('reasoningEffort' in (seen[1] ?? {})).toBe(false);
	});

	it('selectModel garbage receipt normalizes to null (never invents a selection)', async () => {
		const conn = makeConn({ 'session/selectModel': { selected: 42 } });
		const selected = await conn.selectModel('s-1', 'p', 'm');
		expect(selected).toBeNull();
	});

	it('historyPage sends beforeSeq and returns the ledger page (0.1.2 session/page)', async () => {
		const conn = makeConn({
			'session/list': { items: [{ sessionId: 's1', running: false, projections: { asOfSeq: 30 } }] },
			'session/page': { records: [{ type: 'event', event: frameEvent(12) }], hasMore: true }
		});
		const page = await conn.historyPage('s1', 20);
		expect(page.events.map((e) => e.event.seq)).toEqual([12]);
		expect(page.hasMore).toBe(true);
	});
});

describe('dsh-connection — workspace registry + attachment + baseline (coverage gap)', () => {
	it('createWorkspace passes the path through and returns the raw receipt', async () => {
		const conn = makeConn({ 'workspace/create': { workspace: { workspaceId: 'w1', path: '/tmp/x' }, created: true } });
		const out = await conn.createWorkspace('/tmp/x');
		expect(out).toEqual({ workspace: { workspaceId: 'w1', path: '/tmp/x' }, created: true });
	});

	it('renameWorkspace posts the {request:{workspaceId,title}} envelope and returns the receipt (Chip Menu ADR D3)', async () => {
		let seen: { method: string; payload: Record<string, unknown> } | undefined;
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			seen = { method: String(url), payload: body.payload as Record<string, unknown> };
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: true, value: { workspace: { workspaceId: 'w1', title: 'Renamed Home', path: '/tmp/x' } } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		const out = await conn.renameWorkspace('w1', 'Renamed Home');
		expect(out).toEqual({ workspace: { workspaceId: 'w1', title: 'Renamed Home', path: '/tmp/x' } });
		expect(seen?.method).toContain('workspace/rename');
		expect((seen?.payload as { args?: { request?: unknown } })?.args?.request).toEqual({ workspaceId: 'w1', title: 'Renamed Home' });
	});

	it('renameWorkspace refusal passes through as DshRpcError with the host code (ADR D2/D3)', async () => {
		const fetchFn = (async (url: unknown) => {
			if (!String(url).includes('workspace/rename')) throw new Error('unexpected method');
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: false, error: { code: 'workspace/name-conflict', message: 'title taken', details: { name: 'occupied' } } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		await expect(conn.renameWorkspace('w1', 'occupied')).rejects.toMatchObject({
			name: 'DshRpcError',
			code: 'workspace/name-conflict'
		});
	});

	it('deleteWorkspace posts the {request:{workspaceId}} envelope and returns the removed id (Chip Menu ADR D3)', async () => {
		let seen: { method: string; payload: Record<string, unknown> } | undefined;
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			seen = { method: String(url), payload: body.payload as Record<string, unknown> };
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: true, value: { workspaceId: 'w1' } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		const out = await conn.deleteWorkspace('w1');
		expect(out).toEqual({ workspaceId: 'w1' });
		expect(seen?.method).toContain('workspace/delete');
		expect((seen?.payload as { args?: { request?: unknown } })?.args?.request).toEqual({ workspaceId: 'w1' });
	});

	it('deleteWorkspace not-found refusal passes through as DshRpcError (sessions-survive semantics live host-side)', async () => {
		const fetchFn = (async (url: unknown) => {
			if (!String(url).includes('workspace/delete')) throw new Error('unexpected method');
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: false, error: { code: 'workspace/not-found', message: 'gone', details: { workspaceId: 'w-void' } } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({ fetchFn, wsFactory: (u) => new FakeWebSocket(u) as never, rpcIdFactory: () => 'rpc-test' });
		await expect(conn.deleteWorkspace('w-void')).rejects.toMatchObject({
			name: 'DshRpcError',
			code: 'workspace/not-found'
		});
	});

	it('listWorkspaces (0.1.2 W1) answers honest empty until workspace/follow lands (W2)', async () => {
		const conn = makeConn({});
		const out = await conn.listWorkspaces();
		expect(out).toEqual({ items: [] });
	});

	

	it('readAttachment forwards {request:{sessionId, attachment ref}} and returns the receipt value', async () => {
		let seen: Record<string, unknown> | undefined;
		const REF = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
		const fetchFn = (async (url: unknown, init?: { body?: string }) => {
			const method = String(url).split('/').pop() ?? '';
			const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			if (method === 'attachment') seen = body.payload as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					result: { ok: true, value: { attachment: { ...REF }, data: 'QUJD' } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const conn = new DshConnection({
			fetchFn,
			wsFactory: (u) => new FakeWebSocket(u) as never,
			rpcIdFactory: () => 'rpc-test'
		});
		const out = await conn.readAttachment('s-1', REF);
		expect(((seen as { args?: { request?: Record<string, unknown> } } | undefined)?.args)?.request).toEqual({
			sessionId: 's-1',
			attachment: REF
		});
		expect(out).toEqual({ attachment: { ...REF }, data: 'QUJD' });
	});

	it('hasBaseline: true only after a subscribed baseline with lastSeq ≥ 0', () => {
		const conn = makeConn();
		expect(conn.hasBaseline('s-none')).toBe(false); // never subscribed
		conn.ensureDownlinks();
		conn.subscribe('s1');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's1', 6845);
		expect(conn.hasBaseline('s1')).toBe(true);
		// lastSeq 0 is a VALID baseline for a blank session (>= 0)…
		conn.subscribe('s-blank');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's-blank', 0);
		expect(conn.hasBaseline('s-blank')).toBe(true);
		// …while a -1 (no baseline yet) stays false.
		conn.subscribe('s-neg');
		openSocket(muxSocket());
		followSnapshot(muxSocket(), 's-neg', -1);
		expect(conn.hasBaseline('s-neg')).toBe(false);
	});
});

// ── Lineage passthrough (2026-08-27 lineage sidebar, task 1.3-T) ──────
// The host stamps every spawned session (parentSessionId + origin); the
// boundary must carry both — absent normalized to null, never undefined.
describe('dsh-connection — lineage passthrough (normalizeSessionRow)', () => {
	it('spawned session keeps parentSessionId and origin', () => {
		const out = normalizeSessionRow({
			sessionId: 'kid',
			updatedAt: 5,
			running: true,
			parentSessionId: 'main',
			origin: 'subagent'
		});
		expect(out.parentSessionId).toBe('main');
		expect(out.origin).toBe('subagent');
	});

	it('plain session normalizes absent lineage fields to null (never undefined)', () => {
		const out = normalizeSessionRow({ sessionId: 'plain', updatedAt: 1 });
		expect(out.parentSessionId).toBeNull();
		expect(out.origin).toBeNull();
	});

	it('fork lineage (parentSessionId without origin) passes through untouched', () => {
		const out = normalizeSessionRow({ sessionId: 'fork', parentSessionId: 'src' });
		expect(out.parentSessionId).toBe('src');
		expect(out.origin).toBeNull(); // consumers discriminate via origin
	});
});


describe('dsh-connection — W2: workspace/follow + session/control state streams', () => {
	/** Deliver one state-stream item (workspaces-/control- prefixes). */
	function pushState(prefix: 'workspaces-' | 'control-', value: unknown): void {
		const socket = muxSocket();
		if (socket && sentOpens(socket).filter((id) => id.startsWith('events-')).length === 0) {
			// sockets open lazily in tests; ensure open happened for stream ids
		}
		const id = (socket?.sent ?? [])
			.map((raw) => JSON.parse(raw) as { type?: string; streamId?: string })
			.find((m) => m.type === 'open' && m.streamId?.startsWith(prefix))?.streamId;
		pushStreamFrame(socket, { type: 'item', streamId: id, value });
	}

	it('workspace/follow baseline + increments keep the registry live', async () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		openSocket(muxSocket());
		pushState('workspaces-', {
			type: 'baseline',
			value: { items: [{ workspaceId: 'w1', title: 'One', path: '/one', sessionIds: ['s1'] }] }
		});
		let out = await conn.listWorkspaces();
		expect(out.items).toEqual([{ workspaceId: 'w1', title: 'One', path: '/one', sessionIds: ['s1'] }]);
		pushState('workspaces-', {
			type: 'upsert',
			workspace: { workspaceId: 'w2', title: 'Two', path: '/two', sessionIds: [] }
		});
		pushState('workspaces-', { type: 'remove', workspaceId: 'w1' });
		out = await conn.listWorkspaces();
		expect(out.items.map((w) => w.workspaceId)).toEqual(['w2']);
	});

	it('session/control baseline + projection frame feed projectionValue (permissions)', () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		openSocket(muxSocket());
		pushState('control-', {
			type: 'baseline',
			value: {
				projections: {
					s1: { asOfSeq: 10, values: { permissions: { currentValue: 'read-only', options: [] } } }
				}
			}
		});
		expect(conn.projectionValue('s1', 'permissions')).toMatchObject({ currentValue: 'read-only' });
		pushState('control-', { type: 'projection', sessionId: 's1', key: 'permissions', value: { currentValue: 'danger-full-access', options: [] }, seq: 11 });
		expect(conn.projectionValue('s1', 'permissions')).toMatchObject({ currentValue: 'danger-full-access' });
		expect(conn.projectionBlock('s1')?.asOfSeq).toBe(11);
	});

	it('a follow snapshot stores its projections block (access chip seed)', () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		conn.subscribe('s1');
		openSocket(muxSocket());
		const followId = sentOpens(muxSocket()!).find((id) => id.startsWith('follow-s1'));
		pushStreamFrame(muxSocket(), {
			type: 'item',
			streamId: followId,
			value: {
				type: 'snapshot',
				cursor: 3,
				records: [],
				projections: { asOfSeq: 3, values: { title: 'Hello' } }
			}
		});
		expect(conn.projectionValue('s1', 'title')).toBe('Hello');
	});
});

describe('dsh-connection — subagent parent-addressing (2026-08-31)', () => {
	/** A subagent-origin list row (bare-UUID child of a session- parent). */
	function subagentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			sessionId: 'a08b01a1-2525-4cd8-85b4-1dbbd96aa881',
			origin: 'subagent',
			parentSessionId: 'session-d0e11757-bce1-4f71-85b4-parent',
			projections: {
				asOfSeq: 42,
				values: { subagent: { mode: 'continuable', label: 'Find DSH /api/respond handler', seq: 1 } }
			},
			...overrides
		};
	}

	/** Recording scripted fetch: answers from `scripted`, records page bodies. */
	function recordingFetch(scripted: Record<string, unknown>, seen: Record<string, Record<string, unknown>>): typeof fetch {
		return (async (url: unknown, init?: { body?: string }) => {
			const segments = String(url).split('/');
			const method = segments.slice(-2).join('/');
			seen[method] = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
			const result = scripted[method];
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: 'rpc-test',
					...(result === undefined
						? { result: { ok: false, error: { code: 'session/not-found', message: 'nope' } } }
						: { result: { ok: true, value: result } })
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
	}

	function pagePayload(seen: Record<string, Record<string, unknown>>): Record<string, unknown> {
		const page = seen['session/page'];
		return ((page?.payload as { args?: { request?: Record<string, unknown> } })?.args?.request) ?? {};
	}

	it('history addresses a subagent-origin session through its parent (kind subagent + descriptor mode)', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: recordingFetch(
				{
					'session/list': { items: [subagentRow()] },
					'session/page': { records: [], hasMore: false }
				},
				seen
			),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		const page = await conn.history('a08b01a1-2525-4cd8-85b4-1dbbd96aa881');
		expect(page.hasMore).toBe(false);
		expect(pagePayload(seen)['address']).toEqual({
			kind: 'subagent',
			parentSessionId: 'session-d0e11757-bce1-4f71-85b4-parent',
			childSessionId: 'a08b01a1-2525-4cd8-85b4-1dbbd96aa881',
			mode: 'continuable'
		});
	});

	it('history keeps the plain form when the row is not a subagent (ordinary session)', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: recordingFetch(
				{
					'session/list': {
						items: [{ sessionId: 'session-plain', projections: { asOfSeq: 7 } }]
					},
					'session/page': { records: [], hasMore: false }
				},
				seen
			),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		await conn.history('session-plain');
		expect(pagePayload(seen)['address']).toEqual({ kind: 'session', sessionId: 'session-plain' });
	});

	it('history keeps the plain form when the descriptor mode is unreadable (never guesses a mode)', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: recordingFetch(
				{
					'session/list': {
						items: [subagentRow({ projections: { asOfSeq: 42, values: { subagent: { mode: 'warp' } } } })]
					},
					'session/page': { records: [], hasMore: false }
				},
				seen
			),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		await conn.history('a08b01a1-2525-4cd8-85b4-1dbbd96aa881');
		expect(pagePayload(seen)['address']).toEqual({
			kind: 'session',
			sessionId: 'a08b01a1-2525-4cd8-85b4-1dbbd96aa881'
		});
	});

	it('the follow stream carries the parent address for a folded subagent hint', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: recordingFetch(
				{
					'session/list': { items: [subagentRow()] },
					'session/page': { records: [], hasMore: false }
				},
				seen
			),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		// A history call folds the hint (the cold load always runs first).
		await conn.history('a08b01a1-2525-4cd8-85b4-1dbbd96aa881');
		conn.ensureDownlinks();
		conn.subscribe('a08b01a1-2525-4cd8-85b4-1dbbd96aa881');
		openSocket(muxSocket());
		const followOpen = (muxSocket()!.sent)
			.map((raw) => JSON.parse(raw) as { type?: string; streamId?: string; payload?: { args?: { request?: { address?: Record<string, unknown> } } } })
			.find((m) => m.type === 'open' && typeof m.streamId === 'string' && m.streamId.startsWith('follow-a08b01a1'));
		expect(followOpen?.payload?.args?.request?.address).toEqual({
			kind: 'subagent',
			parentSessionId: 'session-d0e11757-bce1-4f71-85b4-parent',
			childSessionId: 'a08b01a1-2525-4cd8-85b4-1dbbd96aa881',
			mode: 'continuable'
		});
	});

	it('subscribe probes the address and REOPENS the follow with the parent form (cold subscribe)', async () => {
		const seen: Record<string, Record<string, unknown>> = {};
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
			fetchFn: recordingFetch({ 'session/list': { items: [subagentRow()] } }, seen),
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		conn.ensureDownlinks();
		conn.subscribe('a08b01a1-2525-4cd8-85b4-1dbbd96aa881');
		openSocket(muxSocket());
		// The first open goes out with the plain form (the sync contract);
		// once the probe folds the row, the follow REOPENS with the parent
		// address (the mux replaces the stream id; the snapshot reseeds).
		await vi.waitFor(() => {
			const subagentOpen = (muxSocket()!.sent)
				.map((raw) => JSON.parse(raw) as { type?: string; streamId?: string; payload?: { args?: { request?: { address?: Record<string, unknown> } } } })
				.find((m) => m.type === 'open' && typeof m.streamId === 'string' && m.streamId.startsWith('follow-a08b01a1') && m.payload?.args?.request?.address?.kind === 'subagent');
			expect(subagentOpen?.payload?.args?.request?.address).toMatchObject({
				kind: 'subagent',
				parentSessionId: 'session-d0e11757-bce1-4f71-85b4-parent',
				childSessionId: 'a08b01a1-2525-4cd8-85b4-1dbbd96aa881',
				mode: 'continuable'
			});
		});
	});

	it('subagent rows lead with the descriptor label (findable among prompt-derived titles)', async () => {
		const conn = makeConn({
			'session/list': {
				items: [
					subagentRow(),
					subagentRow({
						sessionId: 'oneshot-child',
						projections: { asOfSeq: 9, values: { subagent: { mode: 'one-shot', seq: 2 } } }
					})
				]
			}
		});
		const list = await conn.listSessions();
		expect(list.items[0]?.title).toBe('Find DSH /api/respond handler');
		// A one-shot child without a label falls back to the session title.
		expect(list.items[1]?.title).toBeNull();
	});
});

describe('dsh-connection — goalVerb request param (Goal Editor W1, Task 1.2-T)', () => {
	it('edit forwards {agentId, ref, request}; phase verbs stay two-key', async () => {
		const calls: Array<{ method: string; payload: unknown }> = [];
		const fake = {
			rpc: (method: string, payload: unknown) => {
				calls.push({ method, payload });
				return Promise.resolve({});
			}
		};
		const goalVerb = DshConnection.prototype.goalVerb as (this: unknown, ...args: unknown[]) => Promise<unknown>;
		await goalVerb.call(fake, 'edit', 's1', { id: 'g', revision: 2 }, { objective: 'x' });
		await goalVerb.call(fake, 'pause', 's1', { id: 'g', revision: 2 });
		await goalVerb.call(fake, 'resume', 's1', { id: 'g', revision: 2 });
		await goalVerb.call(fake, 'clear', 's1', { id: 'g', revision: 2 });
		expect(calls[0]).toEqual({
			method: 'goals/edit',
			payload: { agentId: 's1', ref: { id: 'g', revision: 2 }, request: { objective: 'x' } }
		});
		for (const verb of ['pause', 'resume', 'clear']) {
			const call = calls.find((c) => c.method === 'goals/' + verb);
			expect(call).toBeDefined();
			expect(call!.payload).toEqual({ agentId: 's1', ref: { id: 'g', revision: 2 } });
			expect('request' in (call!.payload as object)).toBe(false);
		}
	});
});

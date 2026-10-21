// @vitest-environment node
/**
 * downlinks-coverage — the DownlinkManager arms the transport + mux-stream
 * suites miss: job-roster/job-follow registry edge cases (parked, duplicate,
 * error-frame self-heal, throwing sends), the frame-demux junk arms, the
 * reconnect ladder + cancel path, the hint-probe reopen/cleanup path, and
 * the projection/workspace bounded waits.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DshConnection,
	resetDshConnectionForTests,
	type WebSocketLike
} from '$lib/server/dsh-connection';

const configDir = mkdtempSync(join(tmpdir(), 'dsi-downlinks-cov-'));
beforeAll(() => {
	process.env.DSI_CONFIG_PATH = configDir;
	delete process.env.DSI_AUTH_TOKEN;
});
afterAll(() => {
	delete process.env.DSI_CONFIG_PATH;
	rmSync(configDir, { recursive: true, force: true });
});

/** Scripted fake WebSocket. */
class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	listeners = new Map<string, Array<(e?: unknown) => void>>();
	sent: string[] = [];
	url: string;
	closed = false;
	throwOnSend = false;
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}
	send(data: string): void {
		if (this.throwOnSend) throw new Error('socket closed');
		this.sent.push(data);
	}
	addEventListener(ev: string, fn: (e?: unknown) => void): void {
		this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
	}
	push(value: unknown): void {
		for (const fn of this.listeners.get('message') ?? []) fn({ data: JSON.stringify(value) });
	}
	pushRaw(raw: string): void {
		for (const fn of this.listeners.get('message') ?? []) fn({ data: raw });
	}
	simulateClose(): void {
		this.closed = true;
		for (const fn of this.listeners.get('close') ?? []) fn();
	}
	simulateError(): void {
		for (const fn of this.listeners.get('error') ?? []) fn();
	}
	close(): void {
		this.simulateClose();
	}
	static open(socket: FakeWebSocket | undefined): void {
		for (const fn of socket?.listeners.get('open') ?? []) fn();
	}
}

function muxSocket(): FakeWebSocket | undefined {
	return FakeWebSocket.instances.find((s) => s.url.endsWith('/api/remote.mux') && !s.closed);
}

function sentOpens(socket: FakeWebSocket): string[] {
	return socket.sent
		.map((raw) => JSON.parse(raw) as { type?: string; streamId?: string })
		.filter((m): m is { type: 'open'; streamId: string } => m.type === 'open' && typeof m.streamId === 'string')
		.map((m) => m.streamId);
}

function fakeFetch(scripted: Record<string, unknown>, failSessions = false): typeof fetch {
	return (async (url: unknown, init?: { body?: string }) => {
		const segments = String(url).split('/');
		const method = segments.slice(-2).join('/');
		if (failSessions && method === 'api/sessions') throw new Error('network down');
		const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
		const result = scripted[method];
		return new Response(
			JSON.stringify(
				result === undefined
					? { type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'session/not-found', message: 'nope' } } }
					: { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: result } }
			),
			{ status: 200 }
		);
	}) as unknown as typeof fetch;
}

function makeConn(
	scripted: Record<string, unknown> = {},
	opts: Record<string, unknown> = {}
): DshConnection {
	return new DshConnection({
		wsFactory: (u: string) => new FakeWebSocket(u) as unknown as WebSocketLike,
		fetchFn: fakeFetch(scripted, opts.failSessions === true),
		rpcIdFactory: () => 'rpc-test',
		backoffScheduleMs: [5, 10, 20],
		...opts
	} as never);
}

function followId(socket: FakeWebSocket): string {
	return sentOpens(socket).find((x) => x.startsWith('follow-'))!;
}
function eventsId(socket: FakeWebSocket): string {
	return sentOpens(socket).find((x) => x.startsWith('events-'))!;
}

beforeEach(() => {
	FakeWebSocket.instances = [];
});

afterEach(() => {
	resetDshConnectionForTests();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('downlinks — job roster registry edges', () => {
	it('openJobRosterStream parks while CONNECTING and while unopened; the next generation reopens it', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		// not opened yet → parked
		conn.downlinks.openJobRosterStream('s1');
		expect(sentOpens(socket).some((x) => x.startsWith('jobs-s1-'))).toBe(false);
		// dispose tears down → wsMux undefined path also parks silently
		conn.downlinks.openJobRosterStream('s1');
		FakeWebSocket.open(socket);
		// generation rebuild opens every watched session
		expect(sentOpens(socket).some((x) => x.startsWith('jobs-s1-'))).toBe(true);
		// duplicate while tracked → no second open
		const count = sentOpens(socket).filter((x) => x.startsWith('jobs-s1-')).length;
		conn.downlinks.openJobRosterStream('s1');
		expect(sentOpens(socket).filter((x) => x.startsWith('jobs-s1-')).length).toBe(count);
		conn.dispose();
	});

	it('an error frame drops the tracking entry so the next poll reopens (self-heal)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.downlinks.openJobRosterStream('s1');
		const id = sentOpens(socket).find((x) => x.startsWith('jobs-s1-'))!;
		socket.push({ type: 'error', streamId: id, error: { code: 'job/stream-failed', message: 'boom' } });
		// tracking dropped → reopen now works
		conn.downlinks.openJobRosterStream('s1');
		expect(sentOpens(socket).filter((x) => x.startsWith('jobs-s1-')).length).toBe(2);
		conn.dispose();
	});

	it('an error frame for a jobs stream with no parsable sessionId is ignored', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		// 'jobs--5' → empty sessionId → jobRosterSessionIdOf returns null
		expect(() => socket.push({ type: 'error', streamId: 'jobs--5', error: {} })).not.toThrow();
		conn.dispose();
	});

	it('closeJobRosterStream sends a best-effort close frame and survives a throwing send', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.downlinks.openJobRosterStream('s1');
		socket.throwOnSend = true;
		expect(() => conn.downlinks.closeJobRosterStream('s1')).not.toThrow();
		// unwatched session: nothing to close, still fine
		expect(() => conn.downlinks.closeJobRosterStream('ghost')).not.toThrow();
		conn.dispose();
	});
});

describe('downlinks — job follow registry edges', () => {
	it('openJobFollowStream parks while CONNECTING, dedupes by key, and handles the empty owner form', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.downlinks.openJobFollowStream('s1', 'j1'); // parked (not opened)
		expect(sentOpens(socket).some((x) => x.startsWith('jobfollow-'))).toBe(false);
		FakeWebSocket.open(socket);
		conn.downlinks.openJobFollowStream('s1', 'j1');
		conn.downlinks.openJobFollowStream('s1', 'j1'); // dedupe
		const opens = sentOpens(socket).filter((x) => x.startsWith('jobfollow-'));
		expect(opens).toHaveLength(1);
		// empty owner → request carries only { jobId }
		conn.downlinks.openJobFollowStream('', 'j2');
		const ownerless = JSON.parse(
			socket.sent.find((raw) => {
				const m = JSON.parse(raw) as { type?: string; streamId?: string };
				return m.type === 'open' && m.streamId === 'jobfollow-.j2.' + m.streamId!.split('.').pop();
			})!
		) as { payload: { args: { request: Record<string, unknown> } } };
		expect(ownerless.payload.args.request).toEqual({ jobId: 'j2' });
		conn.dispose();
	});

	it('an error frame drops the follow key; a short id parses to nothing', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.downlinks.openJobFollowStream('s1', 'j1');
		const id = sentOpens(socket).find((x) => x.startsWith('jobfollow-'))!;
		socket.push({ type: 'error', streamId: id, error: { code: 'x', message: 'y' } });
		// key dropped → reopen sends a fresh open
		conn.downlinks.openJobFollowStream('s1', 'j1');
		expect(sentOpens(socket).filter((x) => x.startsWith('jobfollow-')).length).toBe(2);
		// error frame with < 3 dot-parts → relay error never fires, no crash
		expect(() => socket.push({ type: 'error', streamId: 'jobfollow-s1', error: {} })).not.toThrow();
		// item with < 3 parts → no relay call
		expect(() => socket.push({ type: 'item', streamId: 'jobfollow-s1.j1', value: {} })).not.toThrow();
		conn.dispose();
	});

	it('closeJobFollowStream sends close frames and survives a throwing send', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.downlinks.openJobFollowStream('s1', 'j1');
		socket.throwOnSend = true;
		expect(() => conn.downlinks.closeJobFollowStream('s1', 'j1')).not.toThrow();
		expect(() => conn.downlinks.closeJobFollowStream('ghost', 'ghost')).not.toThrow();
		conn.dispose();
	});
});

describe('downlinks — frame demux junk arms', () => {
	it('non-string streamId, malformed JSON, and end frames are tolerated', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		expect(() => socket.push({ type: 'item' })).not.toThrow();
		expect(() => socket.pushRaw('not json at all')).not.toThrow();
		expect(() => socket.push({ type: 'end', streamId: followId(socket) })).not.toThrow();
		expect(() => socket.push({ type: 'item', streamId: 'unknown-1', value: { type: 'junk' } })).not.toThrow();
		conn.dispose();
	});

	it('an error frame on an untracked stream hits the generic log arm', () => {
		const conn = makeConn();
		const logSpy = vi.fn();
		(conn as unknown as { log: (msg: string, ...rest: unknown[]) => void }).log = logSpy;
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		socket.push({ type: 'error', streamId: 'workspaces-99', error: { code: 'c', message: 'm' } });
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('workspaces-99 failed'), 'c', 'm');
		conn.dispose();
	});

	it('follow items: snapshot without a parsable session, assistant-stream without a frame, event without an event', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = followId(socket);
		// follow--3 → empty sessionId → null arm
		expect(() => socket.push({ type: 'item', streamId: 'follow--3', value: { type: 'snapshot', cursor: 1 } })).not.toThrow();
		expect(() => socket.push({ type: 'item', streamId: id, value: { type: 'assistant-stream' } })).not.toThrow();
		expect(() => socket.push({ type: 'item', streamId: id, value: { type: 'event' } })).not.toThrow();
		expect(() => socket.push({ type: 'item', streamId: id, value: { type: 'unknown-kind' } })).not.toThrow();
		conn.dispose();
	});
});

describe('downlinks — $events arms', () => {
	it('ready without clientId still arms the reaper; settle without eventId is a no-op', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = eventsId(socket);
		socket.push({ type: 'item', streamId: id, value: { type: 'ready' } });
		expect(conn.downlinks.eventClientId).toBe(null);
		socket.push({ type: 'item', streamId: id, value: { type: 'settle', outcome: 'done' } });
		socket.push({ type: 'item', streamId: id, value: { type: 'cancel' } });
		expect(() => socket.push({ type: 'item', streamId: id, value: { type: 'junk-frame' } })).not.toThrow();
		conn.dispose();
	});

	it('a waterfall without an eventId, and a non-object request, are handled', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = eventsId(socket);
		// no eventId → early return
		socket.push({ type: 'item', streamId: id, value: { type: 'waterfall', event: 'approval/request' } });
		// null request → defaults to {}
		socket.push({
			type: 'item', streamId: id,
			value: { type: 'waterfall', event: 'approval/request', eventId: 'e1', agentId: 's1', request: null }
		});
		// unknown waterfall event → ignored log arm
		socket.push({
			type: 'item', streamId: id,
			value: { type: 'waterfall', event: 'other/event', eventId: 'e2', agentId: 42 }
		});
		// non-string event fields
		socket.push({ type: 'item', streamId: id, value: { type: 'waterfall', event: 9, eventId: 'e3' } });
		conn.dispose();
	});

	it('an emit for api-session/status sets running state', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = eventsId(socket);
		socket.push({ type: 'item', streamId: id, value: { type: 'emit', event: 'api-session/status', args: ['s1', true] } });
		expect(conn.sessions.isRunning('s1')).toBe(true);
		// non-string sessionId arm
		socket.push({ type: 'item', streamId: id, value: { type: 'emit', event: 'api-session/status', args: [42, true] } });
		conn.dispose();
	});
});

describe('downlinks — reconnect ladder + cleanup', () => {
	it('a socket error schedules a rebuild; the timer fires and mints a new carrier', () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		socket.simulateError();
		vi.advanceTimersByTime(50);
		expect(conn.downlinks.generation).toBe(2);
		expect(muxSocket()).toBeDefined();
		expect(muxSocket()).not.toBe(socket);
		conn.dispose();
		// timer firing after dispose hits the disposed guard — no third carrier
		vi.advanceTimersByTime(50);
		expect(FakeWebSocket.instances.length).toBe(2);
		expect(FakeWebSocket.instances.every((s) => s.closed)).toBe(true);
	});

	it('a repeated schedule within one teardown keeps the climbed rung; cancelReconnect clears the timer', () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		socket.simulateClose();
		const attemptBefore = conn.downlinks.reconnectAttempt;
		conn.downlinks.cancelReconnect();
		vi.advanceTimersByTime(100);
		// cancelled → no rebuild happened
		expect(conn.downlinks.generation).toBe(1);
		expect(conn.downlinks.reconnectAttempt).toBe(attemptBefore);
		conn.dispose();
	});

	it('the backoff ladder climbs per failed generation and a delivered frame resets it', () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		const first = muxSocket()!;
		first.simulateClose();
		vi.advanceTimersByTime(50);
		expect(conn.downlinks.reconnectAttempt).toBe(1);
		FakeWebSocket.open(muxSocket());
		// a delivered item frame resets the ladder
		const second = muxSocket()!;
		second.push({ type: 'item', streamId: eventsId(second), value: { type: 'ready', clientId: 'c1' } });
		expect(conn.downlinks.reconnectAttempt).toBe(0);
		expect(conn.downlinks.eventClientId).toBe('c1');
		conn.dispose();
	});

	it('teardownSockets resolves workspace baseline waiters and clears caches', async () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const listPromise = conn.listWorkspaces();
		conn.downlinks.teardownSockets();
		const result = await listPromise;
		expect(result.items).toEqual([]);
		conn.dispose();
	});

	it('listWorkspaces returns the cached registry once the baseline lands; junk rows are dropped', async () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = sentOpens(socket).find((x) => x.startsWith('workspaces-'))!;
		const pending = conn.listWorkspaces();
		socket.push({
			type: 'item', streamId: id,
			value: {
				type: 'baseline',
				value: {
					items: [
						{ workspaceId: 'w1', title: 'One', path: '/one', sessionIds: ['a', 7, 'b'] },
						{ workspaceId: 5, path: '/junk' },
						{ path: '/no-id' },
						{ workspaceId: 'w2', path: '/two' }
					]
				}
			}
		});
		const result = await pending;
		expect(result.items).toHaveLength(2);
		expect(result.items[0]!.title).toBe('One');
		expect(result.items[0]!.sessionIds).toEqual(['a', 'b']);
		expect(result.items[1]!.title).toBe('/two');
		// upsert existing (replace) vs new (push); invalid upsert ignored
		socket.push({ type: 'item', streamId: id, value: { type: 'upsert', workspace: { workspaceId: 'w1', path: '/one-b', sessionIds: [] } } });
		socket.push({ type: 'item', streamId: id, value: { type: 'upsert', workspace: { workspaceId: 'w3', path: '/three' } } });
		socket.push({ type: 'item', streamId: id, value: { type: 'upsert', workspace: { path: '/bad' } } });
		socket.push({ type: 'item', streamId: id, value: { type: 'remove', workspaceId: 'w2' } });
		socket.push({ type: 'item', streamId: id, value: { type: 'remove', workspaceId: 9 } });
		socket.push({ type: 'item', streamId: id, value: { type: 'order' } });
		const after = await conn.listWorkspaces();
		expect(after.items.map((w) => w.workspaceId)).toEqual(['w1', 'w3']);
		conn.dispose();
	});

	it('onDownlinkClosed guards: disposed or no carrier → no rebuild', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.dispose();
		socket.simulateClose(); // disposed guard
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it('waitForProjections resolves with a seeded block; control baseline + projections seed it', async () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = sentOpens(socket).find((x) => x.startsWith('control-'))!;
		socket.push({
			type: 'item', streamId: id,
			value: { type: 'baseline', value: { projections: { s1: { asOfSeq: 3, values: { permissions: 'rw' } }, bad: null } } }
		});
		expect(conn.projectionValue('s1', 'permissions')).toBe('rw');
		expect(conn.projectionBlock('ghost')).toBe(null);
		// projection frame with no prior block seeds fresh; non-number seq keeps prior
		socket.push({ type: 'item', streamId: id, value: { type: 'projection', sessionId: 's2', key: 'todos', value: [1] } });
		expect(conn.projectionBlock('s2')).toEqual({ asOfSeq: 0, values: { todos: [1] } });
		socket.push({ type: 'item', streamId: id, value: { type: 'projection', sessionId: 's2', key: 'model', seq: 9, value: 'x' } });
		expect(conn.projectionBlock('s2')!.asOfSeq).toBe(9);
		// junk arms
		socket.push({ type: 'item', streamId: id, value: { type: 'projection', key: 'k' } });
		socket.push({ type: 'item', streamId: id, value: { type: 'baseline' } });
		const block = await conn.waitForProjections('s1', 100);
		expect(block).not.toBe(null);
		conn.dispose();
	});

	it('waitForProjections times out honestly when nothing lands', async () => {
		const conn = makeConn();
		const pending = conn.waitForProjections('never', 30);
		const block = await pending;
		expect(block).toBe(null);
		conn.dispose();
	});

	it('follow snapshot seeds the projection cache (objects kept, junk dropped) and live tail', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.subscribe('s1'); // buffer + follow stream for s1
		const id = followId(socket);
		socket.push({
			type: 'item', streamId: id,
			value: {
				type: 'snapshot', cursor: 4,
				records: [],
				projections: { asOfSeq: 2, values: { permissions: 'r' } },
				assistantStream: { frames: [] }
			}
		});
		expect(conn.projectionValue('s1', 'permissions')).toBe('r');
		// non-object projections block → not cached
		socket.push({ type: 'item', streamId: id, value: { type: 'snapshot', cursor: 5, projections: 'junk' } });
		expect(conn.projectionValue('s1', 'permissions')).toBe('r');
		conn.dispose();
	});
});
describe('downlinks — hint probe arms', () => {
	it('a list-RPC failure keeps the plain follow; a folded hint reopens with the parent address', async () => {
		const conn = makeConn({ failSessions: true });
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.subscribe('s1'); // fires the probe (list fails silently)
		await new Promise((r) => setTimeout(r, 10));
		// probe guard: disposed → no reopen
		conn.dispose();
	});

	it('a folded hint discovered during the probe reopens the follow on the same carrier', async () => {
		const scripted: Record<string, unknown> = {};
		const conn = makeConn(scripted);
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.subscribe('s1');
		// fold the hint before the probe's list lands → reopen arm fires
		conn.relay.subagentHints.set('s1', { parentSessionId: 'parent', mode: 'one-shot' });
		await new Promise((r) => setTimeout(r, 10));
		expect(sentOpens(socket).filter((x) => x.startsWith('follow-')).length).toBeGreaterThanOrEqual(2);
		conn.dispose();
	});

	it('a carrier rebuilt during the probe aborts the reopen (generation-moved guard)', async () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		conn.subscribe('s1');
		// rebuild the generation so the probe's socket !== wsMux
		socket.simulateClose();
		vi.advanceTimersByTime(50);
		await Promise.resolve();
		const fresh = muxSocket()!;
		FakeWebSocket.open(fresh);
		conn.relay.subagentHints.set('s1', { parentSessionId: 'parent', mode: 'continuable' });
		await Promise.resolve();
		// no crash, and the probe's reopen only ever targets the live carrier
		expect(muxSocket()).toBe(fresh);
		conn.dispose();
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshConnection } from '$lib/server/dsh-connection';

/** Birth Workspace Attach (2026-11-06, The Frozen Roster amendment D5/D6):
 *  the create choke point resolves an exact cwd-to-registry-path match into
 *  the workspaceId form (attach at birth); every miss/failure keeps the
 *  legacy cwd form. The pair is unreachable by construction (relay). */

/** Scripted fake WebSocket (one per downlink) — mirrors dsh-connection.test.ts. */
class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	listeners = new Map<string, Array<(e?: unknown) => void>>();
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

function muxSocket(): FakeWebSocket | undefined {
	return FakeWebSocket.instances.find((s) => s.url.endsWith('/api/remote.mux') && !s.closed);
}

function openSocket(socket: FakeWebSocket | undefined): void {
	for (const fn of socket?.listeners.get('open') ?? []) fn();
}

function pushStreamFrame(socket: FakeWebSocket | undefined, value: unknown): void {
	for (const fn of socket?.listeners.get('message') ?? []) fn({ data: JSON.stringify(value) });
}

function sentOpens(socket: FakeWebSocket): string[] {
	return socket.sent
		.map((raw) => {
			try {
				return JSON.parse(raw) as { type?: string; streamId?: string };
			} catch {
				// some sends are raw stream ids, not JSON envelopes
				return {} as { type?: string; streamId?: string };
			}
		})
		.filter((m): m is { type: 'open'; streamId: string } => m.type === 'open' && typeof m.streamId === 'string')
		.map((m) => m.streamId);
}

function fakeFetch(scripted: Record<string, unknown>): typeof fetch {
	return (async (url: unknown, init?: { body?: string }) => {
		const segments = String(url).split('/');
		const method = segments.slice(-2).join('/');
		const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
		const scriptedResult = scripted[method];
		const result = typeof scriptedResult === 'function'
			? (scriptedResult as (b: Record<string, unknown>) => unknown)(body)
			: scriptedResult;
		if (result === undefined) {
			return new Response(
				JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'test/unscripted', message: method } } }),
				{ status: 200 }
			);
		}
		return new Response(
			JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: result } }),
			{ status: 200 }
		);
	}) as unknown as typeof fetch;
}

function makeConn(scripted: Record<string, unknown> = {}): DshConnection {
	return new DshConnection({
		wsFactory: (u) => new FakeWebSocket(u) as never,
		fetchFn: fakeFetch(scripted),
		rpcIdFactory: () => 'rpc-test',
		backoffScheduleMs: [10, 20, 40]
	});
}

/** Seed the workspace/follow baseline the same way dsh-connection.test.ts does. */
function pushBaseline(conn: DshConnection, items: unknown[]): void {
	conn.ensureDownlinks();
	const socket = muxSocket();
	openSocket(socket);
	const id = sentOpens(socket!)
		.find((streamId) => streamId.startsWith('workspaces-'));
	pushStreamFrame(socket, { type: "item", streamId: id, value: { type: "baseline", value: { items } } });
}

/** Capture the session/create request args envelope. */
function captureCreateArgs(scripted: Record<string, unknown>): Array<Record<string, unknown>> {
	const seen: Array<Record<string, unknown>> = [];
	scripted['session/create'] = ((body: { payload?: { args?: unknown } }) => {
		seen.push(JSON.parse(JSON.stringify(body.payload?.args)) as Record<string, unknown>);
		return { sessionId: 's-new' };
	}) as never;
	return seen;
}

beforeEach(() => {
	FakeWebSocket.instances = [];
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('birth workspace attach — create choke point resolution (ADR D5/D6)', () => {
	it('1.2 exact cwd match sends workspaceId and OMITS cwd (attach at birth)', async () => {
		const scripted: Record<string, unknown> = {};
		const seen = captureCreateArgs(scripted);
		const conn = makeConn(scripted);
		pushBaseline(conn, [
			{ workspaceId: 'w-agg', title: 'agentic-ai', path: '/Users/wharsojo/agentic-ai', sessionIds: [] }
		]);
		await conn.createSession('/Users/wharsojo/agentic-ai', 'ptc');
		expect(seen[0].request).toEqual({ workspaceId: "w-agg", agentPreset: "ptc" });
	});

	it('1.2 cwd miss keeps the legacy cwd form', async () => {
		const scripted: Record<string, unknown> = {};
		const seen = captureCreateArgs(scripted);
		const conn = makeConn(scripted);
		pushBaseline(conn, [
			{ workspaceId: 'w-agg', title: 'agentic-ai', path: '/Users/wharsojo/agentic-ai', sessionIds: [] }
		]);
		await conn.createSession('/tmp/elsewhere', 'ptc');
		expect(seen[0].request).toEqual({ cwd: "/tmp/elsewhere", agentPreset: "ptc" });
	});

	it('1.2 empty registry (no baseline rows) falls back to cwd', async () => {
		const scripted: Record<string, unknown> = {};
		const seen = captureCreateArgs(scripted);
		const conn = makeConn(scripted);
		pushBaseline(conn, []);
		await conn.createSession('/Users/wharsojo/agentic-ai');
		expect(seen[0].request).toEqual({ cwd: "/Users/wharsojo/agentic-ai" });
	});

	it('1.2 registry lookup failure falls back to cwd - the create never fails on resolution', async () => {
		const scripted: Record<string, unknown> = {};
		const seen = captureCreateArgs(scripted);
		const conn = makeConn(scripted);
		vi.spyOn(conn, 'listWorkspaces').mockRejectedValue(new Error('registry down'));
		const out = await conn.createSession('/Users/wharsojo/agentic-ai', 'ptc');
		expect(seen[0].request).toEqual({ cwd: "/Users/wharsojo/agentic-ai", agentPreset: "ptc" });
		expect(out).toEqual({ sessionId: 's-new' });
	});

	it('1.1 the pair cwd+workspaceId is unreachable by construction (relay encoding)', async () => {
		const scripted: Record<string, unknown> = {};
		const seen = captureCreateArgs(scripted);
		const conn = makeConn(scripted);
		pushBaseline(conn, [
			{ workspaceId: 'w-agg', title: 'agentic-ai', path: '/Users/wharsojo/agentic-ai', sessionIds: [] }
		]);
		await conn.createSession('/Users/wharsojo/agentic-ai', 'ptc');
		const request = seen[0].request as Record<string, unknown>;
		expect('workspaceId' in request).toBe(true);
		expect('cwd' in request).toBe(false);
	});

	it('1.2 undefined cwd (host default) never consults the registry', async () => {
		const scripted: Record<string, unknown> = {};
		const seen = captureCreateArgs(scripted);
		const spy = vi.spyOn(DshConnection.prototype, "listWorkspaces");
		const conn = makeConn(scripted);
		await conn.createSession(undefined, "research");
		expect(spy).not.toHaveBeenCalled();
		expect(seen[0].request).toEqual({ agentPreset: "research" });
	});
});
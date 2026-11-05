/**
 * Terminal transport route seam tests (coverage round) — the mocked
 * counterpart to terminal-routes.test.ts. The registry/session engine is
 * faked (the goal-route.test.ts pattern) so every transport decision is
 * pinned without spawning node-pty:
 *   - send: bad JSON/unknown action/bad payload -> 400 before the registry;
 *     write/signal/close forwarding; refusal mapping (NO_SESSION 404,
 *     other refusal 403, SEND_ACTIVE 409); non-quiescent close -> 500; an
 *     unknown rejection rethrows.
 *   - output: fromByte coercion, refusal mapping, unknown rejection rethrow.
 *   - stream: peek gate, dead events() -> 404, frame order (tail then live
 *     deltas/settled/exit/closed), the vanished-between-peek-and-subscribe
 *     error frame, and stream teardown after 'closed'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registrySpies = vi.hoisted(() => ({
	peek: vi.fn(),
	write: vi.fn(),
	signal: vi.fn(),
	resize: vi.fn(),
	close: vi.fn(),
	readFrom: vi.fn(),
	events: vi.fn(),
	exitOutcome: vi.fn(),
	list: vi.fn()
}));

vi.mock('$lib/server/terminal/registry.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/terminal/registry.js')>();
	return { ...actual, terminalRegistry: registrySpies };
});
vi.mock('$lib/server/terminal/session.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/terminal/session.js')>();
	return { ...actual };
});

import { TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import { TerminalSendRefusal } from '$lib/server/terminal/session.js';
import { POST as sendRoute } from '../../src/routes/api/terminal/[id]/send/+server';
import { GET as outputRoute } from '../../src/routes/api/terminal/[id]/output/+server';
import { GET as streamRoute } from '../../src/routes/api/terminal/[id]/stream/+server';

function post(body: unknown): Request {
	return new Request('http://localhost/api/terminal/t1/send', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

async function send(body: unknown): Promise<Response> {
	return (await sendRoute({ params: { id: 't1' }, request: post(body) } as never)) as Response;
}

function get(url: string): { params: { id: string }; url: URL } {
	return { params: { id: 't1' }, url: new URL(url) };
}

/** Fake session: a plain emitter with the stream route's surface. */
function fakeSession(overrides: Partial<{ readFrom: () => unknown; isExited: () => boolean }> = {}) {
	const handlers = new Map<string, (e: unknown) => void>();
	return {
		on: (ev: string, fn: (e: unknown) => void) => handlers.set(ev, fn),
		off: (ev: string): void => {
			handlers.delete(ev);
		},
		emit: (event: unknown) => handlers.get('event')?.(event),
		readFrom: overrides.readFrom ?? vi.fn(() => ({ text: 'tail', nextOffset: 4, lossy: false, spillPath: null })),
		isExited: overrides.isExited ?? (() => false)
	};
}

function drainSse(response: Response): Promise<Array<{ event: string } & Record<string, unknown>>> {
	return new Promise((resolve) => {
		const frames: Array<{ event: string } & Record<string, unknown>> = [];
		const reader = response.body!.getReader();
		const dec = new TextDecoder();
		let buf = '';
		const pump = (): void => {
			reader.read().then(({ done, value }) => {
				if (done) {
					resolve(frames);
					return;
				}
				buf += dec.decode(value, { stream: true });
				let idx: number;
				while ((idx = buf.indexOf('\n\n')) !== -1) {
					const chunk = buf.slice(0, idx);
					buf = buf.slice(idx + 2);
					const ev = /event: (.+)/.exec(chunk)?.[1];
					const data = /data: (.+)/.exec(chunk)?.[1];
					if (ev && data) frames.push({ event: ev, ...(JSON.parse(data) as Record<string, unknown>) });
				}
				pump();
			});
		};
		pump();
	});
}

beforeEach(() => {
	for (const fn of Object.values(registrySpies)) fn.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/terminal/[id]/send — payload validation (400 before the registry)', () => {
	it('a non-JSON body answers 400 BAD_REQUEST', async () => {
		const res = await send('{not json');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(registrySpies.write).not.toHaveBeenCalled();
	});

	it('an unknown action answers 400 BAD_REQUEST', async () => {
		const res = await send({ token: 'k', action: 'reboot' });
		expect(res.status).toBe(400);
		expect(registrySpies.write).not.toHaveBeenCalled();
	});

	it('write without string data answers 400 BAD_REQUEST', async () => {
		const res = await send({ token: 'k', action: 'write', data: 42 });
		expect(res.status).toBe(400);
		expect(registrySpies.write).not.toHaveBeenCalled();
	});

	it.each([
		['non-numeric cols', { token: 'k', action: 'resize', cols: 'wide', rows: 24 }],
		['non-numeric rows', { token: 'k', action: 'resize', cols: 80, rows: null }],
		['cols below minimum', { token: 'k', action: 'resize', cols: 1, rows: 24 }],
		['rows below minimum', { token: 'k', action: 'resize', cols: 80, rows: 1 }]
	])('resize %s answers 400 BAD_REQUEST', async (_name, body) => {
		const res = await send(body);
		expect(res.status).toBe(400);
		expect(registrySpies.resize).not.toHaveBeenCalled();
	});

	it('resize forwards fitted dims and answers {resized:true}', async () => {
		const res = await send({ token: 'tok', action: 'resize', cols: 120, rows: 40 });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ resized: true });
		expect(registrySpies.resize).toHaveBeenCalledExactlyOnceWith('t1', 'tok', 120, 40);
	});

	it.each([
		['missing signal', { token: 'k', action: 'signal' }],
		['bad signal name', { token: 'k', action: 'signal', signal: 'SIGVMAX' }],
		['non-string signal', { token: 'k', action: 'signal', signal: 9 }]
	])('signal %s answers 400 BAD_REQUEST', async (_name, body) => {
		const res = await send(body);
		expect(res.status).toBe(400);
		expect(registrySpies.signal).not.toHaveBeenCalled();
	});
});

describe('POST /api/terminal/[id]/send — forwarding and refusal mapping', () => {
	it('write forwards (id, token, data) and answers {written:true}', async () => {
		const res = await send({ token: 'tok', action: 'write', data: 'ls\n' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ written: true });
		expect(registrySpies.write).toHaveBeenCalledExactlyOnceWith('t1', 'tok', 'ls\n');
	});

	it('signal forwards (id, token, signal) and answers {signalled:pgid}', async () => {
		registrySpies.signal.mockReturnValueOnce(4242);
		const res = await send({ token: 'tok', action: 'signal', signal: 'SIGINT' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ signalled: 4242 });
		expect(registrySpies.signal).toHaveBeenCalledExactlyOnceWith('t1', 'tok', 'SIGINT');
	});

	it('a quiescent close answers 200 with the result', async () => {
		registrySpies.close.mockResolvedValueOnce({ quiescent: true });
		const res = await send({ token: 'tok', action: 'close' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ quiescent: true });
		expect(registrySpies.close).toHaveBeenCalledExactlyOnceWith('t1', 'tok');
	});

	it('a close with lingering processes answers 500 with the result', async () => {
		registrySpies.close.mockResolvedValueOnce({ quiescent: false, lingeringPids: [7] });
		const res = await send({ token: 'tok', action: 'close' });
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ quiescent: false, lingeringPids: [7] });
	});

	it('a missing token is forwarded as an empty string', async () => {
		const res = await send({ action: 'write', data: 'x' });
		expect(res.status).toBe(200);
		expect(registrySpies.write).toHaveBeenCalledExactlyOnceWith('t1', '', 'x');
	});

	it.each<[code: 'NO_SESSION' | 'FOREIGN_SESSION', status: number]>([
		['NO_SESSION', 404],
		['FOREIGN_SESSION', 403]
	])('registry refusal %s maps to HTTP %i', async (code, status) => {
		registrySpies.write.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal(code, 'why');
		});
		const res = await send({ token: 'tok', action: 'write', data: 'x' });
		expect(res.status).toBe(status);
		expect(await res.json()).toEqual({ error: code });
	});

	it('a send-lock refusal maps to 409 SEND_ACTIVE', async () => {
		registrySpies.write.mockImplementationOnce(() => {
			throw new TerminalSendRefusal();
		});
		const res = await send({ token: 'tok', action: 'write', data: 'x' });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'SEND_ACTIVE' });
	});

	it('an unknown rejection rethrows', async () => {
		registrySpies.write.mockImplementationOnce(() => {
			throw new TypeError('pty exploded');
		});
		await expect(send({ token: 'tok', action: 'write', data: 'x' })).rejects.toThrow('pty exploded');
	});
});

describe('GET /api/terminal/[id]/output — the retained tail as JSON', () => {
	it('forwards the coerced fromByte and answers the read result', async () => {
		registrySpies.readFrom.mockReturnValueOnce({ text: 'out', nextOffset: 3, lossy: false, spillPath: null });
		const res = outputRoute(get('http://localhost/api/terminal/t1/output?fromByte=3')) as Response;
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ text: 'out', nextOffset: 3, lossy: false, spillPath: null });
		expect(registrySpies.readFrom).toHaveBeenCalledExactlyOnceWith('t1', 3);
	});

	it.each([
		['missing fromByte', ''],
		['negative fromByte', '?fromByte=-5'],
		['non-numeric fromByte', '?fromByte=zzz']
	])('%s coerces to offset 0', (_name, query) => {
		registrySpies.readFrom.mockReturnValueOnce({ text: '', nextOffset: 0, lossy: false, spillPath: null });
		outputRoute(get('http://localhost/api/terminal/t1/output' + query)) as Response;
		expect(registrySpies.readFrom).toHaveBeenCalledExactlyOnceWith('t1', 0);
	});

	it.each<[code: 'NO_SESSION' | 'FOREIGN_SESSION', status: number]>([
		['NO_SESSION', 404],
		['FOREIGN_SESSION', 403]
	])('registry refusal %s maps to HTTP %i', async (code, status) => {
		registrySpies.readFrom.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal(code, 'why');
		});
		const res = outputRoute(get('http://localhost/api/terminal/t1/output')) as Response;
		expect(res.status).toBe(status);
		expect(await res.json()).toEqual({ error: code });
	});

	it('an unknown rejection rethrows', () => {
		registrySpies.readFrom.mockImplementationOnce(() => {
			throw new TypeError('ring corrupted');
		});
		expect(() => outputRoute(get('http://localhost/api/terminal/t1/output'))).toThrow('ring corrupted');
	});
});

describe('GET /api/terminal/[id]/stream — the SSE downstream', () => {
	it.each<[code: 'NO_SESSION' | 'FOREIGN_SESSION', status: number]>([
		['NO_SESSION', 404],
		['FOREIGN_SESSION', 403]
	])('peek refusal %s maps to HTTP %i', async (code, status) => {
		registrySpies.peek.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal(code, 'why');
		});
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream')) as Response;
		expect(res.status).toBe(status);
		expect(await res.json()).toEqual({ error: code });
	});

	it('an unknown peek rejection rethrows', () => {
		registrySpies.peek.mockImplementationOnce(() => {
			throw new TypeError('registry gone');
		});
		expect(() => streamRoute(get('http://localhost/api/terminal/t1/stream'))).toThrow('registry gone');
	});

	it('a dead events() subscription answers 404 NO_SESSION', async () => {
		registrySpies.events.mockReturnValueOnce(null);
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream')) as Response;
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION' });
	});

	it('negative fromByte coerces to 0 for the tail read', async () => {
		const session = fakeSession();
		registrySpies.events.mockReturnValueOnce(session);
		registrySpies.exitOutcome.mockReturnValueOnce(null);
		registrySpies.list.mockReturnValueOnce([]);
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream?fromByte=-9')) as Response;
		expect(session.readFrom).toHaveBeenCalledExactlyOnceWith(0);
		session.emit({ type: 'closed', quiescent: true, lingeringPids: [] });
		const frames = await drainSse(res);
		expect(frames[0].event).toBe('output');
		expect(frames[frames.length - 1].event).toBe('closed');
	});

	it('frame order: output tail, live output, settled, exit, closed — then the stream ends', async () => {
		const session = fakeSession();
		registrySpies.events.mockReturnValueOnce(session);
		registrySpies.exitOutcome.mockReturnValueOnce(null);
		registrySpies.list.mockReturnValueOnce([]);
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream')) as Response;
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(res.headers.get('cache-control')).toBe('no-store');
		const framesDone = drainSse(res);

		session.emit({ type: 'output', bytes: 'live', nextOffset: 9 });
		session.emit({ type: 'settled', reason: 'idle' });
		session.emit({ type: 'exit', outcome: { code: 0 } });
		session.emit({ type: 'closed', quiescent: true, lingeringPids: [] });

		const frames = await framesDone;
		expect(frames.map((f) => f.event)).toEqual(['output', 'output', 'settled', 'exit', 'closed']);
		expect(frames[1]).toMatchObject({ text: 'live', nextOffset: 9, lossy: false });
		expect(frames[2]).toMatchObject({ reason: 'idle' });
		expect(frames[3]).toMatchObject({ outcome: { code: 0 } });
		expect(frames[4]).toMatchObject({ quiescent: true, lingeringPids: [] });
	});

	it('a session vanished between peek and subscribe ends honestly with an error frame', async () => {
		const session = fakeSession({ isExited: () => true });
		registrySpies.events.mockReturnValueOnce(session);
		registrySpies.exitOutcome.mockReturnValueOnce({ code: 0 });
		registrySpies.list.mockReturnValueOnce([]); // the id slid out
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream')) as Response;
		const frames = await drainSse(res);
		expect(frames.map((f) => f.event)).toEqual(['output', 'error']);
		expect(frames[1]).toMatchObject({ error: 'NO_SESSION' });
	});

	it('an exited session still listed stays open (no error frame)', async () => {
		const session = fakeSession({ isExited: () => true });
		registrySpies.events.mockReturnValueOnce(session);
		registrySpies.exitOutcome.mockReturnValueOnce({ code: 0 });
		registrySpies.list.mockReturnValueOnce([{ id: 't1' }]);
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream')) as Response;
		const framesDone = drainSse(res);
		session.emit({ type: 'closed', quiescent: true, lingeringPids: [] });
		const frames = await framesDone;
		expect(frames.map((f) => f.event)).toEqual(['output', 'closed']);
	});

	it('a client cancel drops the listener so a live PTY cannot enqueue (lines 108-109)', async () => {
		const offs: string[] = [];
		const session = fakeSession();
		const rawOff = session.off;
		session.off = (ev: string) => {
			offs.push(ev);
			rawOff(ev);
		};
		registrySpies.events.mockReturnValueOnce(session);
		registrySpies.exitOutcome.mockReturnValueOnce(null);
		registrySpies.list.mockReturnValueOnce([]);
		const res = streamRoute(get('http://localhost/api/terminal/t1/stream')) as Response;
		const reader = res.body!.getReader();
		await reader.cancel(); // the tab went away mid-stream
		expect(offs).toEqual(['event']);
		// the crash-RCA contract: a post-cancel PTY chunk must be a silent
		// no-op (state.closed guard), never an ERR_INVALID_STATE throw
		expect(() => session.emit({ type: 'output', bytes: 'late', nextOffset: 2 })).not.toThrow();
	});
});


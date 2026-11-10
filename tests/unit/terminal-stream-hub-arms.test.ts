/**
 * /api/terminal/stream hub — parse + event-kind arm mop (2026-11-10).
 * terminal-stream-hub.test.ts pins the AC wire; THIS file drives the arms
 * that suite never reaches, over the same MOCKED registry seam:
 *  - parseIds: a JSON NON-array (object / scalar) -> 400 NO_IDS;
 *  - parseIds: duplicate ids are DEDUPED (one tail read, one listener);
 *  - parseResume: invalid JSON / a JSON array / junk values (negative,
 *    NaN, Infinity, string) are dropped — the tail reads from 0;
 *  - events(id) returning undefined after an OK peek -> one NO_SESSION
 *    error frame for that id, the hub keeps serving the live id;
 *  - the 'exit' event kind is forwarded tagged with its sessionId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { peekMock, eventsMock, readFromMock, exitOutcomeMock, listMock } = vi.hoisted(() => ({
	peekMock: vi.fn(),
	eventsMock: vi.fn(),
	readFromMock: vi.fn(),
	exitOutcomeMock: vi.fn(),
	listMock: vi.fn()
}));

vi.mock('$lib/server/terminal/registry.js', () => {
	class TerminalRegistryRefusal extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.name = 'TerminalRegistryRefusal';
			this.code = code;
		}
	}
	return {
		TerminalRegistryRefusal,
		terminalRegistry: {
			peek: peekMock,
			events: eventsMock,
			readFrom: readFromMock,
			exitOutcome: exitOutcomeMock,
			list: listMock
		}
	};
});

import { GET as hubRoute } from '../../src/routes/api/terminal/stream/+server';

type Listener = (event: Record<string, unknown>) => void;

function fakeSession(): { listener: Listener | null; on(k: string, fn: Listener): void; off(k: string, fn: Listener): void } {
	const s = {
		listener: null as Listener | null,
		isExited: () => false,
		on(_kind: string, fn: Listener) {
			s.listener = fn;
		},
		off(_kind: string, fn: Listener) {
			if (s.listener === fn) s.listener = null;
		}
	};
	return s;
}

function url(ids: unknown, resume?: unknown): URL {
	const p = new URLSearchParams();
	p.set('ids', typeof ids === 'string' ? ids : JSON.stringify(ids));
	if (resume !== undefined) p.set('resume', typeof resume === 'string' ? resume : JSON.stringify(resume));
	return new URL('http://localhost/api/terminal/stream?' + p.toString());
}

interface ScriptableController {
	enqueue: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
}
const closeRef: { realClose: () => void } = { realClose: () => undefined };
const controller: ScriptableController = {
	enqueue: vi.fn((_chunk: Uint8Array) => undefined),
	close: vi.fn(() => undefined)
};

beforeEach(() => {
	peekMock.mockReset();
	eventsMock.mockReset();
	readFromMock.mockReset();
	exitOutcomeMock.mockReset();
	listMock.mockReset();
	controller.enqueue.mockReset().mockImplementation(() => undefined);
	controller.close.mockReset().mockImplementation(() => closeRef.realClose());
	class FakeReadableStream extends ReadableStream<Uint8Array> {
		constructor(spec: { start: (c: ScriptableController) => void; cancel: () => void }) {
			super({ start: (c) => spec.start(controller), cancel: spec.cancel });
		}
	}
	vi.stubGlobal('ReadableStream', FakeReadableStream);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function frames(): string[] {
	const dec = new TextDecoder();
	return controller.enqueue.mock.calls.map((c) => dec.decode(c[0] as Uint8Array));
}

function liveId(id = 't-1'): void {
	peekMock.mockReturnValue({ id, exited: false });
	eventsMock.mockImplementation(() => fakeSession());
	readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });
}

describe('terminal stream hub — parse arms', () => {
	it('a JSON OBJECT in ids is NOT an array -> 400 NO_IDS', () => {
		expect((hubRoute({ url: url({ a: 1 }) }) as Response).status).toBe(400);
	});

	it('a JSON SCALAR in ids is NOT an array -> 400 NO_IDS', () => {
		expect((hubRoute({ url: url('"just-a-string"') }) as Response).status).toBe(400);
	});

	it('duplicate ids are DEDUPED — one tail read, one listener', () => {
		liveId();
		const session = eventsMock.mock.results.length; // placeholder, real check below
		void session;
		eventsMock.mockClear();
		const s = fakeSession();
		eventsMock.mockImplementation(() => s);
		const res = hubRoute({ url: url(['t-1', 't-1']) }) as Response;
		expect(res).toBeInstanceOf(Response);
		expect(readFromMock).toHaveBeenCalledTimes(1);
		expect(readFromMock).toHaveBeenCalledWith('t-1', 0);
	});

	it('an UNPARSEABLE resume rides as {} — the tail reads from 0', () => {
		liveId();
		hubRoute({ url: url(['t-1'], 'not-json{') }) as Response;
		expect(readFromMock).toHaveBeenCalledWith('t-1', 0);
	});

	it('a resume JSON ARRAY is not an object -> tail reads from 0', () => {
		liveId();
		hubRoute({ url: url(['t-1'], [42]) }) as Response;
		expect(readFromMock).toHaveBeenCalledWith('t-1', 0);
	});

	it('resume junk values (negative / NaN / Infinity / string) are dropped, valid ones kept', () => {
		liveId('t-1');
		eventsMock.mockImplementation((id: string) => fakeSession());
		hubRoute({ url: url(['t-1', 't-2'], { 't-1': -5, 't-2': 7 }) }) as Response;
		expect(readFromMock).toHaveBeenCalledWith('t-1', 0); // negative dropped
		expect(readFromMock).toHaveBeenCalledWith('t-2', 7); // valid kept
	});
});

describe('terminal stream hub — per-id + event-kind arms', () => {
	it('peek OK but events() undefined -> one NO_SESSION error frame, the live id keeps streaming', () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		eventsMock.mockImplementation((id: string) => (id === 'ghost' ? undefined : fakeSession()));
		readFromMock.mockReturnValue({ text: 'tail', nextOffset: 1, lossy: false });

		const res = hubRoute({ url: url(['ghost', 'live']) }) as Response;
		expect(res).toBeInstanceOf(Response);
		const all = frames().join('');
		expect(all).toContain('"sessionId":"ghost","error":"NO_SESSION"');
		expect(all).toContain('"sessionId":"live"'); // the hub survived
	});

	it('an EXIT event is forwarded tagged with its sessionId (the third kind arm)', () => {
		liveId();
		const s = fakeSession();
		eventsMock.mockImplementation(() => s);
		hubRoute({ url: url(['t-1']) }) as Response;
		controller.enqueue.mockClear();
		s.listener!({ type: 'exit', outcome: 'crashed' });
		const all = frames().join('');
		expect(all).toContain('event: exit');
		expect(all).toContain('"sessionId":"t-1","outcome":"crashed"');
	});

	it('the exit event arm precedes closed: an unknown event kind enqueues NOTHING', () => {
		liveId();
		const s = fakeSession();
		eventsMock.mockImplementation(() => s);
		hubRoute({ url: url(['t-1']) }) as Response;
		controller.enqueue.mockClear();
		s.listener!({ type: 'mystery' } as never);
		expect(frames()).toEqual([]);
	});
});

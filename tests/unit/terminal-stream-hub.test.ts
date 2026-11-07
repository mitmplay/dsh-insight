/**
 * Wave 1 unit tests for the multiplexed hub endpoint
 * /api/terminal/stream (ADR-0053) over a MOCKED registry — the real
 * TerminalSession is PTY-bound and is NEVER instantiated in tests
 * (probe-corrected fact, karpathy-context 1.8).
 *
 * Pins the ACs this endpoint owns:
 * - AC5: a dead id emits a per-session error frame and the hub survives;
 * - AC7: client cancel drops ALL per-session listeners (crash RCA
 *   2026-09-24 — no listener may survive into a dead controller);
 * - tagging: every frame carries its sessionId (no cross-delivery shape);
 * - resume: the per-id resume offset is honored on the tail read;
 * - the per-session endpoint stays untouched (D6) — nothing here imports it.
 *
 * Wave 2 (appended): the CLIENT hub service suite — refcount, debounce,
 * resume map, dispatch isolation, the ONE hub ladder (FakeEventSource).
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
import { TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';

type Listener = (event: Record<string, unknown>) => void;

interface FakeSession {
	listener: Listener | null;
	isExited: () => boolean;
}

function fakeSession(): FakeSession & { on: unknown; off: unknown } {
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
	return s as unknown as FakeSession & { on: unknown; off: unknown };
}

function url(ids: string[], resume?: Record<string, number>): URL {
	const p = new URLSearchParams();
	p.set('ids', JSON.stringify(ids));
	if (resume) p.set('resume', JSON.stringify(resume));
	return new URL('http://localhost/api/terminal/stream?' + p.toString());
}

/** Scriptable controller handed to start() (extends the REAL ReadableStream). */
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

describe('terminal stream hub route — mock registry', () => {
	it('empty/invalid ids -> 400 NO_IDS (nothing to multiplex, no stream held)', () => {
		expect((hubRoute({ url: url([]) }) as Response).status).toBe(400);
		const bad = new URL('http://localhost/api/terminal/stream?ids=not-json');
		expect((hubRoute({ url: bad }) as Response).status).toBe(400);
		// non-string entries are FILTERED, not crashed on: [1,"t-1"] -> ["t-1"] streams
		peekMock.mockReturnValue({ id: 'x', exited: false });
		eventsMock.mockReturnValue(fakeSession());
		readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });
		const mixed = new URL('http://localhost/api/terminal/stream?ids=' + encodeURIComponent('[1,"t-1"]'));
		expect((hubRoute({ url: mixed }) as Response).status).toBe(200);
		expect(readFromMock).toHaveBeenCalledWith('t-1', 0);
	});

	it('N ids -> tail frame per id, each tagged with its sessionId (no cross-delivery shape)', () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		const s1 = fakeSession();
		const s2 = fakeSession();
		eventsMock.mockImplementation((id: string) => (id === 't-1' ? s1 : s2));
		readFromMock.mockImplementation((id: string, from: number) => ({ text: id + ':' + from, nextOffset: from + 4, lossy: false }));

		const res = hubRoute({ url: url(['t-1', 't-2']) }) as Response;
		expect(res).toBeInstanceOf(Response);
		const all = frames().join('');
		expect(all).toContain('"sessionId":"t-1"');
		expect(all).toContain('"sessionId":"t-2"');
		// each tail was read from offset 0 with its OWN id
		expect(readFromMock).toHaveBeenCalledWith('t-1', 0);
		expect(readFromMock).toHaveBeenCalledWith('t-2', 0);
		// one listener per id attached
		expect(s1.listener).not.toBeNull();
		expect(s2.listener).not.toBeNull();
	});

	it('resume offsets ride the tail read per id (AC4 shape)', () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		const s = fakeSession();
		eventsMock.mockReturnValue(s);
		readFromMock.mockReturnValue({ text: 'tail', nextOffset: 99, lossy: false });

		hubRoute({ url: url(['t-1', 't-2'], { 't-1': 42 }) }) as Response;
		expect(readFromMock).toHaveBeenCalledWith('t-1', 42);
		expect(readFromMock).toHaveBeenCalledWith('t-2', 0);
	});

	it('live output events are forwarded tagged by sessionId (dispatch key on the wire)', () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		const s1 = fakeSession();
		const s2 = fakeSession();
		eventsMock.mockImplementation((id: string) => (id === 't-1' ? s1 : s2));
		readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });

		hubRoute({ url: url(['t-1', 't-2']) }) as Response;
		controller.enqueue.mockClear();

		s1.listener!({ type: 'output', bytes: 'from-one', nextOffset: 7 });
		s2.listener!({ type: 'settled', reason: 'stdin_read' });
		const all = frames().join('');
		expect(all).toContain('event: output');
		expect(all).toContain('"sessionId":"t-1","text":"from-one","nextOffset":7');
		expect(all).toContain('"sessionId":"t-2","reason":"stdin_read"');
		// t-1's event never landed under t-2's tag
		expect(all.match(/"sessionId":"t-2"[^}]*from-one/g)).toBeNull();
	});

	it('AC5: a dead id emits ONE per-session error frame and the hub keeps serving the live id', () => {
		peekMock.mockImplementation((id: string) => {
			if (id === 'dead') throw new TerminalRegistryRefusal('NO_SESSION', 'gone');
			return { id, exited: false };
		});
		const live = fakeSession();
		eventsMock.mockImplementation((id: string) => (id === 'live' ? live : undefined));
		readFromMock.mockReturnValue({ text: 'tail', nextOffset: 3, lossy: false });

		const res = hubRoute({ url: url(['dead', 'live']) }) as Response;
		expect(res).toBeInstanceOf(Response);
		const all = frames().join('');
		expect(all).toContain('"sessionId":"dead","error":"NO_SESSION"');
		// the live id still got its tail and its listener
		expect(all).toContain('"sessionId":"live"');
		expect(live.listener).not.toBeNull();
	});

	it('AC7: client cancel drops ALL per-session listeners', async () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		const s1 = fakeSession();
		const s2 = fakeSession();
		eventsMock.mockImplementation((id: string) => (id === 't-1' ? s1 : s2));
		readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });

		const res = hubRoute({ url: url(['t-1', 't-2']) }) as Response;
		expect(s1.listener).not.toBeNull();
		expect(s2.listener).not.toBeNull();

		await res.body!.cancel();
		expect(s1.listener).toBeNull();
		expect(s2.listener).toBeNull();
	});

	it('session closed frame: ONLY that id detaches; other listeners survive (AC5 survival shape)', () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		const s1 = fakeSession();
		const s2 = fakeSession();
		eventsMock.mockImplementation((id: string) => (id === 't-1' ? s1 : s2));
		readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });

		hubRoute({ url: url(['t-1', 't-2']) }) as Response;
		s1.listener!({ type: 'closed', quiescent: true });
		expect(s1.listener).toBeNull();
		expect(s2.listener).not.toBeNull();
		// closed frame went out tagged
		expect(frames().join('')).toContain('"sessionId":"t-1","quiescent":true');
	});

	it('enqueue throws mid-stream (cancel race): later events are swallowed, no server crash', () => {
		peekMock.mockReturnValue({ id: 'x', exited: false });
		const s = fakeSession();
		eventsMock.mockReturnValue(s);
		readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });
		controller.enqueue.mockImplementation(() => {
			throw new Error('dead controller (simulated cancel race)');
		});

		const res = hubRoute({ url: url(['t-1']) }) as Response;
		expect(res).toBeInstanceOf(Response);
		expect(() => {
			s.listener!({ type: 'output', bytes: 'x', nextOffset: 1 });
			s.listener!({ type: 'closed', quiescent: true });
		}).not.toThrow();
	});

	it('vanishing session between peek and subscribe: error frame for that id, other ids keep listeners', () => {
		peekMock.mockReturnValue({ id: 'x', exited: true });
		const vanishing = fakeSession();
		vanishing.isExited = () => true;
		const healthy = fakeSession();
		eventsMock.mockImplementation((id: string) => (id === 'gone' ? vanishing : healthy));
		readFromMock.mockReturnValue({ text: '', nextOffset: 0, lossy: false });
		exitOutcomeMock.mockReturnValue('normal');
		listMock.mockReturnValue([{ id: 'other' }]);

		hubRoute({ url: url(['gone', 'here']) }) as Response;
		const all = frames().join('');
		expect(all).toContain('"sessionId":"gone","error":"NO_SESSION"');
		expect(vanishing.listener).toBeNull();
		expect(healthy.listener).not.toBeNull();
	});

	it('a peek throwing a non-refusal error rethrows (real registry bug, not a dead session)', () => {
		peekMock.mockImplementation(() => {
			throw new TypeError('registry blew up');
		});
		expect(() => hubRoute({ url: url(['t-1']) })).toThrow(TypeError);
	});
});

/* ============================================================
 * Wave 2 — the CLIENT hub service (stream-hub.svelte.ts)
 * ADR-0053 D1-D5: refcount lifecycle, set-diff debounce, resume
 * map from painted offsets, ONE hub ladder, dispatch by id.
 * ============================================================ */

import { subscribeTerminalStream, resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';

/** The scriptable EventSource the hub under test opens. */
class FakeEventSource {
	static instances: FakeEventSource[] = [];
	url: string;
	closed = false;
	listeners = new Map<string, Array<(e: { data?: string }) => void>>();
	onerror: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}
	addEventListener(kind: string, fn: (e: { data?: string }) => void): void {
		const arr = this.listeners.get(kind) ?? [];
		arr.push(fn);
		this.listeners.set(kind, arr);
	}
	emit(kind: string, data: unknown): void {
		for (const fn of this.listeners.get(kind) ?? []) fn({ data: JSON.stringify(data) });
	}
	fireError(): void {
		this.onerror?.();
	}
	close(): void {
		this.closed = true;
	}
}

function frame(kind: string, data: string): { data?: string } {
	return { data };
}

describe('terminal stream hub service — refcount client hub', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeEventSource.instances = [];
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
	});

	afterEach(() => {
		resetStreamHubForTests();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('AC1 shape: first subscriber opens exactly ONE source carrying ids + resume', () => {
		const off1 = subscribeTerminalStream('t-1', 0, { onFrame: () => undefined });
		expect(FakeEventSource.instances).toHaveLength(1);
		const url = FakeEventSource.instances[0].url;
		expect(url).toContain('/api/terminal/stream?');
		expect(url).toContain('ids=' + encodeURIComponent('["t-1"]'));
		// second subscriber (different row, same page): still ONE source until the set settles
		subscribeTerminalStream('t-2', 0, { onFrame: () => undefined });
		expect(FakeEventSource.instances).toHaveLength(1);
		vi.advanceTimersByTime(300);
		// the debounced re-open carries BOTH ids
		expect(FakeEventSource.instances).toHaveLength(2);
		const reopened = FakeEventSource.instances[1].url;
		expect(reopened).toContain('t-2');
		off1();
	});

	it('AC3: frames dispatch ONLY to the subscriber owning the sessionId', () => {
		const seen1: string[] = [];
		const seen2: string[] = [];
		subscribeTerminalStream('t-1', 0, { onFrame: (k, d) => seen1.push(k + ':' + String(d.text ?? d.reason ?? '')) });
		subscribeTerminalStream('t-2', 0, { onFrame: (k, d) => seen2.push(k + ':' + String(d.text ?? d.reason ?? '')) });
		vi.advanceTimersByTime(300);
		const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
		es.emit('output', { sessionId: 't-1', text: 'one', nextOffset: 5 });
		es.emit('output', { sessionId: 't-2', text: 'two', nextOffset: 7 });
		es.emit('settled', { sessionId: 't-2', reason: 'stdin_read' });
		expect(seen1).toEqual(['output:one']);
		expect(seen2).toEqual(['output:two', 'settled:stdin_read']);
	});

	it('row-side dedupe: a frame at/below the painted offset is NOT painted twice (re-open window pin)', () => {
		const texts: string[] = [];
		let lastOffset = 0;
		subscribeTerminalStream('t-1', 0, {
			onFrame: (k, d) => {
				if (k === 'output') {
					texts.push(String(d.text));
					lastOffset = Number(d.nextOffset);
				}
			}
		});
		const es = FakeEventSource.instances[0];
		es.emit('output', { sessionId: 't-1', text: 'fresh', nextOffset: 10 });
		// replay of already-painted bytes (nextOffset <= painted 10): dropped
		es.emit('output', { sessionId: 't-1', text: 'stale', nextOffset: 10 });
		es.emit('output', { sessionId: 't-1', text: 'older', nextOffset: 4 });
		expect(texts).toEqual(['fresh']);
		// painted offset tracked for the resume map
		vi.advanceTimersByTime(300); // no set change — no reopen
		expect(FakeEventSource.instances).toHaveLength(1);
		void lastOffset;
	});

	it('AC4: a re-open (set change) carries the ROWS painted offsets in the resume map', () => {
		const off1 = subscribeTerminalStream('t-1', 0, { onFrame: () => undefined });
		subscribeTerminalStream('t-2', 42, { onFrame: () => undefined });
		vi.advanceTimersByTime(300);
		// rows painted: t-1 to 100, t-2 untouched at its 42
		FakeEventSource.instances[FakeEventSource.instances.length - 1].emit('output', { sessionId: 't-1', text: 'x', nextOffset: 100 });
		// a t-3 JOIN forces the debounced re-open (both painted rows stay subscribed)
		const off3 = subscribeTerminalStream('t-3', 0, { onFrame: () => undefined });
		vi.advanceTimersByTime(300);
		const reopenedUrl = FakeEventSource.instances[FakeEventSource.instances.length - 1].url;
		expect(reopenedUrl).toContain('resume=' + encodeURIComponent(JSON.stringify({ 't-1': 100, 't-2': 42, 't-3': 0 })));
		off1(); off3();
	});

	it('AC2/BC-7: the LAST unsubscribe closes THE source and kills every timer', () => {
		const off1 = subscribeTerminalStream('t-1', 0, { onFrame: () => undefined });
		const off2 = subscribeTerminalStream('t-2', 0, { onFrame: () => undefined });
		vi.advanceTimersByTime(300);
		const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
		off1();
		vi.advanceTimersByTime(300);
		expect(es.closed).toBe(true); // set shrank -> old source replaced by a re-open
		const live = FakeEventSource.instances[FakeEventSource.instances.length - 1];
		off2();
		expect(live.closed).toBe(true);
		expect(FakeEventSource.instances.every((i) => i.closed)).toBe(true);
		// a ladder error after teardown must NOT resurrect the hub
		live.fireError();
		vi.advanceTimersByTime(8000);
		// opens so far: initial + reopen(subs) + reopen(off1) - and NO 4th
		expect(FakeEventSource.instances).toHaveLength(3);
	});

	it('two desks (refcount 2) on one page: hub survives one desk leaving, closes at zero', () => {
		const deskA = subscribeTerminalStream('t-1', 0, { onFrame: () => undefined });
		const deskB = subscribeTerminalStream('t-1', 0, { onFrame: () => undefined });
		expect(FakeEventSource.instances).toHaveLength(1); // same id — no reopen
		deskA();
		expect(FakeEventSource.instances[0].closed).toBe(false); // still one subscriber
		deskB();
		expect(FakeEventSource.instances[0].closed).toBe(true); // BC-7 at 0
	});

	it('AC6: ONE hub ladder — error re-opens after 1s, doubles, caps at 8s; an output resets to 1s', () => {
		subscribeTerminalStream('t-1', 0, { onFrame: () => undefined });
		let es = FakeEventSource.instances[0];
		es.fireError();
		vi.advanceTimersByTime(999);
		expect(FakeEventSource.instances).toHaveLength(1); // not yet
		vi.advanceTimersByTime(1);
		expect(FakeEventSource.instances).toHaveLength(2); // 1s ladder fired
		es = FakeEventSource.instances[1];
		es.fireError();
		vi.advanceTimersByTime(1999);
		expect(FakeEventSource.instances).toHaveLength(2);
		vi.advanceTimersByTime(1); // 2s
		expect(FakeEventSource.instances).toHaveLength(3);
		// successful output resets the ladder to 1s
		FakeEventSource.instances[2].emit('output', { sessionId: 't-1', text: 'ok', nextOffset: 3 });
		FakeEventSource.instances[2].fireError();
		vi.advanceTimersByTime(999);
		expect(FakeEventSource.instances).toHaveLength(3);
		vi.advanceTimersByTime(1);
		expect(FakeEventSource.instances).toHaveLength(4); // reset fired at 1s
		// from here the doubling walks 2s -> 4s -> 8s cap
		FakeEventSource.instances[3].fireError();
		vi.advanceTimersByTime(2000);
		expect(FakeEventSource.instances).toHaveLength(5); // 2s
		FakeEventSource.instances[4].fireError();
		vi.advanceTimersByTime(4000);
		expect(FakeEventSource.instances).toHaveLength(6); // 4s
		FakeEventSource.instances[5].fireError();
		vi.advanceTimersByTime(8000);
		expect(FakeEventSource.instances).toHaveLength(7); // capped at 8s, still firing
		// and it never exceeds the 8s cap
		FakeEventSource.instances[6].fireError();
		vi.advanceTimersByTime(8000);
		expect(FakeEventSource.instances).toHaveLength(8);
	});

	it('rapid join/leave bursts settle into ONE debounced re-open (risk register pin)', () => {
		const offs: Array<() => void> = [];
		offs.push(subscribeTerminalStream('t-1', 0, { onFrame: () => undefined }));
		for (const id of ['t-2', 't-3']) offs.push(subscribeTerminalStream(id, 0, { onFrame: () => undefined }));
		offs[2](); // t-3 leaves before the debounce fires
		offs.pop();
		vi.advanceTimersByTime(300);
		// exactly ONE re-open happened, and t-3 (left during debounce) is not in it
		expect(FakeEventSource.instances).toHaveLength(2);
		expect(FakeEventSource.instances[1].url).not.toContain('t-3');
		// a leaving id that was the LAST subscriber still closes (fire-time set check)
		const solo = subscribeTerminalStream('t-9', 0, { onFrame: () => undefined });
		vi.advanceTimersByTime(300);
		const before = FakeEventSource.instances.length;
		solo();
		vi.advanceTimersByTime(300);
		// t-9 leaving changes the set: exactly one re-open, and it excludes t-9
		expect(FakeEventSource.instances.length).toBe(before + 1);
		expect(FakeEventSource.instances[FakeEventSource.instances.length - 1].url).not.toContain('t-9');
	});

	it('torn/untagged frames are dropped, never dispatched (AC3 guard)', () => {
		const seen: unknown[] = [];
		subscribeTerminalStream('t-1', 0, { onFrame: (k, d) => seen.push([k, d]) });
		const es = FakeEventSource.instances[0];
		es.listeners.get('output')![0]({ data: 'not-json{' });
		es.listeners.get('output')![0](frame('', JSON.stringify({ text: 'no-owner' })));
		expect(seen).toEqual([]);
	});
});
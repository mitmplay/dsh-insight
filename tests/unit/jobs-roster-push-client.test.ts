/**
 * The Job Bridge (ADR-0081 D1, the PUSH stage), Task 2.2-T: the roster
 * push client — ONE refcounted EventSource on /api/dsh/jobs/stream.
 *   - lazy: nothing opens before the first subscriber
 *   - the first subscriber opens exactly one; later ones reuse it
 *   - the last unsubscribe closes it; a later subscriber opens a fresh one
 *   - a message reaches every subscriber as (sessionId, jobs)
 *   - a malformed frame is dropped without throwing (never rendered)
 *   - one throwing subscriber breaks neither its neighbours nor the stream
 *   - D-f (The Job Bridge, Wave 3): with NO EventSource on the platform the
 *     push degrades — nothing registers, nothing opens, nothing throws
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeRosterPush, __resetRosterPushForTests } from '$lib/services/jobs/roster-push-client.svelte';
import type { DsiJobView } from '$lib/types';

/** Same shape as the desk suite's double (terminal-desk-job-tabs.test.ts). */
class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	close(): void {
		this.closed = true;
	}
	/** The server writes one SSE data line. */
	emit(data: string): void {
		this.onmessage?.({ data });
	}
}

const running: DsiJobView = {
	id: 'bash-1',
	kind: 'bash',
	label: 'npm test',
	owner: 'conv-1',
	status: 'running',
	startedAt: 1,
	output: { total: 0, earliest: 0 }
};

const frame = (sessionId: string, jobs: unknown[]): string => JSON.stringify({ sessionId, jobs });
const current = (): FakeEventSource => FakeEventSource.instances[FakeEventSource.instances.length - 1];

beforeEach(() => {
	FakeEventSource.instances = [];
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	__resetRosterPushForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('subscribeRosterPush — one refcounted stream (The Job Bridge 2.2-T)', () => {
	it('opens nothing before the first subscriber (lazy)', () => {
		expect(FakeEventSource.instances).toHaveLength(0);
	});

	it('the first subscriber opens exactly one EventSource on /api/dsh/jobs/stream', () => {
		subscribeRosterPush(() => {});
		expect(FakeEventSource.instances).toHaveLength(1);
		expect(current().url).toBe('/api/dsh/jobs/stream');
		expect(current().closed).toBe(false);
	});

	it('a second (and third) subscriber REUSES the one stream', () => {
		const offA = subscribeRosterPush(() => {});
		subscribeRosterPush(() => {});
		subscribeRosterPush(() => {});
		expect(FakeEventSource.instances).toHaveLength(1);
		offA();
		expect(FakeEventSource.instances).toHaveLength(1); // two still listening
		expect(current().closed).toBe(false);
	});

	it('the LAST unsubscribe closes the stream', () => {
		const offA = subscribeRosterPush(() => {});
		const offB = subscribeRosterPush(() => {});
		offA();
		expect(current().closed).toBe(false);
		offB();
		expect(current().closed).toBe(true);
	});

	it('re-opens: after the last unsubscribe, a new subscriber gets a FRESH stream', () => {
		const off = subscribeRosterPush(() => {});
		off();
		expect(FakeEventSource.instances).toHaveLength(1);
		off(); // idempotent — a second call closes nothing twice
		expect(FakeEventSource.instances).toHaveLength(1);
		const heard: string[] = [];
		subscribeRosterPush((sessionId) => heard.push(sessionId));
		expect(FakeEventSource.instances).toHaveLength(2);
		expect(current().closed).toBe(false);
		current().emit(frame('s9', []));
		expect(heard).toEqual(['s9']);
		// the OLD stream is superseded: even if a frame queued on it fires
		// after the re-open, the client ignores it (a stale source is inert)
		FakeEventSource.instances[0].emit(frame('old', []));
		expect(heard).toEqual(['s9']);
	});

	it('subscribing the same listener twice counts once', () => {
		const heard: string[] = [];
		const listener = (sessionId: string): void => {
				heard.push(sessionId);
		};
		const off1 = subscribeRosterPush(listener);
		const off2 = subscribeRosterPush(listener);
		current().emit(frame('s1', []));
		expect(heard).toEqual(['s1']);
		off1();
		expect(current().closed).toBe(true); // one registration, one release
		off2();
	});

	it('a message reaches BOTH subscribers as (sessionId, jobs), verbatim', () => {
		const a: Array<[string, DsiJobView[]]> = [];
		const b: Array<[string, DsiJobView[]]> = [];
		subscribeRosterPush((s, j) => a.push([s, j]));
		subscribeRosterPush((s, j) => b.push([s, j]));
		current().emit(frame('conv-1', [running]));
		expect(a).toEqual([['conv-1', [running]]]);
		expect(b).toEqual([['conv-1', [running]]]);
	});

	it('a malformed frame is dropped without throwing — never rendered', () => {
		const heard: unknown[] = [];
		subscribeRosterPush((sessionId, jobs) => {
			heard.push([sessionId, jobs]);
		});
		const es = current();
		const malformed = [
			'not json',
			'',
			'null',
			'42',
			'"text"',
			'[]',
			'{}',
			JSON.stringify({ sessionId: 's' }), // no jobs
			JSON.stringify({ jobs: [] }), // no sessionId
			JSON.stringify({ sessionId: 7, jobs: [] }), // non-string id
			JSON.stringify({ sessionId: 's', jobs: {} }), // jobs not an array
			JSON.stringify({ sessionId: 's', jobs: null })
		];
		for (const bad of malformed) {
			expect(() => es.emit(bad)).not.toThrow();
		}
		expect(heard).toEqual([]);
		// the stream is still alive and still delivers a good frame afterwards
		es.emit(frame('s', []));
		expect(heard).toEqual([['s', []]]);
	});

	it('entries inside jobs that are not objects are dropped; real jobs pass through', () => {
		const heard: DsiJobView[][] = [];
		subscribeRosterPush((_s, jobs) => heard.push(jobs));
		current().emit(JSON.stringify({ sessionId: 'conv-1', jobs: [running, null, 'x', 3, { ...running, id: 'bash-2' }] }));
		expect(heard).toHaveLength(1);
		expect(heard[0].map((j) => j.id)).toEqual(['bash-1', 'bash-2']);
		// verbatim: the first job object is byte-for-byte what the route sent
		expect(heard[0][0]).toEqual(running);
	});

	it('one throwing subscriber breaks neither its neighbours nor the stream', () => {
		const heard: string[] = [];
		subscribeRosterPush(() => {
			throw new Error('desk blew up');
		});
		subscribeRosterPush((sessionId) => heard.push(sessionId));
		const es = current();
		expect(() => es.emit(frame('s1', []))).not.toThrow();
		es.emit(frame('s2', []));
		expect(heard).toEqual(['s1', 's2']);
		expect(es.closed).toBe(false);
	});

	it('a listener that unsubscribes mid-frame is not re-visited; a new one waits for the next frame', () => {
		const order: string[] = [];
		let offSelf: (() => void) | null = null;
		offSelf = subscribeRosterPush(() => {
			order.push('self');
			offSelf?.();
		});
		subscribeRosterPush((s) => order.push('neighbour:' + s));
		current().emit(frame('a', []));
		expect(order).toEqual(['self', 'neighbour:a']);
		expect(current().closed).toBe(false); // one listener remains
		current().emit(frame('b', []));
		expect(order).toEqual(['self', 'neighbour:a', 'neighbour:b']);
	});
});

describe('subscribeRosterPush — no platform push (The Job Bridge, Wave 3 D-f)', () => {
	it('with NO EventSource on the platform: nothing registers, nothing opens, it never throws, and the unsubscribe is callable', () => {
		// the browser API is simply absent (a unit environment, an old engine):
		// the global exists as a property but is undefined — `typeof` reads 'undefined'
		vi.stubGlobal('EventSource', undefined);
		let heard = 0;
		let off: (() => void) | null = null;
		expect(() => {
			off = subscribeRosterPush(() => {
				heard += 1;
			});
		}).not.toThrow();
		expect(FakeEventSource.instances).toHaveLength(0); // opened nothing
		expect(typeof off).toBe('function');
		expect(() => off!()).not.toThrow(); // the no-op unsubscribe is callable
		expect(heard).toBe(0);
		// and it registered nothing: the NEXT subscribe (platform restored) is the first
		vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
		const seen: string[] = [];
		subscribeRosterPush((sessionId) => seen.push(sessionId));
		expect(FakeEventSource.instances).toHaveLength(1); // a fresh stream — no listener was parked
		current().emit(frame('s1', []));
		expect(seen).toEqual(['s1']);
	});
});

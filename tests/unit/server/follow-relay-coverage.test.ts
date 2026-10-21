/**
 * follow-relay coverage tests: owners()/jobsOf() mux queries, error/frame
 * paths without live sinks, and normalizeFrame/decodeChunks edge branches
 * not exercised by job-follow-relay.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { JobFollowRelay, normalizeFrame } from '../../../src/lib/server/jobs/follow-relay';
import type { FollowTransport } from '../../../src/lib/server/jobs/follow-relay';

function makeTransport(): FollowTransport {
	return { open: () => {}, close: () => {} };
}

describe('JobFollowRelay mux queries', () => {
	it('owners() dedupes across multiple jobs of one owner', () => {
		const relay = new JobFollowRelay(makeTransport());
		relay.subscribe('s1', 'j1', vi.fn());
		relay.subscribe('s1', 'j2', vi.fn());
		relay.subscribe('s2', 'j3', vi.fn());
		expect(relay.owners().sort()).toEqual(['s1', 's2']);
	});

	it('owners() drops an owner after its last unwatch', () => {
		const relay = new JobFollowRelay(makeTransport());
		const un = relay.subscribe('s1', 'j1', vi.fn());
		expect(relay.owners()).toEqual(['s1']);
		un();
		expect(relay.owners()).toEqual([]);
	});

	it("jobsOf() returns only that owner's job ids, unprefixed", () => {
		const relay = new JobFollowRelay(makeTransport());
		relay.subscribe('s1', 'j1', vi.fn());
		relay.subscribe('s1', 'j2', vi.fn());
		relay.subscribe('s2', 'j3', vi.fn());
		expect(relay.jobsOf('s1').sort()).toEqual(['j1', 'j2']);
		expect(relay.jobsOf('s2')).toEqual(['j3']);
		expect(relay.jobsOf('sX')).toEqual([]);
	});

	it('jobsOf() drops the entry after the last unwatch', () => {
		const relay = new JobFollowRelay(makeTransport());
		const un = relay.subscribe('s1', 'j1', vi.fn());
		un();
		expect(relay.jobsOf('s1')).toEqual([]);
	});
});

describe('JobFollowRelay no-sink paths', () => {
	it('onFrame is a no-op for a key that was never subscribed', () => {
		const relay = new JobFollowRelay(makeTransport());
		expect(() => relay.onFrame('s1', 'ghost', { type: 'output', chunks: ['x'] })).not.toThrow();
	});

	it('onError is a no-op for a key that was never subscribed', () => {
		const relay = new JobFollowRelay(makeTransport());
		expect(() => relay.onError('s1', 'ghost', 'code', 'msg')).not.toThrow();
	});

	it('unwatch is idempotent — the second call exits early', () => {
		const t: FollowTransport & { closed: string[] } = {
			open: () => {},
			close: (_o, j) => t.closed.push(j),
			closed: []
		};
		const relay = new JobFollowRelay(t);
		const un = relay.subscribe('s1', 'j1', vi.fn());
		un();
		un(); // entry already evicted
		expect(t.closed).toEqual(['j1']);
	});
});

describe('normalizeFrame edge branches', () => {
	it('coerces status frames with job projection and default from', () => {
		const job = { id: 'j1', state: 'running' };
		expect(normalizeFrame({ type: 'status', job })).toEqual({ type: 'status', job, from: 0 });
		expect(normalizeFrame({ type: 'status', job, from: 7 })).toEqual({ type: 'status', job, from: 7 });
	});

	it('rejects status/opened frames whose job is not an object', () => {
		expect(normalizeFrame({ type: 'status', job: 'nope' })).toBeNull();
		expect(normalizeFrame({ type: 'opened', job: 42 })).toBeNull();
		expect(normalizeFrame({ type: 'status', job: null })).toBeNull();
	});

	it('rejects non-object values and non-number from', () => {
		expect(normalizeFrame(undefined)).toBeNull();
		expect(normalizeFrame(7)).toBeNull();
		expect(normalizeFrame('str')).toBeNull();
		// non-numeric from coerces to the default 0
		expect(normalizeFrame({ type: 'opened', job: {}, from: 'x' })).toMatchObject({ from: 0 });
	});

	it('output frames default next to 0 and drop absent lossy', () => {
		expect(normalizeFrame({ type: 'output', chunks: ['hi'] })).toEqual({ type: 'output', text: 'hi', next: 0 });
		const e = normalizeFrame({ type: 'output', chunks: [], next: 'nope', lossy: false });
		expect(e).toEqual({ type: 'output', text: '', next: 0 });
	});

	it('decodeChunks: non-array chunks yield empty text', () => {
		expect(normalizeFrame({ type: 'output', chunks: 'nope', next: 1 })).toEqual({
			type: 'output',
			text: '',
			next: 1
		});
	});

	it('decodeChunks: skips null/primitive/object chunks without text or data', () => {
		const e = normalizeFrame({
			type: 'output',
			chunks: [null, 42, true, {}, { other: 1 }, 'keep', { text: 'me' }, { data: 'too' }],
			next: 0
		});
		expect(e).toEqual({ type: 'output', text: 'keepmetoo', next: 0 });
	});
});

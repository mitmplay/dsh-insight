/**
 * follow-relay unit tests (ADR-0035 D4): refcount subscribe/unwatch,
 * frame fan-out, honest error passthrough, wire coercion.
 */
import { describe, expect, it, vi } from 'vitest';
import { JobFollowRelay, normalizeFrame } from '../../src/lib/server/jobs/follow-relay';
import type { FollowTransport } from '../../src/lib/server/jobs/follow-relay';

function makeTransport() {
	const opened: string[] = [];
	const closed: string[] = [];
	const t: FollowTransport & { opened: string[]; closed: string[] } = {
		open: (owner, jobId) => opened.push(owner + '|' + jobId),
		close: (owner, jobId) => closed.push(owner + '|' + jobId),
		opened,
		closed
	};
	return t;
}

describe('JobFollowRelay', () => {
	it('opens the host stream once for two subscribers and closes on last unwatch', () => {
		const t = makeTransport();
		const relay = new JobFollowRelay(t);
		const a = vi.fn();
		const b = vi.fn();
		const unA = relay.subscribe('s1', 'j1', a);
		const unB = relay.subscribe('s1', 'j1', b);
		expect(t.opened).toEqual(['s1|j1']);
		relay.onFrame('s1', 'j1', { type: 'output', chunks: [{ text: 'hi' }], next: 2 });
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		unA();
		expect(t.closed).toEqual([]); // b still holds a ref
		unB();
		expect(t.closed).toEqual(['s1|j1']);
	});

	it('passes stream errors to sinks and does not auto-close', () => {
		const t = makeTransport();
		const relay = new JobFollowRelay(t);
		const sink = vi.fn();
		relay.subscribe('s1', 'j1', sink);
		relay.onError('s1', 'j1', 'boom-code', 'boom');
		expect(sink).toHaveBeenCalledWith({ type: 'error', code: 'boom-code', message: 'boom' });
		expect(t.closed).toEqual([]);
	});

	it('unowned jobs subscribe with an empty owner key', () => {
		const t = makeTransport();
		const relay = new JobFollowRelay(t);
		const un = relay.subscribe('', 'j9', vi.fn());
		expect(t.opened).toEqual(['|j9']);
		expect(relay.owners()).toEqual(['']);
		un();
		expect(t.closed).toEqual(['|j9']);
	});

	it('drops frames for evicted subscriptions', () => {
		const relay = new JobFollowRelay(makeTransport());
		const sink = vi.fn();
		const un = relay.subscribe('s1', 'j1', sink);
		un();
		relay.onFrame('s1', 'j1', { type: 'output', chunks: [], next: 0 });
		expect(sink).not.toHaveBeenCalled();
	});
});

describe('normalizeFrame', () => {
	it('coerces opened frames with their resume offset', () => {
		const job = { id: 'j1' };
		const e = normalizeFrame({ type: 'opened', job, from: 5 });
		expect(e).toMatchObject({ type: 'opened', from: 5 });
	});

	it('decodes chunk text and keeps lossy honest', () => {
		const e = normalizeFrame({ type: 'output', chunks: [{ text: 'a' }, 'b', { data: 'c' }], next: 3, lossy: true });
		expect(e).toEqual({ type: 'output', text: 'abc', next: 3, lossy: true });
	});

	it('rejects junk', () => {
		expect(normalizeFrame(null)).toBeNull();
		expect(normalizeFrame({ type: 'nope' })).toBeNull();
		expect(normalizeFrame({ type: 'opened' })).toBeNull(); // no job projection
	});
});

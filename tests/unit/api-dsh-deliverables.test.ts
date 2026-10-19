/**
 * api-dsh deliverables lane tests (ADR-0027f D1, task 2.2-T): the three
 * payload paths — poll delta, full=1 resync — ship the derived inventory
 * from RAW events (the entries lane drops the silent type). Cold-load
 * coverage rides the page-server suite's shape; here the endpoint is the
 * subject.
 *
 * Fake-connection pattern: api-dsh.test.ts (same monkey-patched getter).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let fake: Record<string, unknown>;

async function importEventsFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	return (await import('../../src/routes/api/dsh/session/[sessionId]/events/+server')).GET;
}

function mkEvent(url: URL): never {
	return { setHeaders: () => {}, params: { sessionId: 's1' }, url } as never;
}

const PRESENTED = {
	type: 'deliverables/presented',
	seq: 11,
	time: 5,
	data: { turn: 2, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] }
};

beforeEach(() => {
	fake = {
		ensureDownlinks: () => {},
		subscribe: () => {},
		pendingFor: () => [],
		settlementsFor: () => [],
		pruneSettlements: () => {},
		projectionValue: () => undefined,
		liveAssistantStream: () => null,
		isRunning: () => false,
		eventsSince: () => ({ events: [], lastSeq: -1, running: false })
	};
});

describe('events endpoint deliverables lane', () => {
	it('delta path: the raw lane ships deliverables even though the type renders no entry', async () => {
		// ADR-0027f D4: the type is a silent hand-off — the entries lane
		// carries nothing; the field is derived pre-mapper and rides alone.
		fake.eventsSince = () => ({ events: [PRESENTED], lastSeq: 11, running: false });
		const GET = await importEventsFresh();
		const res = await GET(mkEvent(new URL('http://dsi/events?since=10')));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			entries: Array<{ kind: string; eventType?: string }>;
			deliverables?: unknown[];
		};
		expect(body.entries).toEqual([]);
		expect(body.deliverables).toEqual([
			{ turn: 2, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] }
		]);
	});

	it('delta path: no deliverables events → field omitted (not an empty array)', async () => {
		fake.eventsSince = () => ({
			events: [{ type: 'user/message', seq: 3, time: 1, data: { id: 'u1' } }],
			lastSeq: 3,
			running: false
		});
		const GET = await importEventsFresh();
		const res = await GET(mkEvent(new URL('http://dsi/events?since=2')));
		const body = (await res.json()) as { deliverables?: unknown };
		expect(body.deliverables).toBeUndefined();
	});

	it('resync path (full=1): the whole inventory rides the ledger tail', async () => {
		fake.history = () => ({
			events: [
				{ event: PRESENTED },
				{
					event: {
						type: 'deliverables/presented',
						seq: 12,
						time: 6,
						data: { turn: 3, callId: 'c2', files: [{ path: '/tmp/chart.png' }] }
					}
				}
			],
			hasMore: false
		});
		const GET = await importEventsFresh();
		const res = await GET(mkEvent(new URL('http://dsi/events?since=-1&full=1')));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deliverables?: Array<{ callId: string }> };
		expect(body.deliverables?.map((d) => d.callId)).toEqual(['c1', 'c2']);
	});

	it('junk deliverables payloads are skipped by the lane (reducer rule)', async () => {
		fake.eventsSince = () => ({
			events: [
				{ type: 'deliverables/presented', seq: 5, time: 1, data: { turn: 1, callId: 'x', files: 'no' } },
				PRESENTED
			],
			lastSeq: 11,
			running: false
		});
		const GET = await importEventsFresh();
		const res = await GET(mkEvent(new URL('http://dsi/events?since=4')));
		const body = (await res.json()) as { deliverables?: Array<{ callId: string }> };
		expect(body.deliverables?.map((d) => d.callId)).toEqual(['c1']);
	});
});

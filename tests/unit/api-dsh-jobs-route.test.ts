import { describe, expect, it } from 'vitest';

import { GET, POST } from '../../src/routes/api/dsh/jobs/+server.js';
import { getDshConnection, resetDshConnectionForTests } from '$lib/server/dsh-connection';

/**
 * Route contract (Tasks 1.2-T): GET serves the mirror with an honest
 * pending flag; POST kill passthrough keeps its shape.
 */

function makeUrl(sessionId: string | null): URL {
	const u = new URL('http://localhost/api/dsh/jobs');
	if (sessionId !== null) u.searchParams.set('sessionId', sessionId);
	return u;
}

/** ADR-0032 D1/D5 — batch form helpers. */
function makeBatchUrl(sessionIds: string): URL {
	const u = new URL('http://localhost/api/dsh/jobs');
	u.searchParams.set('sessionIds', sessionIds);
	return u;
}

function wireRelay(): ReturnType<typeof getDshConnection>['relay'] {
	resetDshConnectionForTests();
	const relay = getDshConnection().relay;
	relay.jobRosterGraceMs = 60_000;
	relay.wireJobRosterTransport({ open: () => {}, close: () => {} });
	return relay;
}

describe('GET /api/dsh/jobs — the roster mirror', () => {
	it('400s without a sessionId', async () => {
		const res = await GET({ url: makeUrl(null) } as never);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.ok).toBe(false);
	});

	it('answers pending before the first frame and the frame after', async () => {
		resetDshConnectionForTests();
		const relay = getDshConnection().relay;
		relay.jobRosterGraceMs = 60_000;
		const opened: string[] = [];
		relay.wireJobRosterTransport({ open: (s) => opened.push(s), close: () => {} });
		const pending = await GET({ url: makeUrl('session-a') } as never);
		const pendingBody = await pending.json();
		expect(pendingBody).toMatchObject({ ok: true, sessionId: 'session-a', jobs: [], pending: true });
		expect(opened).toContain('session-a');
		relay.onJobRosterItem('session-a', { jobs: [{ id: 'bash-9', status: 'running' }] });
		const filled = await GET({ url: makeUrl('session-a') } as never);
		const filledBody = await filled.json();
		expect(filledBody).toEqual({ ok: true, sessionId: 'session-a', jobs: [{ id: 'bash-9', status: 'running' }] });
		expect('pending' in filledBody).toBe(false);
		resetDshConnectionForTests();
	});
});

describe('GET /api/dsh/jobs?sessionIds — the batch tick (ADR-0032)', () => {
	it('answers one envelope of rosters, touching each session', async () => {
		const relay = wireRelay();
		relay.onJobRosterItem('session-a', { jobs: [{ id: 'bash-1', status: 'running' }] });
		relay.onJobRosterItem('session-b', { jobs: [] });
		const res = await GET({ url: makeBatchUrl('session-a,session-b,session-c') } as never);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.rosters['session-a']).toEqual({ jobs: [{ id: 'bash-1', status: 'running' }] });
		expect(body.rosters['session-b']).toEqual({ jobs: [] });
		// honest pending for a session with no frame yet (Mirror D3)
		expect(body.rosters['session-c']).toEqual({ jobs: [], pending: true });
		resetDshConnectionForTests();
	});

	it('dedupes ids and 400s on empty or over-limit batches', async () => {
		const over = Array.from({ length: 51 }, (_, i) => 's' + i).join(','); // 51 unique ids
		const tooBig = await GET({ url: makeBatchUrl(over) } as never);
		expect(tooBig.status).toBe(400);
		const empty = await GET({ url: makeBatchUrl(' ,, ') } as never);
		expect(empty.status).toBe(400);
		const dupes = wireRelay();
		const ok = await GET({ url: makeBatchUrl('s1,s1,s1') } as never);
		expect(ok.status).toBe(200);
		const body = await ok.json();
		expect(Object.keys(body.rosters)).toEqual(['s1']);
		resetDshConnectionForTests();
	});

	it('a per-session relay failure degrades to pending, not a 500', async () => {
		const relay = wireRelay();
		relay.onJobRosterItem('good', { jobs: [{ id: 'j1', status: 'running' }] });
		const original = relay.jobRosterSnapshot.bind(relay);
		relay.jobRosterSnapshot = (id: string) => {
			if (id === 'poison') throw new Error('boom');
			return original(id);
		};
		const res = await GET({ url: makeBatchUrl('good,poison') } as never);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.rosters['good'].jobs).toEqual([{ id: 'j1', status: 'running' }]);
		expect(body.rosters['poison']).toEqual({ jobs: [], pending: true });
		relay.jobRosterSnapshot = original;
		resetDshConnectionForTests();
	});

	it('the singular sessionId response is byte-identical to its pre-batch shape (D5)', async () => {
		const relay = wireRelay();
		relay.onJobRosterItem('session-a', { jobs: [{ id: 'bash-9', status: 'running' }] });
		const res = await GET({ url: makeUrl('session-a') } as never);
		const body = await res.json();
		expect(body).toEqual({ ok: true, sessionId: 'session-a', jobs: [{ id: 'bash-9', status: 'running' }] });
		resetDshConnectionForTests();
	});
});

describe('POST /api/dsh/jobs — kill passthrough shape', () => {
	it('400s without jobId', async () => {
		const res = await POST({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ sessionId: 's' }) }) } as never);
		expect(res.status).toBe(400);
	});
});

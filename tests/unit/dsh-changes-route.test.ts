/**
 * changes-route tests (task 2.2-T, spec "2026-09-25 - Edited-Files Card") —
 * the route-level contract (ADR The Edited-Files Card D2, Transport Probe arm B):
 *   - happy path forwards the validated ChangesSummary as {ok:true, summary};
 *   - bad/missing params → 400 bad-params BEFORE any host call;
 *   - Host 404 (Session disposed / never recorded) → 410 unavailable — the
 *     card's degraded-strip signal;
 *   - Host transport throw, non-OK status, invalid JSON, or a failing shape
 *     → 502 upstream.
 *
 * Handlers invoked directly with node-env Request objects; the connection is
 * mocked (the established goal-route.test.ts pattern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchHostPathSpy = vi.fn();

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ fetchHostPath: fetchHostPathSpy })
}));

import { GET } from '../../src/routes/api/dsh/session/[sessionId]/changes/+server';

const SUMMARY = {
	turn: 7,
	files: [
		{ path: 'src/a.ts', display: 'src/a.ts', added: 12, deleted: 3 },
		{ path: 'bin/data.db', display: 'bin/data.db', added: 0, deleted: 0, binary: true }
	],
	total: 2,
	added: 12,
	deleted: 3
};

function get(query = 'seq=41&turn=7'): Promise<Response> {
	return GET({
		params: { sessionId: 'session-1' },
		url: new URL(`http://localhost/api/dsh/session/session-1/changes?${query}`)
	} as never) as Promise<Response>;
}

beforeEach(() => {
	fetchHostPathSpy.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});


	function armDiffInvalidSummary(body: unknown) {
		fetchHostPathSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
		return get('seq=41&turn=7');
	}

describe('GET /api/dsh/session/[sessionId]/changes (task 2.2-T)', () => {
	it('forwards the validated summary as {ok:true, summary} and calls the host path with seq', async () => {
		fetchHostPathSpy.mockResolvedValueOnce(new Response(JSON.stringify(SUMMARY), { status: 200 }));
		const res = await get();
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; summary: unknown };
		expect(body.ok).toBe(true);
		expect(body.summary).toEqual(SUMMARY);
		expect(fetchHostPathSpy).toHaveBeenCalledWith('/api/changes.summary?sessionId=session-1&seq=41');
	});

	it('rejects missing/invalid params with 400 before any host call', async () => {
		await expect(get('turn=7')).resolves.toMatchObject({ status: 400 });
		await expect(get('seq=0&turn=7')).resolves.toMatchObject({ status: 400 });
		await expect(get('seq=abc&turn=7')).resolves.toMatchObject({ status: 400 });
		expect(fetchHostPathSpy).not.toHaveBeenCalled();
	});

	it('maps Host 404 (Session disposed) to 410 unavailable', async () => {
		fetchHostPathSpy.mockResolvedValueOnce(new Response('not found', { status: 404 }));
		const res = await get();
		expect(res.status).toBe(410);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unavailable');
	});

	it('maps transport throw, non-OK status, invalid JSON, and bad shape to 502 upstream', async () => {
		fetchHostPathSpy.mockRejectedValueOnce(new Error('boom'));
		await expect(get()).resolves.toMatchObject({ status: 502 });

		fetchHostPathSpy.mockResolvedValueOnce(new Response('gateway exploded', { status: 500 }));
		await expect(get()).resolves.toMatchObject({ status: 502 });

		fetchHostPathSpy.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
		await expect(get()).resolves.toMatchObject({ status: 502 });

		fetchHostPathSpy.mockResolvedValueOnce(
			new Response(JSON.stringify({ turn: 7, files: 'not-an-array', total: 0, added: 0, deleted: 0 }), { status: 200 })
		);
		await expect(get()).resolves.toMatchObject({ status: 502 });
	});


	it('rejects a bad index param with 400 before any host call', async () => {
		await expect(get('seq=41&turn=7&index=abc')).resolves.toMatchObject({ status: 400 });
		await expect(get('seq=41&turn=7&index=-1')).resolves.toMatchObject({ status: 400 });
		await expect(get('seq=41&turn=7&index=1.5')).resolves.toMatchObject({ status: 400 });
		expect(fetchHostPathSpy).not.toHaveBeenCalled();
		const bad = await get('seq=41&turn=7&index=abc');
		expect(((await bad.json()) as { error: { code: string; message: string } }).error).toMatchObject({
			code: 'bad-params',
			message: 'index must be a non-negative integer'
		});
	});

	function armDiff(body: unknown) {
		fetchHostPathSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
		return get('seq=41&turn=7&index=0');
	}

	it('diff arm: forwards to changes.diff and passes a valid diff through on the discriminant', async () => {
		const textDiff = { kind: 'text', path: 'src/a.ts', hunks: [] };
		const res = await armDiff(textDiff);
		expect(res.status).toBe(200);
		expect(fetchHostPathSpy).toHaveBeenCalledWith('/api/changes.diff?sessionId=session-1&seq=41&index=0');
		expect(((await res.json()) as { ok: boolean; diff: unknown }).diff).toEqual(textDiff);

		await expect(armDiff({ kind: 'binary', path: 'bin/data.db' })).resolves.toMatchObject({ status: 200 });
		await expect(armDiff({ kind: 'oversized', path: 'big.bin' })).resolves.toMatchObject({ status: 200 });
	});

	it('diff arm: refuses a non-record body or unknown kind with 502 upstream', async () => {
		await expect(armDiff([1, 2])).resolves.toMatchObject({ status: 502 });
		await expect(armDiff({ kind: 'symlink', path: 'x' })).resolves.toMatchObject({ status: 502 });
		const bad = await armDiff({ kind: 'symlink', path: 'x' });
		expect(((await bad.json()) as { error: { code: string; message: string } }).error).toMatchObject({
			code: 'upstream',
			message: 'changes diff failed validation'
		});
	});
	it('refuses a summary with a bad top-level count with 502 upstream', async () => {
		await expect(
			armDiffInvalidSummary({ turn: 7, files: [], total: -1, added: 0, deleted: 0 })
		).resolves.toMatchObject({ status: 502 });
	});
	it('refuses a non-record body with 502 upstream (validation face)', async () => {
		await expect(armDiffInvalidSummary(null)).resolves.toMatchObject({ status: 502 });
		await expect(armDiffInvalidSummary([SUMMARY])).resolves.toMatchObject({ status: 502 });
		await expect(armDiffInvalidSummary('nope')).resolves.toMatchObject({ status: 502 });
	});

	it.each([
		['file is not a record', [{ turn: 7, files: ['x'], total: 1, added: 0, deleted: 0 }]],
		['file path missing', [{ turn: 7, files: [{ display: 'd', added: 0, deleted: 0 }], total: 1, added: 0, deleted: 0 }]],
		['file path empty', [{ turn: 7, files: [{ path: '', display: 'd', added: 0, deleted: 0 }], total: 1, added: 0, deleted: 0 }]],
		['file display not a string', [{ turn: 7, files: [{ path: 'p', display: 3, added: 0, deleted: 0 }], total: 1, added: 0, deleted: 0 }]],
		['file added not a safe integer', [{ turn: 7, files: [{ path: 'p', display: 'd', added: 1.5, deleted: 0 }], total: 1, added: 0, deleted: 0 }]],
		['file deleted negative', [{ turn: 7, files: [{ path: 'p', display: 'd', added: 0, deleted: -1 }], total: 1, added: 0, deleted: 0 }]],
		['file binary not true', [{ turn: 7, files: [{ path: 'p', display: 'd', added: 0, deleted: 0, binary: false }], total: 1, added: 0, deleted: 0 }]],
		['file oversized not true', [{ turn: 7, files: [{ path: 'p', display: 'd', added: 0, deleted: 0, oversized: 'yes' }], total: 1, added: 0, deleted: 0 }]],
		['turn not a safe integer', [{ turn: 1.5, files: [], total: 0, added: 0, deleted: 0 }]],
		['added missing', [{ turn: 1, files: [], total: 0, deleted: 0 }]]
	])('refuses a summary with %s with 502 upstream', async (_name, body) => {
		await expect(armDiffInvalidSummary(body)).resolves.toMatchObject({ status: 502 });
	});

	it('accepts binary/oversized markers and the zero-counts face', async () => {
		fetchHostPathSpy.mockResolvedValueOnce(new Response(JSON.stringify(SUMMARY), { status: 200 }));
		const res = await get('seq=9&turn=1');
		expect(res.status).toBe(200);
		expect(((await res.json()) as { summary: { files: unknown[] } }).summary.files[1]).toMatchObject({ binary: true });
	});
});
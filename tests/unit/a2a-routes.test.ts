/**
 * a2a-routes tests (Task 3.2-T) — the read/registration API contracts:
 * register inserts + returns id (minted when absent, honored when
 * present), recent list shape + from-filter, 404 on unknown id, invalid
 * body 400. Handlers invoked directly with node-env Request objects.
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (Tasks 3.2/3.2-T).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetA2aDbCache, A2A_DB_ENV, getRow, insertWaiting, listRecent } from '$lib/server/a2a/db.js';
import { __resetWatcherForTests, isTicking } from '$lib/server/a2a/watcher.js';
// Seq-watermark capture (2026-08-25 fix): the register route reads the
// target ledger tail through getDshConnection — mocked here so route tests
// never touch a live host. historyImpl is per-case; watermark>=0 cases
// never call it (the route only reads when watermark<0).
const historySpy = vi.fn();
vi.mock('$lib/server/dsh-connection.js', () => ({
	getDshConnection: () => ({ history: historySpy })
}));
// Route handlers via relative import — the established api-dsh.test.ts
// pattern ($lib aliases only cover src/lib).
import { GET as listRoute } from '../../src/routes/api/a2a/+server';
import { GET as oneRoute } from '../../src/routes/api/a2a/[id]/+server';
import { POST as registerRoute } from '../../src/routes/api/a2a/register/+server';

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-a2a-routes-'));
	process.env[A2A_DB_ENV] = join(tmpRoot, 'a2a.sqlite');
	__resetA2aDbCache();
	__resetWatcherForTests();
	historySpy.mockReset();
});

afterAll(() => {
	delete process.env[A2A_DB_ENV];
	__resetA2aDbCache();
	__resetWatcherForTests();
});

const BASE = 'http://localhost';

/** Minimal RequestEvent double — routes read only these members
 * (the established api-dsh.test.ts mkEvent pattern). */
function mkEvent(e: Record<string, unknown>): never {
	return { setHeaders: () => {}, ...e } as never;
}

describe('POST /api/a2a/register (Task 3.2-T)', () => {
	it('inserts a waiting row and returns the minted id', async () => {
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'run tests and report',
					watermark: 3
				})
			})
		}));;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; id: string };
		expect(body.ok).toBe(true);
		expect(body.id).toMatch(/^a2a-[0-9a-f]{16}$/);
		const row = getRow(body.id);
		expect(row?.state).toBe('waiting');
		expect(row?.fromSession).toBe('session-sender');
		expect(row?.toSession).toBe('session-target');
		expect(row?.watermarkTurn).toBe(3);
	});

	it('honors a sender-supplied id verbatim', async () => {
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'hello',
					watermark: 0,
					id: 'a2a-user01'
				})
			})
		}));;
		const body = (await res.json()) as { ok: boolean; id: string };
		expect(body.id).toBe('a2a-user01');
		expect(getRow('a2a-user01')?.state).toBe('waiting');
	});

	it('seq watermark capture — watermark<0 reads the target ledger tail (2026-08-25 fix)', async () => {
		historySpy.mockResolvedValue({
			events: [
				{ event: { type: 'user/message', seq: 80, time: 1, data: {} } },
				{ event: { type: 'assistant/message', seq: 81, time: 2, data: {} } }
			],
			hasMore: false
		});
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'run tests',
					watermark: -1,
					id: 'a2a-seqcap'
				})
			})
		}));
		expect(res.status).toBe(200);
		expect(historySpy).toHaveBeenCalledTimes(1);
		expect(historySpy).toHaveBeenCalledWith('session-target');
		const row = getRow('a2a-seqcap');
		expect(row?.watermarkTurn).toBe(-1);
		expect(row?.watermarkSeq).toBe(81); // tail's newest event seq
	});

	it('seq watermark capture — history failure leaves NULL, row still born waiting', async () => {
		historySpy.mockRejectedValue(new Error('host down'));
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'run tests',
					watermark: -1,
					id: 'a2a-seqfail'
				})
			})
		}));
		expect(res.status).toBe(200);
		const row = getRow('a2a-seqfail');
		expect(row?.state).toBe('waiting');
		expect(row?.watermarkSeq).toBeNull();
	});

	it('watermark>=0 never reads history (turns lane rows are cheap)', async () => {
		await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'hello',
					watermark: 3,
					id: 'a2a-turnsrow'
				})
			})
		}));
		expect(historySpy).not.toHaveBeenCalled();
		expect(getRow('a2a-turnsrow')?.watermarkSeq).toBeNull();
	});

	it('400 on missing fields', async () => {
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ from: 'session-sender' })
			})
		}));;
		expect(res.status).toBe(400);
	});

	it('400 on non-integer watermark', async () => {
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'x',
					watermark: 1.5
				})
			})
		}));;
		expect(res.status).toBe(400);
	});

	it('400 on non-JSON body', async () => {
		const res = await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'not json'
			})
		}));;
		expect(res.status).toBe(400);
	});
});

describe('GET /api/a2a (Task 3.2-T)', () => {
	it('re-arms a dead watcher — any read revives the ticker (RCA risk 2)', async () => {
		// Waiting row exists, but no register ran in THIS process state
		// (simulates a dev-server restart mid-watch): the GET's idempotent
		// ensureStarted() must arm the ticker.
		insertWaiting({
			id: 'a2a-rearm00000000000',
			fromSession: 'session-sender',
			toSession: 'session-target',
			message: 'revive',
			watermarkTurn: 0,
			sentAt: Date.now() - 1_000
		});
		expect(isTicking()).toBe(false); // dead — nothing started it yet
		const res = await listRoute(mkEvent({ url: new URL(`${BASE}/api/a2a`) }));;
		expect(res.status).toBe(200);
		expect(isTicking()).toBe(true); // revived within one chip cadence
	});

	it('returns recent rows newest-first with the full row shape', async () => {
		const now = Date.now();
		for (let i = 0; i < 3; i++) {
			await registerRoute(mkEvent({
				request: new Request(`${BASE}/api/a2a/register`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						from: i === 1 ? 'session-other' : 'session-sender',
						to: 'session-target',
						message: `msg ${i}`,
						watermark: 0,
						id: `a2a-r${i}${'0'.repeat(14)}`
					})
				})
			}));;
		}
		// distinct sentAt so newest-first is deterministic
		for (const [i, r] of listRecent(100).entries()) {
			expect(typeof r.sentAt).toBe('number');
			void i;
		}
		const res = await listRoute(mkEvent({ url: new URL(`${BASE}/api/a2a`) }));;
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			rows: Array<{ id: string; fromSession: string; state: string; watermarkTurn: number }>;
		};
		expect(body.ok).toBe(true);
		expect(body.rows.length).toBe(3);
		expect(body.rows[0].id).toBe('a2a-r2' + '0'.repeat(14));
	});

	it('from-filter returns only that sender rows', async () => {
		await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'mine',
					watermark: 0,
					id: 'a2a-mine0000000000000'
				})
			})
		}));;
		await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-other',
					to: 'session-target',
					message: 'theirs',
					watermark: 0,
					id: 'a2a-their000000000000'
				})
			})
		}));;
		const res = await listRoute(mkEvent({ url: new URL(`${BASE}/api/a2a?from=session-sender`) }));;
		const body = (await res.json()) as { rows: Array<{ fromSession: string }> };
		expect(body.rows.length).toBe(1);
		expect(body.rows[0].fromSession).toBe('session-sender');
	});

	it('400 on a non-positive limit', async () => {
		const res = await listRoute(mkEvent({ url: new URL(`${BASE}/api/a2a?limit=0`) }));;
		expect(res.status).toBe(400);
	});
});

describe('GET /api/a2a/[id] (Task 3.2-T)', () => {
	it('returns the row for a known id', async () => {
		await registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: 'session-sender',
					to: 'session-target',
					message: 'hi',
					watermark: 0,
					id: 'a2a-known00000000000'
				})
			})
		}));;
		const res = await oneRoute(mkEvent({ params: { id: 'a2a-known00000000000' } }));;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; row: { id: string; state: string } };
		expect(body.ok).toBe(true);
		expect(body.row.id).toBe('a2a-known00000000000');
		expect(body.row.state).toBe('waiting');
	});

	it('404 on unknown id', async () => {
		const res = await oneRoute(mkEvent({ params: { id: 'a2a-nope000000000000' } }));;
		expect(res.status).toBe(404);
	});
});

// Coverage floor for /api/a2a/register — the arms of readBody (L22-28) and
// the seq-watermark fallback (L77-78) the block above never reaches. Same
// harness: handlers invoked directly, a fresh tmp DB per test (beforeEach),
// historySpy standing in for the target ledger tail.
describe('POST /api/a2a/register — body validation + seq-tail floor (readBody L22-28, watermark L77-78)', () => {
	const ID = 'a2a-floor000000000000';

	/** POST a raw body string straight through the real Request.json() path. */
	async function postRaw(raw: string) {
		return registerRoute(mkEvent({
			request: new Request(`${BASE}/api/a2a/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: raw
			})
		}));
	}

	/** A VALID body; overrides narrow it to the case under test (undefined
	 *  drops the key, i.e. a missing field). */
	function body(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			from: 'session-sender',
			to: 'session-target',
			message: 'hello',
			watermark: 0,
			id: ID,
			...overrides
		});
	}

	/** A rejected body: 400 + the bad-body code + the exact honest message. */
	async function expectRejected(raw: string, message: string): Promise<void> {
		const res = await postRaw(raw);
		expect(res.status).toBe(400);
		const parsed = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(parsed.ok).toBe(false);
		expect(parsed.error.code).toBe('bad-body');
		expect(parsed.error.message).toBe(message);
		expect(getRow(ID)).toBeNull(); // nothing was inserted
	}

	it('L22: a null body is not an object → 400 body must be an object', async () => {
		await expectRejected('null', 'body must be an object');
	});

	it('L22: a JSON string body is not an object → 400 body must be an object', async () => {
		await expectRejected('"just a string"', 'body must be an object');
	});

	it('L24: a missing or empty "to" → 400 naming the field', async () => {
		await expectRejected(body({ to: undefined }), '"to" must be a non-empty string');
		await expectRejected(body({ to: '' }), '"to" must be a non-empty string');
	});

	it('L26: a missing or empty "message" → 400 naming the field', async () => {
		await expectRejected(body({ message: undefined }), '"message" must be a non-empty string');
		await expectRejected(body({ message: '' }), '"message" must be a non-empty string');
	});

	it('L28: an empty-string id and a non-string id → 400; an absent id still mints (the valid arm)', async () => {
		await expectRejected(body({ id: '' }), '"id" must be a non-empty string when present');
		await expectRejected(body({ id: 7 }), '"id" must be a non-empty string when present');
		// control: the same body with a valid id is honored verbatim
		const res = await postRaw(body());
		expect(res.status).toBe(200);
		expect(getRow(ID)?.state).toBe('waiting');
	});

	it('L77-78: watermark<0 with an EMPTY target ledger → watermarkSeq -1 (the length === 0 arm)', async () => {
		historySpy.mockResolvedValue({ events: [], hasMore: false });
		const res = await postRaw(body({ watermark: -1 }));
		expect(res.status).toBe(200);
		expect(historySpy).toHaveBeenCalledTimes(1);
		expect(historySpy).toHaveBeenCalledWith('session-target');
		const row = getRow(ID);
		expect(row?.state).toBe('waiting');
		expect(row?.watermarkTurn).toBe(-1);
		expect(row?.watermarkSeq).toBe(-1); // honest "nothing seen yet", never NULL-by-guess
	});

	it('L77: watermark<0 when the history page carries NO events field → the ?? [] arm → watermarkSeq -1', async () => {
		historySpy.mockResolvedValue({});
		const res = await postRaw(body({ watermark: -1 }));
		expect(res.status).toBe(200);
		expect(getRow(ID)?.watermarkSeq).toBe(-1);
	});

	it('watermark>=0 never reads history and keeps watermarkSeq NULL even when a tail exists', async () => {
		historySpy.mockResolvedValue({
			events: [{ event: { type: 'assistant/message', seq: 99, time: 1, data: {} } }],
			hasMore: false
		});
		const res = await postRaw(body({ watermark: 5 }));
		expect(res.status).toBe(200);
		expect(historySpy).not.toHaveBeenCalled();
		expect(getRow(ID)?.watermarkTurn).toBe(5);
		expect(getRow(ID)?.watermarkSeq).toBeNull();
	});
});

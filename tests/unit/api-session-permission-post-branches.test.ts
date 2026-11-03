// @vitest-environment node
/**
 * POST branch-arm coverage for the /permission route (Agent B, 2026-10-31).
 * Complements the GET suite and its sibling POST tests: every decision arm
 * of POST is driven with realistic bodies and receipts —
 *   - request.json() rejection            → 400 bad-json
 *   - line non-string / null body / blank → 400 empty-line
 *   - exact '/permission' token ARM       → admitted
 *   - '/permission …' prefix ARM          → admitted
 *   - any other line                      → 400 bad-command
 *   - null receipt → command-miss; error kind (with / without text) → command-error
 *   - ok kind with / without text (ternary spread arms) → {ok,accepted,…}
 *   - executeCommand DshRpcError → 502 host-code mapping; plain Error → 503
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DshRpcError as TDshRpcError } from '$lib/server/dsh-rpc';

/** The POST handler touches getDshConnection().executeCommand only. */
interface FakeApi {
	executeCommand: (id: string, line: string) => Promise<unknown>;
}

let fake: FakeApi;
let DshRpcError: typeof TDshRpcError;

function postEvent(body: unknown): never {
	return {
		params: { sessionId: 's-branch' },
		request: { json: async () => body }
	} as never;
}

async function importRouteFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	DshRpcError = (await import('$lib/server/dsh-rpc')).DshRpcError;
	return import('../../src/routes/api/dsh/session/[sessionId]/permission/+server');
}

const PASS_LINE = '/permission read-only';

beforeEach(() => {
	fake = {
		executeCommand: async () => ({ commandId: 'c-x', result: { kind: 'ok', text: 'done' } })
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function codeOf(res: Response): Promise<string> {
	return ((await res.json()) as { error?: { code?: string } }).error?.code ?? '';
}

describe('POST bad-json arm', () => {
	it('returns 400 bad-json when request.json() rejects', async () => {
		const { POST } = await importRouteFresh();
		const res = await POST({
			params: { sessionId: 's-branch' },
			request: { json: async () => { throw new SyntaxError('Unexpected token'); } }
		} as never);
		expect(res.status).toBe(400);
		expect(await codeOf(res)).toBe('bad-json');
	});
});

describe('POST empty-line arm (typeof guard + blank guard)', () => {
	it('rejects a non-string line value', async () => {
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: 42 }));
		expect(res.status).toBe(400);
		expect(await codeOf(res)).toBe('empty-line');
	});

	it('rejects a null body and a missing line', async () => {
		const { POST } = await importRouteFresh();
		for (const body of [null, {}]) {
			const res = await POST(postEvent(body));
			expect(res.status).toBe(400);
			expect(await codeOf(res)).toBe('empty-line');
		}
	});

	it('rejects a whitespace-only line (trim().length === 0 arm)', async () => {
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: '\t \n' }));
		expect(res.status).toBe(400);
		expect(await codeOf(res)).toBe('empty-line');
	});
});

describe('POST bad-command arm', () => {
	it('rejects near-miss lines that are not the /permission token', async () => {
		const { POST } = await importRouteFresh();
		for (const line of ['/permissionx read-only', '/Permission read-only', '/permissionat 1']) {
			const res = await POST(postEvent({ line }));
			expect(res.status).toBe(400);
			expect(await codeOf(res)).toBe('bad-command');
		}
	});
});

describe('POST admitted-command arms (both sides of the ===/startsWith guard)', () => {
	it('admits the exact trimmed token line', async () => {
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: '/permission' }));
		expect(res.status).toBe(200);
		expect((await res.json()) as Record<string, unknown>).toEqual({
			ok: true,
			accepted: true,
			commandId: 'c-x',
			text: 'done'
		});
	});

	it('admits a padded line whose trim lands on the "/permission " prefix', async () => {
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: '  ' + PASS_LINE + '  ' }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
	});
});

describe('POST receipt arms', () => {
	it('serves command-miss when executeCommand admits nothing (null arm)', async () => {
		fake.executeCommand = async () => null;
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('command-miss');
		expect(body.error.message).toBe('the host admitted no command for this line');
	});

	it('serves command-error with the receipt text when it carries one', async () => {
		fake.executeCommand = async () => ({ commandId: 'c-1', result: { kind: 'error', text: 'blocked by open terminals' } });
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('command-error');
		expect(body.error.message).toBe('blocked by open terminals');
	});

	it('falls back to the generic message on the undefined-text ternary arm', async () => {
		fake.executeCommand = async () => ({ commandId: 'c-2', result: { kind: 'error' } });
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		const body = (await res.json()) as { error: { message: string } };
		expect(body.error.message).toBe('the command reported an error');
	});

	it('spreads text into the success body when the ok receipt has one', async () => {
		let seenLine: string | null = null;
		fake.executeCommand = async (_id: string, line: string) => {
			seenLine = line;
			return { commandId: 'c-3', result: { kind: 'ok', text: 'preset applied' } };
		};
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		expect((await res.json()) as Record<string, unknown>).toEqual({
			ok: true,
			accepted: true,
			commandId: 'c-3',
			text: 'preset applied'
		});
		expect(seenLine).toBe(PASS_LINE); // forwarded VERBATIM
	});

	it('omits the text key when the ok receipt has none (ternary else arm)', async () => {
		fake.executeCommand = async () => ({ commandId: 'c-4', result: { kind: 'ok', text: undefined } });
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ ok: true, accepted: true, commandId: 'c-4' });
		expect('text' in body).toBe(false);
	});
});

describe('POST executeCommand failure arms', () => {
	it('maps a DshRpcError to 502 with the host code', async () => {
		fake.executeCommand = async () => {
			throw new DshRpcError('session/not-found', 'no such session');
		};
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		expect(res.status).toBe(502);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('session/not-found');
	});

	it('maps a plain transport failure to 503 host-unreachable', async () => {
		fake.executeCommand = async () => {
			throw new Error('socket closed');
		};
		const { POST } = await importRouteFresh();
		const res = await POST(postEvent({ line: PASS_LINE }));
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('host-unreachable');
		expect(body.error.message).toBe('socket closed');
	});
});

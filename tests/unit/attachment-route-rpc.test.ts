/**
 * /api/dsh/session/[sessionId]/attachment route tests — the RPC paths the
 * ref-gate tests miss: a VALID ref forwarded to the host's readAttachment
 * (happy path, 200 {ok, attachment, data}), and the RPC failure arm —
 * DshRpcError → mapRpcFailure body with statusFor 502; anything else → 503.
 *
 * getDshConnection is mocked (no host on the unit floor); mapRpcFailure /
 * statusFor are the REAL dsh-rpc implementations, so the error contract is
 * pinned end-to-end rather than tautologically.
 *
 * Node env (serverOnlyTestFiles) — server-only route seam.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const readAttachment = vi.fn();

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ readAttachment })
}));

import { GET } from '../../src/routes/api/dsh/session/[sessionId]/attachment/+server';
import { DshRpcError } from '../../src/lib/server/dsh-rpc';

afterEach(() => {
	readAttachment.mockReset();
});

function get(sessionId: string, ref: unknown): Promise<Response> {
	return GET({
		params: { sessionId },
		url: new URL(`http://localhost/api/dsh/session/${sessionId}/attachment?ref=${encodeURIComponent(JSON.stringify(ref))}`)
	} as never) as Promise<Response>;
}

const VALID_REF = {
	attachmentId: 'att-1',
	mediaType: 'image/png',
	bytes: 128,
	width: 64,
	height: 32
};

describe('GET /api/dsh/session/[sessionId]/attachment — RPC paths', () => {
	it('returns 200 {ok, attachment, data} when readAttachment resolves', async () => {
		const attachment = { ...VALID_REF, name: 'shot.png' };
		readAttachment.mockResolvedValue({ attachment, data: 'aGVsbG8=' });
		const res = await get('sess-1', VALID_REF);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, attachment, data: 'aGVsbG8=' });
		expect(readAttachment).toHaveBeenCalledWith('sess-1', VALID_REF);
	});

	it('maps a DshRpcError through mapRpcFailure with statusFor 502', async () => {
		readAttachment.mockRejectedValue(
			new DshRpcError('session/attachment-not-found', 'no such attachment')
		);
		const res = await get('sess-1', VALID_REF);
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('session/attachment-not-found');
		expect(body.error.message).toBe('DSH RPC session/attachment-not-found: no such attachment');
	});

	it('maps a non-DshRpcError (transport down) to 503 host-unreachable', async () => {
		readAttachment.mockRejectedValue(new TypeError('fetch failed'));
		const res = await get('sess-1', VALID_REF);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('host-unreachable');
	});
});

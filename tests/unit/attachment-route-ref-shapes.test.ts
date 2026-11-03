/**
 * GET /api/dsh/session/[sessionId]/attachment — parseImageRef OPTIONAL/edge
 * shapes (branch-coverage task). The structural gate admits:
 *  - a ref with an optional string name (forwarded);
 *  - a ref with no name / a non-string name (dropped, gate still passes);
 *  - bytes === 0 (non-negative boundary);
 *  - unknown extra fields (stripped from the forwarded ref);
 *  - mediaType exactly on the raster whitelist (case-sensitive —
 *    isPromptImageMediaType uses a plain includes, so 'IMAGE/PNG' fails).
 *
 * The forwarded ref is observed by mocking $lib/server/dsh-connection so
 * getDshConnection().readAttachment captures its second argument — same
 * direct-handler invocation pattern as api-dsh-session-path-route.test.ts.
 *
 * Node env (serverOnlyTestFiles) — server-only route seam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readAttachment = vi.fn();

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ readAttachment })
}));

import { GET } from '../../src/routes/api/dsh/session/[sessionId]/attachment/+server';

const SESSION = 'sess-1';

function get(ref: Record<string, unknown> | string): Promise<Response> {
	const raw = typeof ref === 'string' ? ref : JSON.stringify(ref);
	return GET({
		params: { sessionId: SESSION },
		url: new URL(`http://localhost/api/dsh/session/${SESSION}/attachment?ref=${encodeURIComponent(raw)}`)
	} as never) as Promise<Response>;
}

/** A ref the gate accepts; fields overridden per test. */
function baseRef(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		attachmentId: 'att-1',
		mediaType: 'image/png',
		bytes: 1024,
		width: 64,
		height: 32,
		...over
	};
}

beforeEach(() => {
	readAttachment.mockReset();
	readAttachment.mockResolvedValue({ attachment: {}, data: 'Zm9v' });
});

describe('GET attachment — parseImageRef optional/edge shapes', () => {
	it('(a) forwards the optional string name through the gate', async () => {
		const res = await get(baseRef({ name: 'screenshot.png' }));
		expect(res.status).toBe(200);
		expect(readAttachment).toHaveBeenCalledTimes(1);
		const forwarded = readAttachment.mock.calls[0][1];
		expect(forwarded).toEqual({
			attachmentId: 'att-1',
			mediaType: 'image/png',
			bytes: 1024,
			width: 64,
			height: 32,
			name: 'screenshot.png'
		});
	});

	it('(b) a ref without a name passes and forwards no name key', async () => {
		const res = await get(baseRef());
		expect(res.status).toBe(200);
		const forwarded = readAttachment.mock.calls[0][1];
		expect(forwarded).not.toHaveProperty('name');
		expect(forwarded).toEqual({
			attachmentId: 'att-1',
			mediaType: 'image/png',
			bytes: 1024,
			width: 64,
			height: 32
		});
	});

	it('(c) a non-string name (number) is dropped but the gate still passes', async () => {
		const res = await get(baseRef({ name: 42 }));
		expect(res.status).toBe(200);
		const forwarded = readAttachment.mock.calls[0][1];
		expect(forwarded).not.toHaveProperty('name');
	});

	it('(d) bytes === 0 is accepted at the non-negative boundary', async () => {
		const res = await get(baseRef({ bytes: 0 }));
		expect(res.status).toBe(200);
		expect(readAttachment.mock.calls[0][1].bytes).toBe(0);
	});

	it('(e) unknown extra fields are stripped from the forwarded ref', async () => {
		const res = await get(
			baseRef({ sneaky: 'payload', originalDimensions: { width: 1, height: 1 } })
		);
		expect(res.status).toBe(200);
		const forwarded = readAttachment.mock.calls[0][1];
		expect(Object.keys(forwarded).sort()).toEqual([
			'attachmentId',
			'bytes',
			'height',
			'mediaType',
			'width'
		]);
	});

	it('(f) mediaType is case-sensitive — IMAGE/PNG fails the gate with 400', async () => {
		// isPromptImageMediaType uses a plain includes over the lowercase
		// whitelist (dsh-rpc.ts:538), so uppercase variants are rejected.
		const res = await get(baseRef({ mediaType: 'IMAGE/PNG' }));
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
			'missing-attachment-ref'
		);
		expect(readAttachment).not.toHaveBeenCalled();
	});

	it('(f) each whitelisted raster type in its exact case passes the gate', async () => {
		for (const mediaType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
			const res = await get(baseRef({ mediaType }));
			expect(res.status).toBe(200);
			expect(readAttachment.mock.calls.at(-1)?.[1].mediaType).toBe(mediaType);
		}
	});
});

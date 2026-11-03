/**
 * /api/dsh/session/[sessionId]/attachment route tests — the parseImageRef
 * rejection gate (coverage gap task 2026-10-29): every malformed client
 * ref answers 400 {ok:false, error.code:'missing-attachment-ref'} and
 * never reaches the RPC boundary (getDshConnection stays mocked and
 * untouched — the 0.2.2 verify-by-ref contract's structural pre-gate).
 *
 * Handlers invoked directly with node-env request objects (the
 * api-dsh-session-path-route.test.ts pattern). Node env — listed in
 * serverOnlyTestFiles (vitest.config.ts).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ readAttachment: vi.fn() })
}));

import { GET } from '../../src/routes/api/dsh/session/[sessionId]/attachment/+server';

const ROUTE = 'http://dsi.test/api/dsh/session/s-1/attachment';

/** One valid ref; each case below mutates one field into garbage. */
const VALID_REF = {
	attachmentId: 'att-1',
	mediaType: 'image/png',
	bytes: 1024,
	width: 320,
	height: 240
};

function getWithRef(ref: string | null): Promise<Response> {
	const url = new URL(ROUTE);
	if (ref !== null) url.searchParams.set('ref', ref);
	return GET({ params: { sessionId: 's-1' }, url } as never) as Promise<Response>;
}

async function expectRefRejection(ref: string | null): Promise<void> {
	const res = await getWithRef(ref);
	expect(res.status).toBe(400);
	const body = (await res.json()) as { ok: boolean; error: { code: string } };
	expect(body.ok).toBe(false);
	expect(body.error.code).toBe('missing-attachment-ref');
}

describe('GET /api/dsh/session/[sessionId]/attachment — parseImageRef gate', () => {
	it.each([
		['missing ref param', null],
		['empty-string ref', ''],
		['invalid JSON', '{not json'],
		['JSON number primitive', '5'],
		['JSON null primitive', 'null'],
		['attachmentId missing', JSON.stringify({ ...VALID_REF, attachmentId: undefined })],
		['attachmentId empty', JSON.stringify({ ...VALID_REF, attachmentId: '' })],
		['attachmentId non-string', JSON.stringify({ ...VALID_REF, attachmentId: 7 })],
		['mediaType not a string', JSON.stringify({ ...VALID_REF, mediaType: 42 })],
		['mediaType off the whitelist', JSON.stringify({ ...VALID_REF, mediaType: 'image/svg+xml' })],
		['bytes negative', JSON.stringify({ ...VALID_REF, bytes: -1 })],
		['bytes non-number', JSON.stringify({ ...VALID_REF, bytes: '1024' })],
		['width missing', JSON.stringify({ ...VALID_REF, width: undefined })],
		['width non-number', JSON.stringify({ ...VALID_REF, width: '320' })],
		['height missing', JSON.stringify({ ...VALID_REF, height: undefined })],
		['height non-number', JSON.stringify({ ...VALID_REF, height: '240' })]
	])('rejects: %s with 400 missing-attachment-ref', async (_name, ref) => {
		await expectRefRejection(ref);
	});
});

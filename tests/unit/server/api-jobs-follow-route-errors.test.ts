/**
 * Job-follow route ERROR/VALIDATION tests: GET /api/dsh/jobs/follow —
 * the bad-jobId 400 guard, a throwing relay.subscribeJobFollow, the
 * cancel-path unref contract, and the route's GET-only surface
 * (no POST/PUT/DELETE handler exists, so SvelteKit answers 405).
 * Success paths live in api-jobs-follow-route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { subscribeSpy } = vi.hoisted(() => ({ subscribeSpy: vi.fn() }));

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ relay: { subscribeJobFollow: subscribeSpy } })
}));

import * as route from '../../../src/routes/api/dsh/jobs/follow/+server';
const { GET } = route;

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/dsh/jobs/follow' + query) } as never) as Promise<Response>;
}

beforeEach(() => {
	subscribeSpy.mockReset();
});

describe('GET /api/dsh/jobs/follow — error and validation branches', () => {
	it('rejects a missing jobId with 400 bad-job before touching the relay', async () => {
		const res = await get('');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: { code: 'bad-job', message: 'jobId is required' } });
		expect(subscribeSpy).not.toHaveBeenCalled();
	});

	it('rejects an empty jobId with 400 bad-job (query param present but blank)', async () => {
		const res = await get('?jobId=&sessionId=s1');
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-job');
		expect(subscribeSpy).not.toHaveBeenCalled();
	});

	it('a throwing relay.subscribeJobFollow fails the request (start() throws inside the ReadableStream)', () => {
		subscribeSpy.mockImplementation(() => {
			throw new Error('relay exploded');
		});
		expect(() => GET({ url: new URL('http://localhost/api/dsh/jobs/follow?jobId=j1&sessionId=s1') } as never)).toThrow('relay exploded');
	});

	it('cancel() unrefs the relay subscription (the unsubscribe fn runs)', async () => {
		const unsubscribe = vi.fn();
		subscribeSpy.mockReturnValueOnce(unsubscribe);
		const res = await get('?jobId=j1&sessionId=s1');
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		await reader.cancel();
		expect(subscribeSpy).toHaveBeenCalledWith('s1', 'j1', expect.any(Function));
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('the route exports only GET — other methods are not handled (405 via SvelteKit)', () => {
		expect(route.GET).toBeTypeOf('function');
		expect('POST' in route).toBe(false);
		expect('PUT' in route).toBe(false);
		expect('DELETE' in route).toBe(false);
		expect('PATCH' in route).toBe(false);
	});
});

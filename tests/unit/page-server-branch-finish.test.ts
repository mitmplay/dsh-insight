// @vitest-environment node
/**
 * +page.server load — branch-coverage finisher (coverage pass).
 *
 * Pins the remaining arms the earlier load suites miss:
 *  - ledger hasMore === true reaching the load result (the sentinel arm);
 *  - the tail page's projections block present (title/permission/imageLimits
 *    seeds) AND the live waitForProjections block overriding it;
 *  - the tail block ABSENT (?? {} fallback) with a NON-STRING title and
 *    a live block lacking permissions/imageLimits (the ?? prior-value arms);
 *  - session.list rows: the matched row carrying undefined chip fields
 *    (the ?? null arms) and the no-matching-row arm;
 *  - the 409 subagent-ownership rejection arm; the 503 arm WITH an Error
 *    instance (interpolated message).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DshRpcError as TDshRpcError } from '$lib/server/dsh-rpc';

/** Fresh-instance class: the suite resets modules per test (instanceof-safe). */
let DshRpcError: typeof TDshRpcError;

type LoadFn = (event: { url: URL }) => Promise<Record<string, unknown>>;

function seedUrl(sid: string): URL {
	return new URL(`http://dsi/?sessionKey=${sid}`);
}

async function importLoadFresh(fake: Record<string, unknown>): Promise<LoadFn> {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	const mod = await import('../../src/routes/+page.server');
	DshRpcError = (await import('$lib/server/dsh-rpc')).DshRpcError;
	return mod.load as LoadFn;
}

const MSG = { event: { type: 'user/message', seq: 7, time: 1001, data: { text: 'hi' } } };

const LIMITS = {
	maxImageBytes: 1024,
	maxImagesPerMessage: 2,
	maxMessageImageBytes: 4096,
	maxImagePixels: 1000,
	maxImageDimension: 64,
	mediaTypes: ['image/png']
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('+page.server load — remaining branch arms', () => {
	it('ledger hasMore=true + tail projections seeded + LIVE block overrides them', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [MSG],
				hasMore: true,
				projections: {
					values: {
						title: 'Ledger truth',
						permissions: { currentValue: 'tail-mode' },
						imageLimits: LIMITS
					}
				}
			}),
			ensureDownlinks: () => {},
			subscribe: () => {},
			waitForProjections: async () => ({
				values: { permissions: { currentValue: 'live-mode' }, imageLimits: LIMITS }
			}),
			isRunning: () => true,
			listSessions: async () => ({
				items: [
					{ sessionId: 'other', workspace: '/w/other', agentPreset: 'x' },
					{ sessionId: 's1', workspace: '/w/mine', agentPreset: 'main' }
				]
			})
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.hasMore).toBe(true);
		expect(data.title).toBe('Ledger truth');
		// the LIVE baseline wins over the tail page's (the override arm)
		expect((data.permission as { current: string }).current).toBe('live-mode');
		expect(data.permission).toMatchObject({ options: expect.any(Array) });
		expect((data.imageLimits as { maxImageBytes: number }).maxImageBytes).toBe(1024);
		expect(data.workspace).toBe('/w/mine');
		expect(data.agentPreset).toBe('main');
		expect(data.lastSeq).toBe(7);
		expect(data.running).toBe(true);
	});

	it('tail block ABSENT (?? {}), non-string title → null, live block without permissions/imageLimits keeps the prior values, chip fields undefined → null', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [MSG],
				hasMore: false,
				projections: { values: { title: 42 } }
			}),
			ensureDownlinks: () => {},
			subscribe: () => {},
			waitForProjections: async () => ({ values: {} }),
			isRunning: () => false,
			listSessions: async () => ({
				items: [{ sessionId: 's1' }, { sessionId: 'zzz', workspace: '/w/zzz', agentPreset: 'z' }]
			})
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.hasMore).toBe(false);
		expect(data.title).toBeNull();
		expect(data.permission).toBeNull();
		expect(data.imageLimits).toBeNull();
		expect(data.workspace).toBeNull();
		expect(data.agentPreset).toBeNull();
	});

	it('a subagent-ownership rejection maps to 409 with the host message', async () => {
		const load = await importLoadFresh({
			history: async () => {
				throw new DshRpcError('subagent/not-found', 'owned by the parent session');
			}
		});
		await expect(load({ url: seedUrl('s-child') })).rejects.toMatchObject({
			status: 409,
			body: { message: expect.stringContaining('owned by the parent session') }
		});
	});

	it('an Error transport failure maps to 503 with the interpolated message', async () => {
		const load = await importLoadFresh({
			history: async () => {
				throw new Error('socket hung up');
			}
		});
		await expect(load({ url: seedUrl('s1') })).rejects.toMatchObject({
			status: 503,
			body: { message: 'Cannot reach the DSH host for session history: socket hung up' }
		});
	});
});

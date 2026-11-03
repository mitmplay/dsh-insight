// @vitest-environment node
/**
 * The permission route's GET handler (the chord n-verb read side, 2026-10-31).
 * Pins:
 *
 *  - GET folds the LIVE projection baseline over the history tail page;
 *    a waitForProjections rejection degrades to the tail (catch arm);
 *    no projection at all serves permission: null honestly.
 *  - GET maps DshRpcError → 502 host code and any other failure → 503
 *    host-unreachable (dsh-rpc owns the mapping; the route stays DRY).
 *
 * POST arms live in api-session-permission-post-branches.test.ts — this
 * file deliberately does NOT repeat them (review dedupe, 2026-10-31).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DshRpcError as TDshRpcError } from '$lib/server/dsh-rpc';

/** The connection members these two handlers touch. */
interface FakeApi {
	ensureDownlinks: () => void;
	subscribe: (id: string) => void;
	history: (id: string) => Promise<unknown>;
	waitForProjections: (id: string) => Promise<unknown>;
}

let fake: FakeApi;
let DshRpcError: typeof TDshRpcError;

function mkEvent(e: Record<string, unknown>): never {
	return {
		params: { sessionId: 's-perm' },
		request: { json: async () => ({}) },
		...e
	} as never;
}

async function importRouteFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	DshRpcError = (await import('$lib/server/dsh-rpc')).DshRpcError;
	return import('../../src/routes/api/dsh/session/[sessionId]/permission/+server');
}

const permissionsProjection = {
	currentValue: 'read-only',
	options: [
		{ value: 'read-only', name: 'Read Only', description: 'reads only' },
		{ value: 'custom', name: 'Custom' } // filtered: never switchable
	]
};

beforeEach(() => {
	fake = {
		ensureDownlinks: () => {},
		subscribe: () => {},
		history: async () => ({ events: [], hasMore: false }),
		waitForProjections: async () => ({ values: {} })
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET …/permission — the resolved access mode', () => {
	it('serves the live projection baseline when subscribe delivers one', async () => {
		fake.history = async () => ({
			projections: { values: { permissions: { currentValue: 'workspace-write' } } }
		});
		fake.waitForProjections = async () => ({ values: { permissions: permissionsProjection } });

		const { GET } = await importRouteFresh();
		const res = await GET(mkEvent({}));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		// The live value wins over the tail page's stale baseline.
		const permission = body.permission as { current: string; options: { value: string }[] };
		expect(permission.current).toBe('read-only');
		// Host-shipped options are authoritative; 'custom' never appears as a target.
		expect(permission.options.map((o) => o.value)).toEqual(['read-only']);
	});

	it('degrades to the history-tail projection when waitForProjections rejects', async () => {
		fake.history = async () => ({
			projections: { values: { permissions: { currentValue: 'workspace-write' } } }
		});
		fake.waitForProjections = async () => {
			throw new Error('subscribe timed out');
		};

		const { GET } = await importRouteFresh();
		const res = await GET(mkEvent({}));
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect((body.permission as { current: string }).current).toBe('workspace-write');
	});

	it('serves permission:null when neither the tail nor the live fold carries one', async () => {
		const { GET } = await importRouteFresh();
		const res = await GET(mkEvent({}));
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ ok: true, permission: null });
	});

	it('maps a DshRpcError to 502 with the host code and details', async () => {
		fake.history = async () => {
			throw new DshRpcError('session/not-found', 'no such session', { capability: 'history' });
		};

		const { GET } = await importRouteFresh();
		const res = await GET(mkEvent({}));
		expect(res.status).toBe(502);
		const body = (await res.json()) as { ok: boolean; error: Record<string, unknown> };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('session/not-found');
		expect(body.error.details).toEqual({ capability: 'history' });
	});

	it('maps a transport failure to 503 host-unreachable', async () => {
		fake.ensureDownlinks = () => {
			throw new Error('socket closed');
		};

		const { GET } = await importRouteFresh();
		const res = await GET(mkEvent({}));
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('host-unreachable');
		expect(body.error.message).toBe('socket closed');
	});
});

/**
 * GET /api/dsh/schedule route tests — coverage-gap unit (functions 80%
 * floor): the success passthrough (relay items verbatim), the error arms
 * (DshRpcError → 502 with the host code, generic transport failure → 503
 * host-unreachable) and the non-Error rejection arm. Handler invoked
 * directly — the subagents-route.test.ts mock-seam pattern.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const listScheduledTasks = vi.fn();
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ relay: { listScheduledTasks } })
}));

import { DshRpcError } from '$lib/server/dsh-rpc';
// Route via relative import — the established api-dsh.test.ts pattern
// ($lib aliases only cover src/lib).
import { GET } from '../../src/routes/api/dsh/schedule/+server';

afterEach(() => {
	listScheduledTasks.mockReset();
});

const entry = {
	id: 'sched-1',
	kind: 'daily' as const,
	title: 'Nightly report',
	scheduledAt: '2026-11-11T08:00:00Z',
	target: { kind: 'session' as const, sessionId: 'conv-1' },
	involvedSessionIds: ['conv-1'],
	status: 'active' as const
};

describe('GET /api/dsh/schedule', () => {
	it('success — relay items pass through verbatim as {items}', async () => {
		listScheduledTasks.mockResolvedValue([entry]);
		const res = await GET();
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[] };
		expect(body.items).toEqual([entry]);
		expect(listScheduledTasks).toHaveBeenCalledTimes(1);
		expect(listScheduledTasks).toHaveBeenCalledWith();
	});

	it('success — an empty ledger answers 200 with an empty items array', async () => {
		listScheduledTasks.mockResolvedValue([]);
		const res = await GET();
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[] };
		expect(body.items).toEqual([]);
	});

	it('error arm — DshRpcError → 502 with the host code mapped', async () => {
		listScheduledTasks.mockRejectedValue(new DshRpcError('schedule/not-found', 'no such task', { id: 'sched-x' }));
		const res = await GET();
		expect(res.status).toBe(502);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string; details?: unknown } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('schedule/not-found');
		expect(body.error.message).toContain('schedule/not-found');
		expect(body.error.details).toEqual({ id: 'sched-x' });
	});

	it('error arm — generic transport failure → 503 host-unreachable', async () => {
		listScheduledTasks.mockRejectedValue(new Error('socket hang up'));
		const res = await GET();
		expect(res.status).toBe(503);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('host-unreachable');
		expect(body.error.message).toBe('socket hang up');
	});

	it('error arm — a non-Error rejection still maps to 503 host-unreachable', async () => {
		listScheduledTasks.mockRejectedValue('string rejection');
		const res = await GET();
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('host-unreachable');
		expect(body.error.message).toBe('string rejection');
	});
});

/**
 * /api/dsh/subagents route tests — coverage-gap unit (functions 80% floor):
 * the degrade lane (waitForProjections rejection → null tokens/operateMs),
 * the error arms (generic transport failure → 503 host-unreachable,
 * DshRpcError → 502 with the host code), and the parent-filter/parent-less
 * split. Handler invoked directly with a node-env RequestEvent double
 * (the a2a-routes.test.ts mock-seam pattern).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const listSessions = vi.fn();
const waitForProjections = vi.fn();
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ listSessions, waitForProjections })
}));

import { DshRpcError } from '$lib/server/dsh-rpc';
// Route via relative import — the established api-dsh.test.ts pattern
// ($lib aliases only cover src/lib).
import { GET } from '../../src/routes/api/dsh/subagents/+server';

afterEach(() => {
	listSessions.mockReset();
	waitForProjections.mockReset();
});

function mkEvent(url: string): never {
	return { setHeaders: () => {}, url: new URL(url) } as never;
}

const row = (sessionId: string, extra: Record<string, unknown> = {}) => ({
	sessionId,
	title: `title ${sessionId}`,
	origin: 'subagent',
	parentSessionId: 'parent-1',
	running: false,
	updatedAt: 42,
	...extra
});

const PROJECTIONS = {
	values: {
		sessionStats: {
			turns: 1, steps: 2, llmMs: 36_000, toolMs: 0, ttftMs: 10,
			ttftSteps: 1, decodeMs: 20, decodeTokens: 5
		},
		tokenUsage: {
			uncachedInputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5,
			outputTokens: 30
		}
	}
};

describe('GET /api/dsh/subagents', () => {
	it('joins tokens/operateMs from valid projections, filtered by parent', async () => {
		listSessions.mockResolvedValue({
			items: [
				row('child-1'),
				row('child-2', { parentSessionId: 'other' }),
				row('top', { origin: 'user', parentSessionId: null }),
				// The spawner itself must be in the feed for parentTitle to resolve.
				row('parent-1', { origin: 'user', parentSessionId: null })
			]
		});
		waitForProjections.mockResolvedValue(PROJECTIONS);
		const res = await GET(mkEvent('http://localhost/api/dsh/subagents?parent=parent-1'));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; subagents: unknown[] };
		expect(body.ok).toBe(true);
		expect(body.subagents).toHaveLength(1);
		const child = body.subagents[0] as {
			sessionId: string; tokens: { input: number; output: number }; operateMs: number; parentTitle: string | null;
		};
		expect(child.sessionId).toBe('child-1');
		expect(child.tokens).toEqual({ input: 35, output: 30 });
		expect(child.operateMs).toBe(36_000);
		expect(child.parentTitle).toBe('title parent-1');
	});

	it('parent omitted — every subagent row regardless of spawner', async () => {
		listSessions.mockResolvedValue({
			items: [row('child-1'), row('child-2', { parentSessionId: 'other' })]
		});
		waitForProjections.mockResolvedValue(PROJECTIONS);
		const res = await GET(mkEvent('http://localhost/api/dsh/subagents'));
		const body = (await res.json()) as { subagents: { sessionId: string }[] };
		expect(body.subagents.map((s) => s.sessionId).sort()).toEqual(['child-1', 'child-2']);
	});

	it('degrade lane — projection wait rejection → null tokens AND operateMs', async () => {
		listSessions.mockResolvedValue({ items: [row('child-1')] });
		waitForProjections.mockRejectedValue(new Error('projection wait failed'));
		const res = await GET(mkEvent('http://localhost/api/dsh/subagents?parent=parent-1'));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { subagents: { tokens: unknown; operateMs: unknown }[] };
		expect(body.subagents[0].tokens).toBeNull();
		expect(body.subagents[0].operateMs).toBeNull();
	});

	it('degrade lane — malformed projection values → null row stats', async () => {
		listSessions.mockResolvedValue({ items: [row('child-1')] });
		waitForProjections.mockResolvedValue({ values: { sessionStats: { llmMs: 'bogus' } } });
		const res = await GET(mkEvent('http://localhost/api/dsh/subagents?parent=parent-1'));
		const body = (await res.json()) as { subagents: { tokens: unknown; operateMs: unknown }[] };
		expect(body.subagents[0].tokens).toBeNull();
		expect(body.subagents[0].operateMs).toBeNull();
	});

	it('error arm — transport failure → 503 host-unreachable', async () => {
		listSessions.mockRejectedValue(new Error('socket hang up'));
		const res = await GET(mkEvent('http://localhost/api/dsh/subagents'));
		expect(res.status).toBe(503);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('host-unreachable');
		expect(body.error.message).toBe('socket hang up');
	});

	it('error arm — DshRpcError → 502 with the host code', async () => {
		listSessions.mockRejectedValue(new DshRpcError('session/not-found', 'no such session'));
		const res = await GET(mkEvent('http://localhost/api/dsh/subagents'));
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('session/not-found');
		expect(body.error.message).toContain('session/not-found');
	});
});

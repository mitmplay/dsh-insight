/**
 * GET /api/dsh/subagents — the server join (Subagent Anchor Wave 2, Task
 * 2.1-T): happy join; missing-projection row degrades tokens to null;
 * empty subagent set; malformed projection degrade lane. The fake
 * connection is monkey-patched over the module-level getter (api-dsh
 * test pattern — no live host).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DsiSessionSummary } from '$lib/types';

const SESSION_STATS = {
	turns: 2,
	steps: 5,
	llmMs: 1000,
	toolMs: 500,
	ttftMs: 100,
	ttftSteps: 5,
	decodeMs: 900,
	decodeTokens: 42
};
const TOKEN_USAGE = {
	uncachedInputTokens: 100,
	cacheReadTokens: 200,
	cacheWriteTokens: 50,
	outputTokens: 42
};

function spineRow(over: Partial<DsiSessionSummary>): DsiSessionSummary {
	return {
		sessionId: 's',
		title: null,
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 1,
		workspace: null,
		turns: null,
		parentSessionId: null,
		origin: null,
		...over
	};
}

let fake: {
	listSessions: () => Promise<unknown>;
	projectionValue: (id: string, key: string) => unknown;
	waitForProjections: (id: string) => Promise<unknown>;
	history: (id: string) => Promise<unknown>;
	historyPage: (id: string, beforeSeq: number) => Promise<unknown>;
};

async function importRouteFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	return import('../../src/routes/api/dsh/subagents/+server');
}

beforeEach(() => {
	fake = {
		listSessions: async () => ({ items: [] }),
		projectionValue: () => undefined,
		waitForProjections: async () => null,
		history: async () => ({ events: [{ event: { type: 'user', seq: 1, time: 5000 } }], hasMore: false }),
		historyPage: async () => ({ events: [], hasMore: false })
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/dsh/subagents', () => {
	it('happy join: filters to subagent rows and folds the billed buckets', async () => {
		fake.listSessions = async () => ({
			items: [
				spineRow({ sessionId: 'parent', title: 'Parent' }),
				spineRow({
					sessionId: 'child',
					title: 'Child',
					origin: 'subagent',
					parentSessionId: 'parent',
					running: true,
					updatedAt: 77
				})
			]
		});
		fake.waitForProjections = async (id: string) =>
			id === 'child' ? { values: { sessionStats: SESSION_STATS, tokenUsage: TOKEN_USAGE } } : null;
		const { GET } = await importRouteFresh();
		const res = await GET({ setHeaders: () => {}, url: new URL('http://localhost/api/dsh/subagents') } as never);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		// the user-created parent row is NOT listed
		expect(body.subagents).toEqual([
			{
				sessionId: 'child',
				title: 'Child',
				parentTitle: 'Parent',
				tokens: { input: 350, output: 42 },
				operateMs: 1000,
				running: true,
				updatedAt: 77
			}
		]);
	});

	it('missing projection: tokens is null — never a synthesized number', async () => {
		fake.listSessions = async () => ({
			items: [spineRow({ sessionId: 'drift', origin: 'subagent' })]
		});
		fake.projectionValue = () => undefined;
		const { GET } = await importRouteFresh();
		const body = await (await GET({ setHeaders: () => {}, url: new URL('http://localhost/api/dsh/subagents') } as never)).json();
		expect(body.subagents[0].tokens).toBeNull();
		expect(body.subagents[0].title).toBeNull();
		expect(body.subagents[0].parentTitle).toBeNull();
	});

	it('?parent= scopes the list to THAT session children (DSH dropdown parity, 2026-10-26)', async () => {
		fake.listSessions = async () => ({
			items: [
				spineRow({ sessionId: 'mine', origin: 'subagent', parentSessionId: 'me' }),
				spineRow({ sessionId: 'theirs', origin: 'subagent', parentSessionId: 'other' })
			]
		});
		const { GET } = await importRouteFresh();
		const res = await GET({ setHeaders: () => {}, url: new URL('http://localhost/api/dsh/subagents?parent=me') } as never);
		const body = await res.json();
		expect(body.subagents.map((r: { sessionId: string }) => r.sessionId)).toEqual(['mine']);
	});

	it('malformed projection degrades to null tokens (validator lane)', async () => {
		fake.listSessions = async () => ({
			items: [spineRow({ sessionId: 'bad', origin: 'subagent' })]
		});
		// totals-wrapped tokenUsage (the persisted fold shape) must NOT validate
		fake.projectionValue = (_id, key) => (key === 'sessionStats' ? SESSION_STATS : { totals: TOKEN_USAGE });
		const { GET } = await importRouteFresh();
		const body = await (await GET({ setHeaders: () => {}, url: new URL('http://localhost/api/dsh/subagents') } as never)).json();
		expect(body.subagents[0].tokens).toBeNull();
	});

	it('empty subagent set: ok with an empty list', async () => {
		const { GET } = await importRouteFresh();
		const body = await (await GET({ setHeaders: () => {}, url: new URL('http://localhost/api/dsh/subagents') } as never)).json();
		expect(body).toEqual({ ok: true, subagents: [] });
	});

	it('fork rows (parentSessionId, origin null) are NOT subagents', async () => {
		fake.listSessions = async () => ({
			items: [spineRow({ sessionId: 'fork', parentSessionId: 'parent', origin: null })]
		});
		const { GET } = await importRouteFresh();
		const body = await (await GET({ setHeaders: () => {}, url: new URL('http://localhost/api/dsh/subagents') } as never)).json();
		expect(body.subagents).toEqual([]);
	});
});
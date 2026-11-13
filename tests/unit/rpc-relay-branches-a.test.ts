/**
 * RpcRelay branch coverage - first half of rpc-relay.ts (lines 1-650):
 * the guard clauses and error arms of the answer registry (register,
 * withdraw, settle, reap), the schedule-row normalizer junk-row skips,
 * session-list fork-title healing + subagent hint folding, the
 * workspace-owner parent walk (cycle guard), and the page-cursor
 * fallback ladder (follow buffer, list watermark, unconstrained -1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcRelay, normalizeScheduledEntry } from '$lib/server/connection/rpc-relay';
import { DSH_METHODS } from '$lib/server/dsh-rpc';
import type { DshConnection } from '$lib/server/dsh-connection';

interface FakeConnOptions {
	generation?: number;
	lastSeq?: number;
	listItems?: unknown[] | (() => unknown);
	projections?: unknown;
}

function makeRelay(opts: FakeConnOptions = {}) {
	const logs: unknown[][] = [];
	const rpcCalls: Array<[string, unknown]> = [];
	const state = { generation: opts.generation ?? 1 };
	const waitForProjections = vi.fn(async (_sessionId: string) => opts.projections ?? null);
	const bufferFor = vi.fn((_sessionId: string) => ({ lastSeq: opts.lastSeq ?? -1 }));
	const rpc = vi.fn(async (method: string, payload: unknown): Promise<unknown> => {
		rpcCalls.push([method, payload]);
		if (method === DSH_METHODS.list) {
			const items = typeof opts.listItems === 'function' ? opts.listItems() : (opts.listItems ?? []);
			return { items };
		}
		return {};
	});
	const conn = {
		rpc,
		log: (...a: unknown[]) => logs.push(a),
		downlinks: {
			get generation() {
				return state.generation;
			},
			waitForProjections
		},
		sessions: { bufferFor }
	} as unknown as DshConnection;
	const relay = new RpcRelay(conn, () => 10, {
		answerReapGraceMs: 1_000,
		staleGenerationRetryMs: 1_000
	});
	return { relay, logs, rpcCalls, rpc, waitForProjections, bufferFor, state };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('normalizeScheduledEntry - junk rows skipped, absent fields null', () => {
	it('rejects non-objects and rows without a readable id', () => {
		expect(normalizeScheduledEntry(null)).toBeNull();
		expect(normalizeScheduledEntry('nope')).toBeNull();
		expect(normalizeScheduledEntry({ status: 'active' })).toBeNull();
		expect(normalizeScheduledEntry({ id: '', status: 'active' })).toBeNull();
	});

	it('rejects statuses outside the ledger three', () => {
		expect(normalizeScheduledEntry({ id: 't1', status: 'running' })).toBeNull();
		expect(normalizeScheduledEntry({ id: 't1', status: 42 })).toBeNull();
		expect(normalizeScheduledEntry({ id: 't1' })).toBeNull();
	});

	it('accepts the three ledger statuses with absent fields null', () => {
		for (const status of ['active', 'paused', 'ended'] as const) {
			const row = normalizeScheduledEntry({ id: 't1', status });
			expect(row).toEqual({
				id: 't1',
				title: '',
				status,
				kind: null,
				scheduledAt: null,
				targetKind: null,
				targetSessionId: null,
				lastDelivery: null
			});
		}
	});

	it('falls back to the storage-shaped record for title, kind and scheduledAt', () => {
		const row = normalizeScheduledEntry({
			id: 't1',
			status: 'paused',
			record: { title: 'Rec title', kind: 'once', scheduledAt: '2026-01-01T00:00:00Z' }
		});
		expect(row?.title).toBe('Rec title');
		expect(row?.kind).toBe('once');
		expect(row?.scheduledAt).toBe('2026-01-01T00:00:00Z');
	});

	it('an empty-string targetSessionId is no session - null, never an empty string', () => {
		const row = normalizeScheduledEntry({
			id: 't1',
			status: 'active',
			target: { kind: 'session', sessionId: '' }
		});
		expect(row?.targetKind).toBe('session');
		expect(row?.targetSessionId).toBeNull();
	});

	it('a partial delivery keeps the present half and nulls the absent half', () => {
		const onlyDeliveredAt = normalizeScheduledEntry({
			id: 't1',
			status: 'active',
			lastDelivery: { deliveredAt: '2026-01-01T08:00:00Z' }
		});
		expect(onlyDeliveredAt?.lastDelivery).toEqual({
			deliveredAt: '2026-01-01T08:00:00Z',
			targetSessionId: null
		});
		const onlyTarget = normalizeScheduledEntry({
			id: 't1',
			status: 'active',
			lastDelivery: { targetSessionId: 's9' }
		});
		expect(onlyTarget?.lastDelivery).toEqual({ deliveredAt: null, targetSessionId: 's9' });
	});
});

describe('registerPending / withdrawPending - guard clauses and idempotency', () => {
	it('an orphan frame without sessionId is logged and ignored', () => {
		const { relay, logs } = makeRelay();
		relay.registerPending({ type: 'approval/requested' }, 'rpc-1');
		expect(relay.pendingFor('')).toEqual([]);
		expect(logs.some((l) => String(l[0]).includes('without sessionId'))).toBe(true);
	});

	it('a frame without an rpcId is logged and ignored', () => {
		const { relay, logs } = makeRelay();
		relay.registerPending({ type: 'question/requested', sessionId: 's1' });
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, '');
		expect(relay.pendingFor('s1')).toEqual([]);
		expect(logs.some((l) => String(l[0]).includes('without rpcId'))).toBe(true);
	});

	it('a replay over the same rpcId replaces, never duplicates', () => {
		const { relay } = makeRelay({ generation: 1 });
		relay.registerPending({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1' }, 'rpc-1');
		relay.registerPending({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1' }, 'rpc-1');
		expect(relay.pendingFor('s1')).toHaveLength(1);
		expect(relay.pendingFor('s1')[0].kind).toBe('approval');
	});

	it('a non-approval frame registers as a question', () => {
		const { relay } = makeRelay();
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'rpc-q');
		expect(relay.pendingFor('s1')[0].kind).toBe('question');
	});

	it('withdrawing an unknown id settles nothing (honest no-op)', () => {
		const { relay, logs } = makeRelay();
		relay.withdrawPending('ghost');
		expect(logs.some((l) => String(l[0]).includes('no matching pending'))).toBe(true);
	});

	it('withdrawal records the outcome, defaulting to cancelled', () => {
		const { relay } = makeRelay();
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'rpc-q');
		relay.withdrawPending('rpc-q');
		expect(relay.pendingFor('s1')).toEqual([]);
		expect(relay.settlementsFor('s1')[0]).toEqual(
			expect.objectContaining({ rpcId: 'rpc-q', kind: 'question', outcome: 'cancelled' })
		);
		relay.registerPending({ type: 'approval/requested', sessionId: 's1' }, 'rpc-a');
		relay.withdrawPending('rpc-a', 'rejected');
		expect(relay.settlementsFor('s1')[1].outcome).toBe('rejected');
	});
});
describe('armAnswerReap - the unconfirmed-generation reap', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('reaps only entries an older generation registered', async () => {
		const { relay, state, logs } = makeRelay({ generation: 1 });
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'old-gen');
		state.generation = 2;
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'cur-gen');
		relay.armAnswerReap();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(relay.pendingFor('s1').map((p) => p.rpcId)).toEqual(['cur-gen']);
		expect(relay.settlementsFor('s1')[0]).toEqual(
			expect.objectContaining({ rpcId: 'old-gen', outcome: 'cancelled' })
		);
		expect(logs.some((l) => String(l[0]).includes('reap unconfirmed pending'))).toBe(true);
	});

	it('an entry the same generation re-delivered survives the reap', async () => {
		const { relay, state } = makeRelay({ generation: 3 });
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'same-gen');
		state.generation = 3;
		relay.armAnswerReap();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(relay.pendingFor('s1')).toHaveLength(1);
	});
});

describe('registerSettlement - resolution arms and unknown-request no-op', () => {
	it('a settlement frame without sessionId is ignored', () => {
		const { relay, logs } = makeRelay();
		relay.registerSettlement({ type: 'approval/resolved', outcome: 'allowed-once' });
		expect(logs.some((l) => String(l[0]).includes('without sessionId'))).toBe(true);
	});

	it('approval/resolved keys by approvalId back to the pending rpcId', () => {
		const { relay } = makeRelay();
		relay.registerPending({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1' }, 'rpc-a');
		relay.registerSettlement({
			type: 'approval/resolved',
			sessionId: 's1',
			approvalId: 'a1',
			outcome: 'rejected'
		});
		expect(relay.pendingFor('s1')).toEqual([]);
		expect(relay.settlementsFor('s1')[0]).toEqual(
			expect.objectContaining({ rpcId: 'rpc-a', kind: 'approval', outcome: 'rejected' })
		);
	});

	it('question/resolved keys by the original request rpcId', () => {
		const { relay } = makeRelay();
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'rpc-q');
		relay.registerSettlement({
			type: 'question/resolved',
			sessionId: 's1',
			questionRpcId: 'rpc-q',
			outcome: 'answered'
		});
		expect(relay.settlementsFor('s1')[0]).toEqual(
			expect.objectContaining({ rpcId: 'rpc-q', outcome: 'answered' })
		);
	});

	it('a settlement naming no pending request is ignored (answered elsewhere)', () => {
		const { relay, logs } = makeRelay();
		relay.registerSettlement({
			type: 'approval/resolved',
			sessionId: 's1',
			approvalId: 'foreign',
			outcome: 'rejected'
		});
		expect(relay.settlementsFor('s1')).toEqual([]);
		expect(logs.some((l) => String(l[0]).includes('no matching pending'))).toBe(true);
	});
});

describe('pruneSettlements - the ring prune', () => {
	it('drops only seen settlements of this session', () => {
		const { relay } = makeRelay();
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'q1');
		relay.registerPending({ type: 'question/requested', sessionId: 's2' }, 'q2');
		relay.withdrawPending('q1');
		relay.withdrawPending('q2');
		relay.pruneSettlements('s1', ['q1', 'q2', 'ghost']);
		expect(relay.settlementsFor('s1')).toEqual([]);
		expect(relay.settlementsFor('s2').map((s) => s.rpcId)).toEqual(['q2']);
	});
});
describe('listSessions - fork-title healing branches', () => {
	it('a titled row passes through untouched (no healing)', async () => {
		const { relay, waitForProjections } = makeRelay({
			listItems: [{ sessionId: 's1', projections: { values: { title: 'Titled' } } }]
		});
		const { items } = await relay.listSessions();
		expect(items[0].title).toBe('Titled');
		expect(waitForProjections).not.toHaveBeenCalled();
	});

	it('an untitled fork row falls back to the parent title, then heals off the baseline', async () => {
		const { relay, waitForProjections } = makeRelay({
			projections: { values: { title: 'Child real title' } },
			listItems: [
				{ sessionId: 'parent', projections: { values: { title: 'Parent title' } } },
				{ sessionId: 'child', parentSessionId: 'parent' }
			]
		});
		const { items } = await relay.listSessions();
		expect(items[1].title).toBe('Parent title');
		expect(waitForProjections).toHaveBeenCalledWith('child');
		await flush();
		// The healed hint now serves the child's REAL title on the next list.
		const again = await relay.listSessions();
		expect(again.items[1].title).toBe('Child real title');
	});

	it('a rejecting baseline read logs and keeps the parent fallback', async () => {
		const { relay, waitForProjections, logs } = makeRelay({
			listItems: [
				{ sessionId: 'parent', projections: { values: { title: 'Parent title' } } },
				{ sessionId: 'child', parentSessionId: 'parent' }
			]
		});
		waitForProjections.mockRejectedValue(new Error('stream down'));
		const first = await relay.listSessions();
		expect(first.items[1].title).toBe('Parent title');
		await flush();
		expect(logs.some((l) => String(l[0]).includes('fork-title follow-baseline read failed'))).toBe(true);
		// In-flight cleared - a second list probes again instead of hanging.
		const second = await relay.listSessions();
		expect(second.items[1].title).toBe('Parent title');
	});

	it('a subagent-origin untitled row is skipped - no healing, title stays null', async () => {
		const { relay, waitForProjections } = makeRelay({
			listItems: [{ sessionId: 'sub', origin: 'subagent' }]
		});
		const { items } = await relay.listSessions();
		expect(items[0].title).toBeNull();
		expect(waitForProjections).not.toHaveBeenCalled();
	});

	it('an untitled root row (no parent) is skipped', async () => {
		const { relay, waitForProjections } = makeRelay({
			listItems: [{ sessionId: 'root' }]
		});
		const { items } = await relay.listSessions();
		expect(items[0].title).toBeNull();
		expect(waitForProjections).not.toHaveBeenCalled();
	});
});

describe('rawListSessions + foldSubagentHint - hint folding guards', () => {
	it('a non-array list payload folds nothing and serves an empty set', async () => {
		const { relay, rpc } = makeRelay({});
		rpc.mockResolvedValueOnce({});
		expect(await relay.rawListSessions()).toEqual([]);
		rpc.mockResolvedValueOnce(undefined);
		expect(await relay.rawListSessions()).toEqual([]);
	});

	it('a full subagent row folds a hint; addressFor serves the parent form', async () => {
		const { relay } = makeRelay({
			listItems: [
				{
					sessionId: 'child',
					origin: 'subagent',
					parentSessionId: 'root',
					projections: { values: { subagent: { mode: 'continuable', label: 'helper' } } }
				}
			]
		});
		await relay.rawListSessions();
		expect(relay.addressFor('child')).toEqual({
			kind: 'subagent',
			parentSessionId: 'root',
			childSessionId: 'child',
			mode: 'continuable'
		});
	});

	it('a junk mode or missing parent folds no hint - plain session form', async () => {
		const { relay } = makeRelay({
			listItems: [
				{
					sessionId: 'c1',
					origin: 'subagent',
					parentSessionId: 'root',
					projections: { values: { subagent: { mode: 'warp' } } }
				},
				{ sessionId: 'c2', origin: 'subagent', projections: { values: { subagent: { mode: 'one-shot' } } } },
				{ sessionId: 'plain' }
			]
		});
		await relay.rawListSessions();
		expect(relay.addressFor('c1')).toEqual({ kind: 'session', sessionId: 'c1' });
		expect(relay.addressFor('c2')).toEqual({ kind: 'session', sessionId: 'c2' });
		expect(relay.addressFor('plain')).toEqual({ kind: 'session', sessionId: 'plain' });
	});
});
describe('workspaceOwnerSessionId - the parent walk', () => {
	it('walks child to parent to root; a root resolves to itself', async () => {
		const { relay } = makeRelay({
			listItems: [
				{ sessionId: 'root', projections: { values: { title: 'R' } } },
				{ sessionId: 'mid', parentSessionId: 'root' },
				{ sessionId: 'leaf', parentSessionId: 'mid' }
			]
		});
		expect(await relay.workspaceOwnerSessionId('leaf')).toBe('root');
		expect(await relay.workspaceOwnerSessionId('root')).toBe('root');
	});

	it('a parent cycle terminates on the seen-set guard', async () => {
		const { relay } = makeRelay({
			listItems: [
				{ sessionId: 'a', parentSessionId: 'b' },
				{ sessionId: 'b', parentSessionId: 'a' }
			]
		});
		// The guard exits with the cursor back where the walk started ('a'),
		// never looping forever and never inventing a third session.
		expect(await relay.workspaceOwnerSessionId('a')).toBe('a');
	});
});

describe('history / pageCursorFor - the cursor fallback ladder', () => {
	const throughSeqOf = (payload: unknown) =>
		(payload as { request?: { throughSeq?: number } }).request?.throughSeq;

	it('a live follow-buffer cursor wins without a list call', async () => {
		const { relay, rpc, rpcCalls, bufferFor } = makeRelay({ lastSeq: 42 });
		await relay.history('s1');
		expect(bufferFor).toHaveBeenCalledWith('s1');
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(rpcCalls[0][0]).toBe(DSH_METHODS.page);
		expect(throughSeqOf(rpcCalls[0][1])).toBe(42);
	});

	it('a session without a buffer falls back to the list watermark', async () => {
		const { relay, rpcCalls } = makeRelay({
			lastSeq: -1,
			listItems: [
				{ sessionId: 'other', projections: { asOfSeq: 1 } },
				{ sessionId: 's1', projections: { asOfSeq: 7 } }
			]
		});
		await relay.history('s1');
		// rpcCalls[0] is the session/list probe; the page carries the cursor.
		expect(throughSeqOf(rpcCalls[rpcCalls.length - 1][1])).toBe(7);
	});

	it('no buffer and no readable watermark pages unconstrained (-1)', async () => {
		const { relay, rpcCalls } = makeRelay({
			lastSeq: -1,
			listItems: [{ sessionId: 's1', projections: { asOfSeq: -5 } }]
		});
		await relay.history('s1');
		expect(throughSeqOf(rpcCalls[rpcCalls.length - 1][1])).toBe(-1);
	});

	it('a subagent-hinted session pages with the parent-addressed form', async () => {
		const { relay, rpcCalls } = makeRelay({
			lastSeq: 3,
			listItems: [
				{
					sessionId: 'child',
					origin: 'subagent',
					parentSessionId: 'root',
					projections: { values: { subagent: { mode: 'one-shot' } } }
				}
			]
		});
		await relay.rawListSessions();
		await relay.history('child');
		const payload = rpcCalls[rpcCalls.length - 1][1] as { request?: { address?: Record<string, unknown> } };
		expect(payload.request?.address).toEqual({
			kind: 'subagent',
			parentSessionId: 'root',
			childSessionId: 'child',
			mode: 'one-shot'
		});
	});
});
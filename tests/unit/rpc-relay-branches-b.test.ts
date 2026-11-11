import { describe, expect, it, vi } from 'vitest';

import { RpcRelay } from '$lib/server/connection/rpc-relay';
import { DshRpcError, REMOTE_EVENT_RESULT_ENDPOINT } from '$lib/server/dsh-rpc';

// listPresets reads the operator's settings file live per call - mock it so
// the unit test pins only the relay's overlay plumbing (mapper slice B).
vi.mock('$lib/server/insight-config', () => ({
	readDshPresetEnglishConfig: vi.fn(() => ({ presetEnglish: true }))
}));

/**
 * Branch-coverage batch B for RpcRelay's second half (src lines ~650-1288):
 * directory/pick normalization junk arms, page adaptation, prompt payload
 * arms, schedule shelf miss paths, the lazy job-follow relay, respond()'s
 * value arms and gateway retry, fetchHostPath's 401 re-mint, ledger resync,
 * and teardown. Conventions follow jobs-relay.test.ts /
 * job-roster-mirror.test.ts (fake conn, no network, no src edits).
 */

function makeConn() {
	const logs: unknown[][] = [];
	const followBufs = new Map<string, { entries: unknown[]; lastSeq: number; coverageFloor: number }>();
	const conn = {
		log: (...a: unknown[]) => logs.push(a),
		rpc: vi.fn(async () => ({})),
		rpcIdFactory: () => 'req-1',
		baseUrl: 'http://host.test',
		fetchFn: vi.fn(async () => new Response(null, { status: 200 })),
		auth: {
			ensureCookie: vi.fn(async () => null as string | null),
			invalidate: vi.fn()
		},
		sessions: {
			bufferFor: (sessionId: string) => {
				let buf = followBufs.get(sessionId);
				if (buf === undefined) {
					buf = { entries: [], lastSeq: -1, coverageFloor: -1 };
					followBufs.set(sessionId, buf);
				}
				return buf;
			}
		},
		disposed: false,
		downlinks: {
			generation: 2,
			eventClientId: 'gen-1' as string | null,
			openJobFollowStream: vi.fn(),
			closeJobFollowStream: vi.fn(),
			cancelReconnect: vi.fn(),
			teardownSockets: vi.fn(),
			ensureDownlinks: vi.fn(),
			waitForProjections: vi.fn(async () => null)
		}
	};
	const relay = new RpcRelay(conn as unknown as DshConnection, () => 10, {
		answerReapGraceMs: 1_000,
		staleGenerationRetryMs: 60
	});
	const opens: string[] = [];
	const closes: string[] = [];
	relay.wireJobRosterTransport({
		open: (sessionId: string) => opens.push(sessionId),
		close: (sessionId: string) => closes.push(sessionId)
	});
	return { relay, conn, logs, opens, closes };
}

describe('listDirectory - conservative normalize arms', () => {
	it('drops garbage rows, coerces hidden, and empties non-array collections', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce({
			path: 42, // non-string -> ''
			home: undefined, // absent -> ''
			crumbs: 'not-an-array', // non-array -> []
			entries: [
				'junk-string', // non-object -> dropped
				null, // null -> dropped
				{ name: 'only-name' }, // missing path -> dropped
				{ path: '/x' }, // missing name -> dropped
				{ name: 'a.txt', path: '/x/a.txt' }, // hidden coerces to false
				{ name: '.b', path: '/x/.b', hidden: true }, // hidden true kept
				{ name: 'c', path: '/x/c', hidden: 'yes' } // hidden !== true -> false
			],
			truncated: 1 // not === true -> false
		});
		expect(await relay.listDirectory('/x')).toEqual({
			path: '',
			home: '',
			crumbs: [],
			entries: [
				{ name: 'a.txt', path: '/x/a.txt', hidden: false },
				{ name: '.b', path: '/x/.b', hidden: true },
				{ name: 'c', path: '/x/c', hidden: false }
			],
			truncated: false
		});
	});

	it('passes a clean listing through verbatim with truncated=true', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce({
			path: '/home',
			home: '/home',
			crumbs: [{ name: 'home', path: '/home', hidden: false }],
			entries: [{ name: 'proj', path: '/home/proj', hidden: false }],
			truncated: true
		});
		expect(await relay.listDirectory()).toEqual({
			path: '/home',
			home: '/home',
			crumbs: [{ name: 'home', path: '/home', hidden: false }],
			entries: [{ name: 'proj', path: '/home/proj', hidden: false }],
			truncated: true
		});
	});
});

describe('pickDirectory - bare-string wire truth', () => {
	it('passes a non-empty picked path through; empty and non-string cancel to null', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce('/picked/dir');
		expect(await relay.pickDirectory()).toEqual({ path: '/picked/dir' });
		conn.rpc.mockResolvedValueOnce('');
		expect(await relay.pickDirectory()).toEqual({ path: null });
		conn.rpc.mockResolvedValueOnce(null);
		expect(await relay.pickDirectory()).toEqual({ path: null });
	});

	it('forwards the caller-owned abort signal to the transport', async () => {
		const { relay, conn } = makeConn();
		const controller = new AbortController();
		conn.rpc.mockResolvedValueOnce('/p');
		await relay.pickDirectory(controller.signal);
		expect(conn.rpc).toHaveBeenCalledTimes(1);
		expect(conn.rpc.mock.calls[0][2]).toBe(controller.signal);
	});
});

describe('page adaptation (pageAsHistory via historyPage/history)', () => {
	it('records non-array -> empty events; hasMore only when strictly true; projections passthrough', async () => {
		const { relay, conn } = makeConn();
		conn.sessions.bufferFor('s1').lastSeq = 7; // live cursor wins - no list RPC
		conn.rpc.mockResolvedValueOnce({
			records: 'not-an-array',
			hasMore: 'yes',
			projections: { permissions: { mode: 'default' } }
		});
		const page = await relay.historyPage('s1', 50);
		expect(page.events).toEqual([]);
		expect(page.hasMore).toBe(false);
		expect(page.projections).toEqual({ permissions: { mode: 'default' } });
		expect(conn.rpc).toHaveBeenCalledTimes(1); // page only, no session/list probe
	});

	it('omits projections when the page carries none, and keeps real events', async () => {
		const { relay, conn } = makeConn();
		conn.sessions.bufferFor('s1').lastSeq = 7;
		conn.rpc.mockResolvedValueOnce({
			records: [{ type: 'event', event: { type: 'message', seq: 3, time: 5 } }],
			hasMore: true
		});
		const page = await relay.historyPage('s1', 9);
		expect(page.events).toEqual([{ event: { type: 'message', seq: 3, time: 5, data: undefined } }]);
		expect(page.hasMore).toBe(true);
		expect('projections' in page).toBe(false);
	});

	// The cursor fallback ladder (list watermark, unconstrained -1) and the
	// subagent-addressed page form are pinned in rpc-relay-branches-a.test.ts
	// ('history / pageCursorFor') — not duplicated here.
});

describe('unary forwards - arg-building arms', () => {
	it('createSession: workspaceId beats cwd; cwd alone; neither -> {}; agentPreset optional', async () => {
		const { relay, conn } = makeConn();
		await relay.createSession('/a', 'preset-x', 'ws-1');
		const wsArgs = JSON.stringify(conn.rpc.mock.calls[0][1]);
		expect(wsArgs).toContain('ws-1');
		expect(wsArgs).not.toContain('/a');
		expect(wsArgs).toContain('preset-x');

		await relay.createSession('/b', undefined, undefined);
		const cwdArgs = JSON.stringify(conn.rpc.mock.calls[1][1]);
		expect(cwdArgs).toContain('/b');
		expect(cwdArgs).not.toContain('agentPreset');

		await relay.createSession();
		const bare = JSON.stringify(conn.rpc.mock.calls[2][1]);
		expect(bare).not.toContain('cwd');
		expect(bare).not.toContain('agentPreset');
	});

	it('forkSession: atSeq omitted entirely when undefined', async () => {
		const { relay, conn } = makeConn();
		await relay.forkSession('s1');
		expect(JSON.stringify(conn.rpc.mock.calls[0][1])).not.toContain('atSeq');
		await relay.forkSession('s1', 12);
		expect(JSON.stringify(conn.rpc.mock.calls[1][1])).toContain('"atSeq":12');
	});

	it('listPresets: presets-not-array -> empty; overlay flag plumbed to the normalizer', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce({ presets: 'garbage' });
		expect(await relay.listPresets()).toEqual({ presets: [] });
		conn.rpc.mockResolvedValueOnce({ presets: [] });
		expect(await relay.listPresets()).toEqual({ presets: [] });
		expect(conn.rpc).toHaveBeenLastCalledWith('agentPresets/list', expect.anything());
	});

	it('prompt: string payload wraps one text part; content array passes verbatim; mode defaults to queue', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValue({ accepted: true });
		await relay.prompt('s1', 'hello');
		let [method, args] = conn.rpc.mock.calls[0];
		expect(method).toBe('session/prompt');
		const req = args.request;
		expect(req.content).toEqual([{ type: 'text', text: 'hello' }]);
		expect(req.mode).toBe('queue');
		expect(req.sessionId).toBe('s1');
		expect(typeof req.requestId).toBe('string');
		expect(typeof req.clientTimeZone).toBe('string');

		const content = [
			{ type: 'image' as const, source: {} as never },
			{ type: 'text' as const, text: 'with image' }
		];
		await relay.prompt('s1', content, 'steer');
		[method, args] = conn.rpc.mock.calls[1];
		expect(args.request.content).toBe(content); // verbatim passthrough, same reference
		expect(args.request.mode).toBe('steer');
	});

	it('executeCommand: an admission miss (undefined) normalizes to null', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce(undefined);
		expect(await relay.executeCommand('s1', '/nope')).toBeNull();
		conn.rpc.mockResolvedValueOnce({ ok: false, line: '/nope' });
		expect(await relay.executeCommand('s1', '/nope')).toEqual({ ok: false, line: '/nope' });
	});
});

describe('schedule shelf - miss paths and junk rows', () => {
	it('listScheduledTasks skips junk rows and empties non-array pages', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce({
			items: [null, 'junk', { id: '', status: 'active' }, { id: 't1', status: 'teleported' }, { id: 't2', status: 'paused' }]
		});
		expect(await relay.listScheduledTasks()).toEqual([
			expect.objectContaining({ id: 't2', status: 'paused', title: '' })
		]);
		conn.rpc.mockResolvedValueOnce({ items: 'garbage' });
		expect(await relay.listScheduledTasks()).toEqual([]);
	});

	it('viewScheduledTask: not-found code -> null; non-object -> null; valid flat row normalizes', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce({ id: 't1', code: 'schedule_not_found' });
		expect(await relay.viewScheduledTask('t1')).toBeNull();
		conn.rpc.mockResolvedValueOnce(null);
		expect(await relay.viewScheduledTask('t1')).toBeNull();
		conn.rpc.mockResolvedValueOnce({
			id: 't2',
			title: 'Nightly',
			status: 'active',
			target: { kind: 'session', sessionId: '' }, // empty string -> null sessionId
			lastDelivery: { deliveredAt: '2026-01-01T00:00:00Z' } // targetSessionId null
		});
		expect(await relay.viewScheduledTask('t2')).toEqual({
			id: 't2',
			title: 'Nightly',
			status: 'active',
			kind: null,
			scheduledAt: null,
			targetKind: 'session',
			targetSessionId: null,
			lastDelivery: { deliveredAt: '2026-01-01T00:00:00Z', targetSessionId: null }
		});
	});

});

describe('model catalog normalization', () => {
	it('selectModel: garbage selection -> null; effort optional in args and result', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce({ selected: { provider: 1, model: 'm' } });
		expect(await relay.selectModel('s1', 'p', 'm')).toBeNull();
		conn.rpc.mockResolvedValueOnce({ selected: { provider: 'p', model: 'm' } });
		expect(await relay.selectModel('s1', 'p', 'm')).toEqual({ provider: 'p', model: 'm' });
		expect(JSON.stringify(conn.rpc.mock.calls[1][1])).not.toContain('reasoningEffort');
		conn.rpc.mockResolvedValueOnce({ selected: { provider: 'p', model: 'm', reasoningEffort: 'high' } });
		expect(await relay.selectModel('s1', 'p', 'm', 'high')).toEqual({
			provider: 'p',
			model: 'm',
			reasoningEffort: 'high'
		});
		expect(JSON.stringify(conn.rpc.mock.calls[2][1])).toContain('"reasoningEffort":"high"');
	});

	it('listModels: garbage catalog -> honest empty; default arm seeds current', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockResolvedValueOnce('junk');
		expect(await relay.listModels('s1')).toEqual({ current: null, routable: false, groups: [], failures: [] });
		conn.rpc.mockResolvedValueOnce({ default: { provider: 'p', model: 'm' }, groups: [], failures: [] });
		const dir = await relay.listModels('s1');
		expect(dir.current).toEqual({ provider: 'p', model: 'm' });
		expect(dir.routable).toBe(true); // no routableProviders list -> default true
	});
});

describe('job follow relay (lazy singleton)', () => {
	it('idle relay answers honestly and demux calls are no-ops', () => {
		const { relay } = makeConn();
		expect(relay.jobFollowOwners()).toEqual([]);
		expect(relay.jobFollowJobsOf('s1')).toEqual([]);
		expect(() => relay.onJobFollowItem('s1', 'j1', { type: 'output', chunks: ['x'] })).not.toThrow();
		expect(() => relay.onJobFollowStreamError('s1', 'j1', 'code', 'msg')).not.toThrow();
	});

	it('subscribes sinks, fans frames out, and closes the host stream on last unsubscribe', () => {
		const { relay, conn } = makeConn();
		const seen: unknown[] = [];
		const off = relay.subscribeJobFollow('s1', 'j1', (e: unknown) => seen.push(e));
		const off2 = relay.subscribeJobFollow('s1', 'j1', (e: unknown) => seen.push(e));
		expect(conn.downlinks.openJobFollowStream).toHaveBeenCalledTimes(1);
		expect(relay.jobFollowOwners()).toEqual(['s1']);
		expect(relay.jobFollowJobsOf('s1')).toEqual(['j1']);

		relay.onJobFollowItem('s1', 'j1', { type: 'output', chunks: [{ text: 'hi' }], next: 2 });
		expect(seen).toEqual([
			{ type: 'output', text: 'hi', next: 2 },
			{ type: 'output', text: 'hi', next: 2 } // both sinks fan out
		]);
		relay.onJobFollowStreamError('s1', 'j1', 'gateway/x', 'boom');
		expect(seen[2]).toEqual({ type: 'error', code: 'gateway/x', message: 'boom' });
		expect(seen[3]).toEqual({ type: 'error', code: 'gateway/x', message: 'boom' });

		off();
		expect(conn.downlinks.closeJobFollowStream).not.toHaveBeenCalled(); // still one sink left
		off2();
		expect(conn.downlinks.closeJobFollowStream).toHaveBeenCalledWith('s1', 'j1');
		expect(relay.jobFollowOwners()).toEqual([]);
	});
});

describe('roster mirror - remaining arms', () => {
	it('accepts a bare-array whole-set frame (not only {jobs})', () => {
		const { relay } = makeConn();
		const seen: unknown[] = [];
		relay.onJobRoster((_s: string, jobs: readonly unknown[]) => seen.push(jobs.length));
		relay.onJobRosterItem('s1', [{ id: 'bash-1' }]);
		expect(relay.jobRosterSnapshot('s1')).toEqual({ jobs: [{ id: 'bash-1' }], pending: false });
		expect(seen).toEqual([1]);
	});

	it('an empty-session stream error logs nothing and self-heals the open latch', () => {
		const { relay, logs, opens } = makeConn();
		relay.touchJobRoster('s1');
		relay.onJobRosterStreamError('s1', 'gateway/x', 'boom'); // logs once, clears latch
		relay.onJobRosterStreamError('', undefined, undefined); // early arm: no log
		const mirrorLogs = logs.filter((l: unknown[]) => String(l[0]).includes('job/list stream failed'));
		expect(mirrorLogs).toHaveLength(1);
		relay.touchJobRoster('s1'); // self-heal: the latch is cleared -> reopen
		expect(opens).toEqual(['s1', 's1']);
	});

	it('reapJobRosters disarms its interval once no session is watched', () => {
		const { relay } = makeConn();
		relay.jobRosterGraceMs = 5_000;
		relay.touchJobRoster('s1');
		relay.reapJobRosters(1_000_000); // far future -> everything reaped
		expect(relay.jobRosterSnapshot('s1').pending).toBe(true);
		expect(() => relay.reapJobRosters(1_000_001)).not.toThrow(); // timer disarmed branch
	});
});

describe('respond - value-shape arms', () => {
	it('throws honestly when no $events generation exists', async () => {
		const { relay, conn } = makeConn();
		conn.downlinks.eventClientId = null;
		await expect(relay.respond('e1', { outcome: 'rejected' })).rejects.toThrow(
			'no $events generation to answer through yet'
		);
		expect(conn.rpc).not.toHaveBeenCalled();
	});

	it('outcome arm: sends the bare outcome string and withdraws the pending', async () => {
		const { relay, conn } = makeConn();
		relay.registerPending({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1' }, 'e1');
		const receipt = await relay.respond('e1', { outcome: 'rejected' });
		expect(receipt).toEqual({ accepted: true });
		const [method, payload] = conn.rpc.mock.calls[0];
		expect(method).toBe(REMOTE_EVENT_RESULT_ENDPOINT);
		expect(payload).toMatchObject({
			clientId: 'gen-1',
			eventId: 'e1',
			outcome: { kind: 'result', value: 'rejected' }
		});
		expect(relay.pendingFor('s1')).toEqual([]);
		expect(relay.settlementsFor('s1')).toEqual([expect.objectContaining({ rpcId: 'e1', outcome: 'rejected' })]);
	});

	it('answer arm unwraps the panel wrapper; answers arm wraps verbatim', async () => {
		const { relay, conn } = makeConn();
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'q1');
		await relay.respond('q1', { answer: { answers: [{ id: 'x', selected: ['a'] }] } });
		expect(conn.rpc.mock.calls[0][1]).toMatchObject({
			outcome: { kind: 'result', value: { answers: [{ id: 'x', selected: ['a'] }] } }
		});
		relay.registerPending({ type: 'question/requested', sessionId: 's1' }, 'q2');
		await relay.respond('q2', { answers: [{ id: 'y', selected: [] }] });
		expect(conn.rpc.mock.calls[1][1]).toMatchObject({
			outcome: { kind: 'result', value: { answers: [{ id: 'y', selected: [] }] } }
		});
	});

	it('fallback arm: an unrecognized payload passes through as the value', async () => {
		const { relay, conn } = makeConn();
		await relay.respond('q3', { custom: 'thing' });
		expect(conn.rpc.mock.calls[0][1]).toMatchObject({
			outcome: { kind: 'result', value: { custom: 'thing' } }
		});
	});

	it('not-pending refusal is an idempotent no-op receipt, not a throw', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockRejectedValueOnce(new DshRpcError('not-pending', 'already settled'));
		expect(await relay.respond('e9', { outcome: 'allowed-once' })).toEqual({
			accepted: false,
			reason: 'not-pending'
		});
	});

	it('gateway/internal with a dead stream retries on a rebuilt generation', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockImplementationOnce(async () => {
			// the rebuild completes WHILE refreshEventGeneration polls for it
			setTimeout(() => {
				conn.downlinks.eventClientId = 'gen-2';
			}, 30);
			throw new DshRpcError('gateway/internal', 'no active event stream');
		});
		const receipt = await relay.respond('e2', { outcome: 'rejected' });
		expect(receipt).toEqual({ accepted: true });
		expect(conn.downlinks.cancelReconnect).toHaveBeenCalled();
		expect(conn.downlinks.teardownSockets).toHaveBeenCalled();
		expect(conn.downlinks.ensureDownlinks).toHaveBeenCalled();
		expect(conn.rpc).toHaveBeenCalledTimes(2);
		expect(conn.rpc.mock.calls[1][1]).toMatchObject({ clientId: 'gen-2', eventId: 'e2' });
	});

	it('gateway/internal with a stalled rebuild rethrows after the deadline', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockRejectedValueOnce(new DshRpcError('gateway/internal', 'no active event stream'));
		await expect(relay.respond('e3', { outcome: 'rejected' })).rejects.toBeInstanceOf(DshRpcError);
		expect(conn.rpc).toHaveBeenCalledTimes(1); // no retry - clientId never moved
	});

	it('a non-DshRpcError failure rethrows untouched', async () => {
		const { relay, conn } = makeConn();
		conn.rpc.mockRejectedValueOnce(new Error('transport down'));
		await expect(relay.respond('e4', { outcome: 'rejected' })).rejects.toThrow('transport down');
	});
});

describe('fetchHostPath - 401 re-mint ladder', () => {
	it('retries once after invalidating on a 401, carrying the minted cookie', async () => {
		const { relay, conn } = makeConn();
		conn.auth.ensureCookie
			.mockResolvedValueOnce('stale-cookie')
			.mockResolvedValueOnce('fresh-cookie');
		conn.fetchFn
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));
		const res = await relay.fetchHostPath('/api/host/path');
		expect(res.status).toBe(200);
		expect(conn.auth.invalidate).toHaveBeenCalledTimes(1);
		expect(conn.fetchFn).toHaveBeenCalledTimes(2);
		expect(conn.fetchFn.mock.calls[0][0]).toBe('http://host.test/api/host/path');
		expect((conn.fetchFn.mock.calls[0][1] as RequestInit).headers).toEqual({ cookie: 'stale-cookie' });
		expect((conn.fetchFn.mock.calls[1][1] as RequestInit).headers).toEqual({ cookie: 'fresh-cookie' });
	});

	it('a first-shot success never invalidates and omits the header when no cookie exists', async () => {
		const { relay, conn } = makeConn();
		conn.fetchFn.mockResolvedValueOnce(new Response('fine', { status: 200 }));
		const controller = new AbortController();
		const res = await relay.fetchHostPath('/x', controller.signal);
		expect(res.status).toBe(200);
		expect(conn.auth.invalidate).not.toHaveBeenCalled();
		expect(conn.fetchFn).toHaveBeenCalledTimes(1);
		const init = conn.fetchFn.mock.calls[0][1] as RequestInit;
		expect(init.headers).toEqual({});
		expect(init.signal).toBe(controller.signal);
	});
});

describe('resyncFromLedger - ring replacement', () => {
	it('replaces the buffer with the page tail, honoring ring capacity', async () => {
		const { conn } = makeConn();
		const small = new RpcRelay(conn as unknown as DshConnection, () => 1, {
			answerReapGraceMs: 1_000,
			staleGenerationRetryMs: 1_000
		});
		conn.rpc
			.mockResolvedValueOnce({ items: [{ sessionId: 's1', projections: { asOfSeq: 8 } }] })
			.mockResolvedValueOnce({
				records: [
					{ type: 'event', event: { type: 'message', seq: 9, time: 1 } },
					{ type: 'event', event: { type: 'message', seq: 10, time: 2 } }
				],
				hasMore: true
			});
		const entries = await small.resyncFromLedger('s1');
		const buf = conn.sessions.bufferFor('s1');
		expect(buf.entries).toEqual([{ type: 'message', seq: 10, time: 2, data: undefined }]);
		expect(entries).toBe(buf.entries);
		expect(buf.lastSeq).toBe(10);
		expect(buf.coverageFloor).toBe(10);
	});

	it('an empty page leaves lastSeq and coverageFloor at -1 honestly', async () => {
		const { relay, conn } = makeConn();
		conn.sessions.bufferFor('s1').lastSeq = 5; // live cursor path
		conn.rpc.mockResolvedValueOnce({ records: [], hasMore: false });
		const entries = await relay.resyncFromLedger('s1');
		expect(entries).toEqual([]);
		const buf = conn.sessions.bufferFor('s1');
		expect(buf.lastSeq).toBe(-1);
		expect(buf.coverageFloor).toBe(-1);
	});
});

describe('dispose - transient registries never leak', () => {
	it('clears pending and settled registries and the reap timer', () => {
		vi.useFakeTimers();
		try {
			const { relay } = makeConn();
			relay.registerPending({ type: 'approval/requested', sessionId: 's1' }, 'e1');
			relay.withdrawPending('e1', 'rejected');
			relay.armAnswerReap();
			relay.dispose();
			expect(relay.pendingFor('s1')).toEqual([]);
			expect(relay.settlementsFor('s1')).toEqual([]);
			vi.advanceTimersByTime(5_000); // cleared timer fires nothing
			expect(relay.pendingFor('s1')).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});
});

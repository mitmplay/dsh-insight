/**
 * api-dsh unit tests (paired with task 2.1).
 *
 * The routes are thin: they translate DshConnection results into HTTP
 * responses. A fake connection object is monkey-patched over the
 * module-level singleton getter so each route runs against scripted
 * behavior — no live host (BC-8 spirit), no cross-module coupling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The connection methods api-dsh touches. */
interface FakeApi {
	listSessions: () => Promise<unknown>;
	eventsSince: (id: string, n: number) => unknown;
	/** 0.1.3-alpha.1 — the live assistant-stream tail on every poll. */
	liveAssistantStream: (id: string) => unknown;
	ensureDownlinks: () => void;
	subscribe: (id: string) => void;
	projectionValue: (id: string, key: string) => unknown;
	prompt: (id: string, payload: string | unknown[]) => Promise<unknown>;
	cancel: (id: string) => Promise<unknown>;
	createSession: (cwd?: string, agentPreset?: string) => Promise<unknown>;
	createWorkspace: (path: string) => Promise<unknown>;
	/** Chip Menu ADR D3 — the two registry verbs. */
	renameWorkspace: (workspaceId: string, title: string) => Promise<unknown>;
	deleteWorkspace: (workspaceId: string) => Promise<unknown>;
	listWorkspaces: () => Promise<unknown>;
	listDirectory: (path?: string) => Promise<unknown>;
	pickDirectory: (signal?: AbortSignal) => Promise<unknown>;
	readAttachment: (id: string, ref: Record<string, unknown>) => Promise<unknown>;
	listPresets: () => Promise<unknown>;
	historyPage: (id: string, beforeSeq: number) => Promise<unknown>;
	/** POC-3 W1 — answerer registry reads + respond forward. */
	pendingFor: (id: string) => unknown[];
	settlementsFor: (id: string) => unknown[];
	pruneSettlements: (id: string, rpcIds: string[]) => void;
	respond: (rpcId: string, payload: Record<string, unknown>) => Promise<unknown>;
	/** POC-3 W3 — talk-back forwards. */
	renameSession: (id: string, title: string) => Promise<unknown>;
	/** The Fork Button ADR (2026-09-01) — the fork forward. */
	forkSession?: (id: string, atSeq?: number) => Promise<unknown>;
	listModels: (id: string) => Promise<unknown>;
	selectModel: (id: string, provider: string, model: string, effort?: string) => Promise<unknown>;
	/** ADR-0007 — the full=1 resync branch's history tail + running truth. */
	history?: (id: string) => Promise<unknown>;
	isRunning?: (id: string) => boolean;
	/** 2026-08-25 fix — the native command wire (commands/execute). */
	executeCommand?: (id: string, line: string) => Promise<unknown>;
	/** Slash Menu W1 — the two catalog legs (commands/list + skills/list). */
	listCommands?: (id: string) => Promise<unknown>;
	listSkills?: (id: string) => Promise<unknown>;
}

let fake: FakeApi;

/** DshRpcError class from the live module instance (instanceof-safe). */
let DshRpcError: typeof import('$lib/server/dsh-rpc').DshRpcError;

/** Minimal RequestEvent double — routes read only these members. */
function mkEvent(e: Record<string, unknown>): never {
	return { setHeaders: () => {}, ...e } as never;
}

/**
 * Fresh import of every route module with the connection getter patched on the
 * SAME module instance the routes will bind to (resetModules first, then both
 * the spy target and the routes import the new instance).
 */
async function importRoutesFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	DshRpcError = (await import('$lib/server/dsh-rpc')).DshRpcError;
	const sessions = await import('../../src/routes/api/dsh/sessions/+server');
	const events = await import('../../src/routes/api/dsh/session/[sessionId]/events/+server');
	const prompt = await import('../../src/routes/api/dsh/session/[sessionId]/prompt/+server');
	const cancel = await import('../../src/routes/api/dsh/session/[sessionId]/cancel/+server');
	const presets = await import('../../src/routes/api/dsh/presets/+server');
	const history = await import('../../src/routes/api/dsh/session/[sessionId]/history/+server');
	const respond = await import('../../src/routes/api/dsh/session/[sessionId]/respond/+server');
	const rename = await import('../../src/routes/api/dsh/session/[sessionId]/rename/+server');
	const fork = await import('../../src/routes/api/dsh/session/[sessionId]/fork/+server');
	const models = await import('../../src/routes/api/dsh/session/[sessionId]/models/+server');
	const selectModel = await import('../../src/routes/api/dsh/session/[sessionId]/select-model/+server');
	const workspaces = await import('../../src/routes/api/dsh/workspaces/+server');
	const wsRename = await import('../../src/routes/api/dsh/workspaces/[workspaceId]/rename/+server');
	const wsDelete = await import('../../src/routes/api/dsh/workspaces/[workspaceId]/delete/+server');
	const directory = await import('../../src/routes/api/dsh/directory/+server');
	const pickDirectory = await import('../../src/routes/api/dsh/pick-directory/+server');
	const permission = await import('../../src/routes/api/dsh/session/[sessionId]/permission/+server');
	const attachment = await import('../../src/routes/api/dsh/session/[sessionId]/attachment/+server');
	const catalog = await import('../../src/routes/api/dsh/session/[sessionId]/catalog/+server');
	const command = await import('../../src/routes/api/dsh/session/[sessionId]/command/+server');
	return { sessions, events, prompt, cancel, presets, history, respond, rename, fork, models, selectModel, workspaces, wsRename, wsDelete, directory, pickDirectory, permission, attachment, catalog, command };
}

beforeEach(() => {
	fake = {
		listSessions: async () => ({ items: [] }),
		eventsSince: () => ({ events: [], lastSeq: -1, running: false, gap: false }),
		liveAssistantStream: () => null,
		ensureDownlinks: () => {},
		subscribe: () => {},
		projectionValue: () => undefined,
		prompt: async () => ({ accepted: true }),
		cancel: async () => ({ accepted: true }),
		createSession: async () => ({ sessionId: 'new-1', agentPreset: 'research' }),
		createWorkspace: async () => ({
			workspace: { workspaceId: 'ws-1', path: '/tmp/x', title: 'x', sessionIds: [], createdAt: 't', updatedAt: 't' },
			created: true
		}),
		listWorkspaces: async () => ({ items: [] }),
		renameWorkspace: async () => ({ workspace: { workspaceId: 'ws-1', title: 'Renamed Home', path: '/tmp/x' } }),
		deleteWorkspace: async () => ({ workspaceId: 'ws-1' }),
		pickDirectory: async () => ({ path: '/Users/x/proj' }),
		readAttachment: async () => ({
			attachment: { attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 96, width: 1, height: 1 },
			data: 'AAAA'
		}),
		listDirectory: async () => ({
			path: '/Users/x',
			home: '/Users/x',
			crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'Users', path: '/Users', hidden: false }, { name: 'x', path: '/Users/x', hidden: false }],
			entries: [{ name: 'proj', path: '/Users/x/proj', hidden: false }],
			truncated: false
		}),
		listPresets: async () => ({ presets: [] }),
		historyPage: async () => ({ events: [], hasMore: false }),
		pendingFor: () => [],
		settlementsFor: () => [],
		pruneSettlements: () => {},
		respond: async () => ({ accepted: true }),
		renameSession: async () => ({ title: 'T', seq: 1 }),
		forkSession: async () => ({ sessionId: 'child-1' }),
		listModels: async () => ({ current: null, routable: false, groups: [], failures: [] }),
		selectModel: async () => ({ provider: 'p', model: 'm' }),
		listCommands: async () => [],
		listSkills: async () => ({ skills: [] })
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/dsh/sessions', () => {
	it('returns 200 with normalized session rows, the workspace registry, and the preset catalog', async () => {
		fake.listSessions = async () => ({
			items: [
				{
					sessionId: 's1',
					title: 'Fix the parser',
					agentPreset: 'app-dev',
					running: true,
					blank: false,
					updatedAt: 1000
				}
			]
		});
		fake.listWorkspaces = async () => ({
			items: [{ workspaceId: 'w1', title: 'harness', path: '/h', sessionIds: ['s1'] }]
		});
		fake.listPresets = async () => ({
			presets: [{ id: 'main', name: 'Main', description: null, isDefault: true }]
		});
		const { sessions } = await importRoutesFresh();
		const res = await sessions.GET(undefined as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			sessions: Array<Record<string, unknown>>;
			workspaces?: unknown[];
			presets?: unknown[];
		};
		expect(body.ok).toBe(true);
		expect(body.sessions).toHaveLength(1);
		expect(body.sessions[0]).toMatchObject({ sessionId: 's1', title: 'Fix the parser', running: true });
		expect(body.workspaces).toEqual([{ workspaceId: 'w1', title: 'harness', path: '/h', sessionIds: ['s1'] }]);
		expect(body.presets).toEqual([{ id: 'main', name: 'Main', description: null, isDefault: true }]);
	});

	it('spine rows carry turns — present, absent-tolerant (2026-08-25 a2a watermark, Task 1.3)', async () => {
		fake.listSessions = async () => ({
			// normalized rows (the fake connection forwards as-is; the
			// normalizeSessionRow contract is pinned in dsh-connection.test.ts)
			items: [
				{ sessionId: 's-turns', title: null, agentPreset: null, running: false, blank: false, updatedAt: 1, workspace: null, turns: 9 },
			{ sessionId: 's-plain', title: null, agentPreset: null, running: false, blank: false, updatedAt: 1, workspace: null, turns: null },
			{ sessionId: 's-junk', title: null, agentPreset: null, running: false, blank: false, updatedAt: 1, workspace: null, turns: null }
			]
		});
		fake.listWorkspaces = async () => ({ items: [] });
		fake.listPresets = async () => ({ presets: [] });
		const { sessions } = await importRoutesFresh();
		const res = await sessions.GET(undefined as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sessions: Array<{ sessionId: string; turns: number | null }> };
		const byId = new Map(body.sessions.map((r) => [r.sessionId, r.turns]));
		expect(byId.get('s-turns')).toBe(9);
		expect(byId.get('s-plain')).toBeNull();
		expect(byId.get('s-junk')).toBeNull();
	});

	it('returns 503 host-unreachable when the transport throws', async () => {
		fake.listSessions = async () => {
			throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:3080');
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.GET(undefined as never);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('host-unreachable');
	});

	it('returns 502 with the host code for an RPC error (agent-busy)', async () => {
		fake.listSessions = async () => {
			throw new DshRpcError('session/agent-busy', 'an agent turn is already running');
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.GET(undefined as never);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/agent-busy');
	});
});

describe('GET /api/dsh/session/[sessionId]/events', () => {
	it('slices deltas since N and maps to PollResponse shape', async () => {
		fake.eventsSince = (_id, n) => ({
			events: [
				{ type: 'assistant/chunk', seq: n + 1, time: 5 },
				{ type: 'assistant/chunk', seq: n + 2, time: 6 }
			],
			lastSeq: n + 2,
			running: true
		});
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=10') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			entries: Array<{ kind: string; seq: number }>;
			lastSeq: number;
			running: boolean;
		};
		expect(body.ok).toBe(true);
		expect(body.entries.map((e) => e.seq)).toEqual([11, 12]);
		expect(body.entries.every((e) => e.kind === 'unknown-event')).toBe(true);
		expect(body.lastSeq).toBe(12);
		expect(body.running).toBe(true);
	});

	it('defaults since to -1 (everything the buffer holds) when absent', async () => {
		let seenSince = Number.NaN;
		fake.eventsSince = (_id, n) => {
			seenSince = n;
			return { events: [], lastSeq: -1, running: false };
		};
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events') })
		);
		expect(res.status).toBe(200);
		expect(seenSince).toBe(-1);
		const body = (await res.json()) as { entries: unknown[] };
		expect(body.entries).toEqual([]);
	});

	it('blank session: empty events, not an error', async () => {
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 'blank' }, url: new URL('http://dsi/events?since=0') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; entries: unknown[] };
		expect(body.ok).toBe(true);
		expect(body.entries).toEqual([]);
	});

	it('the live assistant-stream tail rides the delta (null when nothing is in flight)', async () => {
		fake.liveAssistantStream = () => ({
			id: 'a:4:2',
			turn: 4,
			step: 2,
			seq: 41,
			time: 50_020,
			text: 'Hel',
			reasoning: ''
		});
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=10') })
		);
		const body = (await res.json()) as { liveStream: Record<string, unknown> | null };
		expect(body.liveStream).toEqual({
			id: 'a:4:2',
			turn: 4,
			step: 2,
			seq: 41,
			time: 50_020,
			text: 'Hel',
			reasoning: ''
		});
	});

	it('a null live tail still rides the delta (the client clears its streaming bubble)', async () => {
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=10') })
		);
		const body = (await res.json()) as { liveStream: unknown };
		expect(body.liveStream).toBeNull();
	});
});

describe('POST /api/dsh/session/[sessionId]/prompt', () => {
	it('rejects empty text with 400 (validation, not transport)', async () => {
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', { method: 'POST', body: JSON.stringify({ text: '   ' }) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('empty-text');
	});

	it('rejects non-JSON bodies with 400', async () => {
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', { method: 'POST', body: 'not json' })
			})
		);
		expect(res.status).toBe(400);
	});

	it('returns the receipt only (BC-3 boundary)', async () => {
		let sent: { id: string; payload: unknown } | undefined;
		fake.prompt = async (id, payload) => {
			sent = { id, payload };
			return { accepted: true };
		};
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', { method: 'POST', body: JSON.stringify({ text: 'Hi' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; accepted: boolean };
		expect(body.ok).toBe(true);
		expect(body.accepted).toBe(true);
		expect(sent).toEqual({ id: 's1', payload: [{ type: 'text', text: 'Hi' }] });
	});

	it('emits images-first content for {text, images} (task 2.3)', async () => {
		let payload: unknown;
		fake.prompt = async (_id, p) => {
			payload = p;
			return { accepted: true };
		};
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', {
					method: 'POST',
					body: JSON.stringify({
						text: 'look',
						images: [{ mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }]
					})
				})
			})
		);
		expect(res.status).toBe(200);
		expect(payload).toEqual([
			{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'shot.png' },
			{ type: 'text', text: 'look' }
		]);
	});

	it('attachments-only send passes with empty text — content is exactly the image parts', async () => {
		let payload: unknown;
		fake.prompt = async (_id, p) => {
			payload = p;
			return { accepted: true };
		};
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', {
					method: 'POST',
					body: JSON.stringify({ text: '', images: [{ mediaType: 'image/gif', data: 'BBBB' }] })
				})
			})
		);
		expect(res.status).toBe(200);
		expect(payload).toEqual([{ type: 'image', mediaType: 'image/gif', data: 'BBBB' }]);
	});

	it('rejects an off-whitelist media type with 400 invalid-images', async () => {
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', {
					method: 'POST',
					body: JSON.stringify({ text: 'x', images: [{ mediaType: 'image/tiff', data: 'AAAA' }] })
				})
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid-images');
	});

	it('rejects missing/empty data and non-array images with 400 invalid-images', async () => {
		const { prompt } = await importRoutesFresh();
		for (const images of [
			[{ mediaType: 'image/png', data: '' }],
			[{ mediaType: 'image/png' }],
			'not-an-array'
		]) {
			const res = await prompt.POST(
				mkEvent({
					params: { sessionId: 's1' },
					request: new Request('http://dsi/prompt', {
						method: 'POST',
						body: JSON.stringify({ text: 'x', images })
					})
				})
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('invalid-images');
		}
	});

	it('rejects a body with neither text nor images with 400 empty-text', async () => {
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', { method: 'POST', body: JSON.stringify({}) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('empty-text');
	});

	it('maps agent-busy to 502 with code (UI unlocks on this shape)', async () => {
		fake.prompt = async () => {
			throw new DshRpcError('session/agent-busy', 'turn already running');
		};
		const { prompt } = await importRoutesFresh();
		const res = await prompt.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/prompt', { method: 'POST', body: JSON.stringify({ text: 'Hi' }) })
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/agent-busy');
	});
});

describe('POST /api/dsh/session/[sessionId]/permission (ADR-0007 R5, fixed 2026-08-25 — the native command wire)', () => {
	it('executes the line verbatim through commands/execute — never session.prompt', async () => {
		let executed: { id: string; line: string } | undefined;
		let prompted = false;
		fake.executeCommand = async (id, line) => {
			executed = { id, line };
			return { commandId: 'cmd-1', result: { kind: 'success', text: 'preset read-only' } };
		};
		fake.prompt = async () => {
			prompted = true;
			return { accepted: true };
		};
		const { permission } = await importRoutesFresh();
		const res = await permission.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/permission', { method: 'POST', body: JSON.stringify({ line: '/permission read-only' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; accepted: boolean; commandId: string; text: string };
		expect(body.ok).toBe(true);
		expect(body.accepted).toBe(true);
		expect(body.commandId).toBe('cmd-1');
		expect(body.text).toBe('preset read-only');
		expect(executed).toEqual({ id: 's1', line: '/permission read-only' });
		expect(prompted).toBe(false);
	});

	it('rejects empty lines and non-/permission commands with 400', async () => {
		const { permission } = await importRoutesFresh();
		for (const line of ['   ', '/new', '/permissionx read-only']) {
			const res = await permission.POST(
				mkEvent({
					params: { sessionId: 's1' },
					request: new Request('http://dsi/permission', { method: 'POST', body: JSON.stringify({ line }) })
				})
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(['empty-line', 'bad-command']).toContain(body.error.code);
		}
	});

	it('an admission miss (ok:true, no value) reports command-miss — the command never ran', async () => {
		fake.executeCommand = async () => null;
		const { permission } = await importRoutesFresh();
		const res = await permission.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/permission', { method: 'POST', body: JSON.stringify({ line: '/permission' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('command-miss');
	});

	it("the command's own error result (unknown preset) reports command-error verbatim", async () => {
		fake.executeCommand = async () => ({ commandId: 'cmd-2', result: { kind: 'error', text: 'unknown preset "x" (available: …)' } });
		const { permission } = await importRoutesFresh();
		const res = await permission.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/permission', { method: 'POST', body: JSON.stringify({ line: '/permission x' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('command-error');
		expect(body.error.message).toContain('unknown preset');
	});

	it('maps a transport/RPC rejection to 502 with the host code', async () => {
		fake.executeCommand = async () => {
			throw new DshRpcError('session/not-found', 'nope');
		};
		const { permission } = await importRoutesFresh();
		const res = await permission.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/permission', { method: 'POST', body: JSON.stringify({ line: '/permission read-only' }) })
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/not-found');
	});
});

describe('GET /api/dsh/session/[sessionId]/events?full=1 (ADR-0007 — permission rides the resync)', () => {
	it('carries the tail page\'s projections value + the raw knob events', async () => {
		fake.isRunning = () => false;
		fake.history = async () => ({
			events: [
				{ event: { type: 'permission/preset', seq: 2, time: 2, data: { preset: 'read-only' } } },
				{ event: { type: 'sandbox/mode', seq: 3, time: 3, data: { mode: 'read-only' } } },
				{ event: { type: 'approval/policy', seq: 4, time: 4, data: { policy: 'ask' } } }
			],
			hasMore: false,
			projections: {
				values: {
					title: 'Careful chat',
					permissions: {
						options: [{ value: 'read-only', name: 'read-only' }, { value: 'custom', name: 'Custom' }],
						currentValue: 'read-only'
					}
				}
			}
		});
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=-1&full=1') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			permission: { current: string; options: Array<{ value: string }> };
			knobEvents: Array<{ type: string }>;
		};
		expect(body.permission.current).toBe('read-only');
		expect(body.permission.options.map((o) => o.value)).toEqual(['read-only']); // custom filtered
		expect(body.knobEvents.map((e) => e.type)).toEqual(['permission/preset', 'sandbox/mode', 'approval/policy']);
	});

	it('a delta poll carries knobEvents (usually an empty array)', async () => {
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=5') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { knobEvents: unknown[] };
		expect(body.knobEvents).toEqual([]);
	});
});

describe('POST /api/dsh/session/[sessionId]/cancel', () => {
	it('returns the cancel receipt', async () => {
		let cancelled: string | undefined;
		fake.cancel = async (id) => {
			cancelled = id;
			return { accepted: true };
		};
		const { cancel } = await importRoutesFresh();
		const res = await cancel.POST(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { accepted: boolean };
		expect(body.accepted).toBe(true);
		expect(cancelled).toBe('s1');
	});

	it('maps transport failure to 503', async () => {
		fake.cancel = async () => {
			throw new Error('ECONNREFUSED');
		};
		const { cancel } = await importRoutesFresh();
		const res = await cancel.POST(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(503);
	});
});

describe('request contract — no-store', () => {
	it('events route sets cache-control: no-store', async () => {
		const { events } = await importRoutesFresh();
		const headers = new Map<string, string>();
		const res = await events.GET(
			mkEvent({
				params: { sessionId: 's1' },
				url: new URL('http://dsi/events'),
				setHeaders: (h: Record<string, string>) => Object.entries(h).forEach(([k, v]) => headers.set(k, v))
			})
		);
		expect(res.status).toBe(200);
		expect(headers.get('cache-control')).toBe('no-store');
	});
});

describe('GET /api/dsh/session/[sessionId]/events — POC-3 W1 answerer extension', () => {
	it('poll carries pendingAnswers + settledAnswers (additive, alongside the POC-2 shape)', async () => {
		fake.pendingFor = (id) =>
			id === 's1'
					? [
							{
								rpcId: 'rpc-a1',
								sessionId: 's1',
								kind: 'approval',
								body: { approvalId: 'apr-1', toolName: 'Bash', reason: 'rm -rf' },
								receivedAt: 1787260000000
							}
						]
					: [];
		fake.settlementsFor = (id) =>
			id === 's1'
					? [{ rpcId: 'rpc-q0', sessionId: 's1', kind: 'question', outcome: 'answered', settledAt: 1787260001000 }]
					: [];
		const { events } = await importRoutesFresh();
		const res = await events.GET(
				mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=0') })
			);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			entries: unknown[];
			lastSeq: number;
			running: boolean;
			pendingAnswers: Array<{ rpcId: string; kind: string }>;
			settledAnswers: Array<{ rpcId: string; outcome: string }>;
		};
		// POC-2 fields untouched
		expect(body.ok).toBe(true);
		expect(Array.isArray(body.entries)).toBe(true);
		expect(typeof body.lastSeq).toBe('number');
		expect(typeof body.running).toBe('boolean');
		// POC-3 additive fields present
		expect(body.pendingAnswers).toEqual([
			expect.objectContaining({ rpcId: 'rpc-a1', kind: 'approval' })
		]);
		expect(body.settledAnswers).toEqual([
			expect.objectContaining({ rpcId: 'rpc-q0', outcome: 'answered' })
		]);
	});

	it('forward-compat pin: with an empty registry the poll still serves the exact POC-2 body + empty arrays', async () => {
		const { events } = await importRoutesFresh();
		const res = await events.GET(
				mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=5') })
		);
		const body = (await res.json()) as Record<string, unknown>;
		// POC-2 delta shape (ok/entries/lastSeq/running/gap) + the additive
		// arrays (answerer fields, ADR-0007 knobEvents — usually empty) + the
		// 0.1.3 live tail (null while no attempt is in flight)
		expect(Object.keys(body).sort()).toEqual(
			['entries', 'gap', 'knobEvents', 'lastSeq', 'liveStream', 'ok', 'pendingAnswers', 'running', 'settledAnswers'].sort()
		);
		expect(body.gap).toBe(false);
		expect(body.pendingAnswers).toEqual([]);
		expect(body.settledAnswers).toEqual([]);
		expect(body.knobEvents).toEqual([]);
		expect(body.liveStream).toBeNull();
	});

	it('acked=rpcIds prunes delivered settlements before serving (ring, at-least-once)', async () => {
		let pruned: { id: string; rpcIds: string[] } | undefined;
		fake.settlementsFor = () => [{ rpcId: 'r2', sessionId: 's1', kind: 'approval', outcome: 'rejected', settledAt: 1 }];
		fake.pruneSettlements = (id, rpcIds) => {
			pruned = { id, rpcIds };
		};
		const { events } = await importRoutesFresh();
		const res = await events.GET(
				mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=0&acked=r1,r2') })
		);
		expect(res.status).toBe(200);
		expect(pruned).toEqual({ id: 's1', rpcIds: ['r1', 'r2'] });
	});
});

describe('POST /api/dsh/session/[sessionId]/respond (POC-3 W1 — BC-B)', () => {
	it('accepted arm → 200 {ok:true, accepted:true} (no reason field)', async () => {
		let sent: { rpcId: string; payload: Record<string, unknown> } | undefined;
		fake.respond = async (rpcId, payload) => {
			sent = { rpcId, payload };
			return { accepted: true };
		};
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
					params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', {
						method: 'POST',
					body: JSON.stringify({ rpcId: 'rpc-a1', payload: { approvalId: 'apr-1', outcome: 'allowed-once' } })
					})
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; accepted: boolean; reason?: string };
		expect(body).toEqual({ ok: true, accepted: true });
		expect('reason' in body).toBe(false);
		// the route injects the path sessionId into the payload
		expect(sent).toEqual({
			rpcId: 'rpc-a1',
			payload: { sessionId: 's1', approvalId: 'apr-1', outcome: 'allowed-once' }
		});
	});

	it('not-pending arm → 200 {ok:true, accepted:false, reason} — receipt ≠ error (BC-B)', async () => {
		fake.respond = async () => ({ accepted: false, reason: 'not-pending' });
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
					params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', {
						method: 'POST',
					body: JSON.stringify({ rpcId: 'rpc-late', payload: { approvalId: 'a', outcome: 'rejected' } })
					})
			})
		);
		expect(res.status).toBe(200); // ← NOT 502/409: the race loser settles gracefully
		const body = (await res.json()) as { ok: boolean; accepted: boolean; reason?: string };
		expect(body).toEqual({ ok: true, accepted: false, reason: 'not-pending' });
	});

	it('bad-response arm → 200 with honest reason', async () => {
		fake.respond = async () => ({ accepted: false, reason: 'bad-response' });
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
					params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', { method: 'POST', body: JSON.stringify({ rpcId: 'r', payload: { junk: 1 } }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { accepted: boolean; reason?: string };
		expect(body.accepted).toBe(false);
		expect(body.reason).toBe('bad-response');
	});

	it('transport-down → 503 host-unreachable (card stays answerable)', async () => {
		fake.respond = async () => {
			throw new Error('fetch failed: ECONNREFUSED');
		};
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
					params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', { method: 'POST', body: JSON.stringify({ rpcId: 'r', payload: {} }) })
			})
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('host-unreachable');
	});

	it('missing rpcId → 400 bad-rpcId', async () => {
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
					params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', { method: 'POST', body: JSON.stringify({ payload: {} }) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-rpcId');
	});

	it('non-object payload → 400 bad-payload', async () => {
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
					params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', { method: 'POST', body: JSON.stringify({ rpcId: 'r', payload: 'nope' }) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-payload');
	});

	it('non-JSON body → 400 bad-json', async () => {
		const { respond } = await importRoutesFresh();
		const res = await respond.POST(
				mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/respond', { method: 'POST', body: 'garbage' })
			})
		);
		expect(res.status).toBe(400);
	});
});

describe('POST /api/dsh/sessions (W3 — create)', () => {
	it('creates a session and returns the session id (200)', async () => {
		fake.createSession = async (_cwd?: string, preset?: string) => {
			expect(preset).toBe('research');
			return { sessionId: 'created-9', agentPreset: 'research' };
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({ agentPreset: 'research' }) }) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; sessionId: string; agentPreset: string | null };
		expect(body).toEqual({ ok: true, sessionId: 'created-9', agentPreset: 'research' });
	});

	it('creates without a preset when the body omits it (default preset)', async () => {
		fake.createSession = async (_cwd?: string, preset?: string) => {
			expect(preset).toBeUndefined();
			return { sessionId: 'created-plain' };
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({}) }) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; sessionId: string };
		expect(body).toEqual({ ok: true, sessionId: 'created-plain', agentPreset: null });
	});

	it('rejects non-JSON bodies with 400', async () => {
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: 'not-json' }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-json');
	});

	it('rejects a non-string agentPreset with 400 (validation, not transport)', async () => {
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({ agentPreset: 42 }) }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-preset');
	});

	it('maps an RPC error (unknown preset) to 502 with the host code', async () => {
		fake.createSession = async () => {
			throw new DshRpcError('preset-not-found', 'no such agentPreset');
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({ agentPreset: 'ghost' }) }) })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('preset-not-found');
	});

	it('maps transport failure to 503 host-unreachable', async () => {
		fake.createSession = async () => {
			throw new Error('ECONNREFUSED');
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({}) }) })
		);
		expect(res.status).toBe(503);
	});
});

describe('GET /api/dsh/presets (W3)', () => {
	it('returns 200 with normalized presets', async () => {
		fake.listPresets = async () => ({
			presets: [
				{ id: 'research', name: 'Research', description: 'Web-first', isDefault: false },
				{ id: 'main', name: 'Main', description: null, isDefault: true }
			]
		});
		const { presets } = await importRoutesFresh();
		const res = await presets.GET(undefined as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; presets: Array<Record<string, unknown>> };
		expect(body.ok).toBe(true);
		expect(body.presets).toHaveLength(2);
		expect(body.presets[0]).toMatchObject({ id: 'research', name: 'Research' });
		expect(body.presets[1]).toMatchObject({ id: 'main', isDefault: true });
	});

	it('maps transport failure to 503', async () => {
		fake.listPresets = async () => {
			throw new Error('fetch failed');
		};
		const { presets } = await importRoutesFresh();
		const res = await presets.GET(undefined as never);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('host-unreachable');
	});
});

describe('GET /api/dsh/session/[sessionId]/history?beforeSeq=N (W3 — load-older)', () => {
	it('returns the ledger page ending at beforeSeq−1, mapped like the cold load', async () => {
		let asked: { id: string; beforeSeq: number } | undefined;
		fake.historyPage = async (id: string, beforeSeq: number) => {
			asked = { id, beforeSeq };
			return {
				events: [
					{ event: { type: 'user/message', seq: 8, time: 1787252700008, data: { text: 'older turn' } } },
				{ event: { type: 'assistant/message', seq: 9, time: 1787252700009, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'an answer' }] } } } }
			],
			hasMore: true
			};
		};
		const { history } = await importRoutesFresh();
		const headers = new Map<string, string>();
		const res = await history.GET(
			mkEvent({
				params: { sessionId: 's-long' },
				url: new URL('http://dsi/history?beforeSeq=10'),
				setHeaders: (h: Record<string, string>) => Object.entries(h).forEach(([k, v]) => headers.set(k, v))
			})
		);
		expect(asked).toEqual({ id: 's-long', beforeSeq: 10 });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			entries: Array<{ id: string; kind: string; seq: number }>;
			lastSeq: number;
			hasMore: boolean;
		};
		expect(body.ok).toBe(true);
		expect(body.hasMore).toBe(true);
		expect(body.lastSeq).toBe(9);
		// Cold-load parity: user/message + assistant/message (ledger v2 — the
		// settlement carries the step's embedded stream) map to the same
		// DsiEntry shapes.
		expect(body.entries.map((e) => e.kind)).toEqual(['user-message', 'assistant-message']);
		expect(headers.get('cache-control')).toBe('no-store');
	});

	it('beforeSeq passthrough: the exact query value reaches the connection', async () => {
		let received = -1;
		fake.historyPage = async (_id: string, beforeSeq: number) => {
			received = beforeSeq;
			return { events: [], hasMore: false };
		};
		const { history } = await importRoutesFresh();
		const res = await history.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/history?beforeSeq=1234') })
		);
		expect(res.status).toBe(200);
		expect(received).toBe(1234);
		const body = (await res.json()) as { hasMore: boolean; entries: unknown[] };
		expect(body.hasMore).toBe(false);
		expect(body.entries).toEqual([]);
	});

	it('missing beforeSeq → 400 (a page anchor is required)', async () => {
		const { history } = await importRoutesFresh();
		const res = await history.GET(mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/history') }));
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-beforeSeq');
	});

	it('non-numeric beforeSeq → 400', async () => {
		const { history } = await importRoutesFresh();
		const res = await history.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/history?beforeSeq=abc') })
		);
		expect(res.status).toBe(400);
	});

	it('maps an RPC error to 502 with the host code', async () => {
		fake.historyPage = async () => {
			throw new DshRpcError('session/not-found', 'nope');
		};
		const { history } = await importRoutesFresh();
		const res = await history.GET(
			mkEvent({ params: { sessionId: 'ghost' }, url: new URL('http://dsi/history?beforeSeq=5') })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/not-found');
	});
});

describe('POST /api/dsh/session/[sessionId]/rename (POC-3 W3 — talk-back)', () => {
	it('200: returns the host-normalized title + seq', async () => {
		let sent: { id: string; title: string } | undefined;
		fake.renameSession = async (id, title) => {
			sent = { id, title };
			return { title: 'Normalized', seq: 88 };
		};
		const { rename } = await importRoutesFresh();
		const res = await rename.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/rename', { method: 'POST', body: JSON.stringify({ title: '  normalized  ' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; title: string; seq: number };
		expect(body).toEqual({ ok: true, title: 'Normalized', seq: 88 });
		expect(sent).toEqual({ id: 's1', title: '  normalized  ' }); // host normalizes, not DSI
	});

	it('400: empty / whitespace title rejected before the wire', async () => {
		const { rename } = await importRoutesFresh();
		for (const bad of ['   ', '', 42]) {
			const res = await rename.POST(
				mkEvent({
					params: { sessionId: 's1' },
					request: new Request('http://dsi/rename', { method: 'POST', body: JSON.stringify({ title: bad }) })
				})
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('empty-title');
		}
	});

	it('400: non-JSON body', async () => {
		const { rename } = await importRoutesFresh();
		const res = await rename.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/rename', { method: 'POST', body: 'not-json' })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-json');
	});

	it('502: host RPC error (title-invalid) carries the host code', async () => {
		fake.renameSession = async () => {
			throw new DshRpcError('title-invalid', 'title normalizes to empty');
		};
		const { rename } = await importRoutesFresh();
		const res = await rename.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/rename', { method: 'POST', body: JSON.stringify({ title: '###' }) })
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('title-invalid');
	});

	it('503: transport failure maps to host-unreachable', async () => {
		fake.renameSession = async () => {
			throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:3080');
		};
		const { rename } = await importRoutesFresh();
		const res = await rename.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/rename', { method: 'POST', body: JSON.stringify({ title: 'x' }) })
			})
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('host-unreachable');
	});
});

describe('POST /api/dsh/session/[sessionId]/fork (The Fork Button ADR, 2026-09-01)', () => {
	it('200: forks at the last completed turn (atSeq omitted) → the child id', async () => {
		let sent: { id: string; atSeq?: number } | undefined;
		fake.forkSession = async (id, atSeq) => {
			sent = { id, atSeq };
			return { sessionId: 'child-9' };
		};
		const { fork } = await importRoutesFresh();
		const res = await fork.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/fork', { method: 'POST', body: JSON.stringify({}) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; sessionId: string };
		expect(body).toEqual({ ok: true, sessionId: 'child-9' });
		// The header's always-safe cut: atSeq absent, never null.
		expect(sent).toEqual({ id: 's1', atSeq: undefined });
	});

	it('200: a present atSeq passes through (per-message fork point is designed-for)', async () => {
		let sent: { id: string; atSeq?: number } | undefined;
		fake.forkSession = async (id, atSeq) => {
			sent = { id, atSeq };
			return { sessionId: 'child-9' };
		};
		const { fork } = await importRoutesFresh();
		const res = await fork.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/fork', { method: 'POST', body: JSON.stringify({ atSeq: 41 }) })
			})
		);
		expect(res.status).toBe(200);
		expect(sent).toEqual({ id: 's1', atSeq: 41 });
	});

	it('400: bad-json body', async () => {
		const { fork } = await importRoutesFresh();
		const res = await fork.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/fork', { method: 'POST', body: 'not-json' })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-json');
	});

	it('400: a present atSeq must be a non-negative integer', async () => {
		const { fork } = await importRoutesFresh();
		for (const bad of [-1, 1.5, '41', null]) {
			const res = await fork.POST(
				mkEvent({
					params: { sessionId: 's1' },
					request: new Request('http://dsi/fork', { method: 'POST', body: JSON.stringify({ atSeq: bad }) })
				})
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('bad-atSeq');
		}
	});

	it('502: host refusal (fork-unavailable — no completed turn) carries the host code', async () => {
		fake.forkSession = async () => {
			throw new DshRpcError('session/fork-unavailable', 'session "s1" has no completed turn to fork from');
		};
		const { fork } = await importRoutesFresh();
		const res = await fork.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/fork', { method: 'POST', body: JSON.stringify({}) })
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('session/fork-unavailable');
		expect(body.error.message).toContain('no completed turn');
	});

	it('503: transport failure maps to host-unreachable', async () => {
		fake.forkSession = async () => {
			throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:3080');
		};
		const { fork } = await importRoutesFresh();
		const res = await fork.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/fork', { method: 'POST', body: JSON.stringify({}) })
			})
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('host-unreachable');
	});
});

describe('GET /api/dsh/session/[sessionId]/models (POC-3 W3 — 3.2)', () => {
	it('200: returns the normalized directory verbatim (current/routable/groups/failures)', async () => {
		fake.listModels = async () => ({
			current: { provider: 'deepseek', model: 'glm-5.3' },
			routable: true,
			groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'glm-5.3', name: 'GLM 5.3' }] }],
			failures: [{ id: 'ollama', name: null, message: 'down' }]
		});
		const { models } = await importRoutesFresh();
		const headers = new Map<string, string>();
		const res = await models.GET(
			mkEvent({ params: { sessionId: 's1' }, setHeaders: (h: Record<string, string>) => Object.entries(h).forEach(([k, v]) => headers.set(k, v)) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({
			ok: true,
			current: { provider: 'deepseek', model: 'glm-5.3' },
			routable: true,
			groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'glm-5.3', name: 'GLM 5.3' }] }],
			failures: [{ id: 'ollama', name: null, message: 'down' }]
		});
		expect(headers.get('cache-control')).toBe('no-store');
	});

	it('200: garbage catalog passes through as the honest empty directory (normalize owns it)', async () => {
		fake.listModels = async () => ({ current: null, routable: false, groups: [], failures: [] });
		const { models } = await importRoutesFresh();
		const res = await models.GET(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; groups: unknown[]; current: unknown };
		expect(body.ok).toBe(true);
		expect(body.groups).toEqual([]);
		expect(body.current).toBeNull();
	});

	it('502: agent-busy (subagent) carries the host code', async () => {
		fake.listModels = async () => {
			throw new DshRpcError('session/agent-busy', 'subagents reject models');
		};
		const { models } = await importRoutesFresh();
		const res = await models.GET(mkEvent({ params: { sessionId: 's-sub' } }));
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/agent-busy');
	});

	it('503: transport failure → host-unreachable', async () => {
		fake.listModels = async () => {
			throw new Error('ECONNREFUSED');
		};
		const { models } = await importRoutesFresh();
		const res = await models.GET(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(503);
	});
});

describe('POST /api/dsh/session/[sessionId]/select-model (POC-3 W3 — 3.2)', () => {
	it('200: forwards the selection and returns the host-normalized {selected}', async () => {
		let sent: { id: string; provider: string; model: string; effort?: string } | undefined;
		fake.selectModel = async (id, provider, model, effort) => {
			sent = { id, provider, model, effort };
			return { provider, model };
		};
		const { selectModel } = await importRoutesFresh();
		const res = await selectModel.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/select-model', {
					method: 'POST',
					body: JSON.stringify({ provider: 'deepseek', model: 'glm-5.3', reasoningEffort: 'high' })
				})
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; selected: { provider: string; model: string } };
		expect(body).toEqual({ ok: true, selected: { provider: 'deepseek', model: 'glm-5.3' } });
		expect(sent).toEqual({ id: 's1', provider: 'deepseek', model: 'glm-5.3', effort: 'high' });
	});

	it('400: missing/empty provider or model rejected before the wire', async () => {
		const { selectModel } = await importRoutesFresh();
		for (const bad of [
			{ provider: '', model: 'm' },
			{ provider: 'p', model: '' },
			{ model: 'm' },
			{ provider: 'p' },
			{ provider: 42, model: 'm' },
			{ provider: 'p', model: 'm', reasoningEffort: 9 }
		]) {
			const res = await selectModel.POST(
				mkEvent({
					params: { sessionId: 's1' },
					request: new Request('http://dsi/select-model', { method: 'POST', body: JSON.stringify(bad) })
				})
			);
			expect(res.status).toBe(400);
		}
	});

	it('400: non-JSON body', async () => {
		const { selectModel } = await importRoutesFresh();
		const res = await selectModel.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/select-model', { method: 'POST', body: 'garbage' })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-json');
	});

	it('502: host RPC error carries the host code', async () => {
		fake.selectModel = async () => {
			throw new DshRpcError('model-invalid', 'no such model on route');
		};
		const { selectModel } = await importRoutesFresh();
		const res = await selectModel.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/select-model', {
					method: 'POST',
					body: JSON.stringify({ provider: 'p', model: 'ghost' })
				})
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('model-invalid');
	});

	it('503: transport failure → host-unreachable', async () => {
		fake.selectModel = async () => {
			throw new Error('ECONNREFUSED');
		};
		const { selectModel } = await importRoutesFresh();
		const res = await selectModel.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/select-model', {
					method: 'POST',
					body: JSON.stringify({ provider: 'p', model: 'm' })
				})
			})
		);
		expect(res.status).toBe(503);
	});
});

describe('POST /api/dsh/workspaces', () => {
	it('adopts a valid path and returns the host view', async () => {
		const { workspaces } = await importRoutesFresh();
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: JSON.stringify({ path: '/tmp/x' }) }) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; created: boolean; workspace: { path: string } };
		expect(body.ok).toBe(true);
		expect(body.created).toBe(true);
		expect(body.workspace.path).toBe('/tmp/x');
	});

	it('rejects an empty path with 400 bad-path', async () => {
		const { workspaces } = await importRoutesFresh();
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: JSON.stringify({ path: '   ' }) }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.error.code).toBe('bad-path');
	});

	it('rejects a missing path with 400 bad-path', async () => {
		const { workspaces } = await importRoutesFresh();
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: JSON.stringify({}) }) })
		);
		expect(res.status).toBe(400);
	});

	it('rejects invalid JSON with 400 bad-json (Wave D branch mop)', async () => {
		const { workspaces } = await importRoutesFresh();
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: 'not-json' }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('bad-json');
	});

	it('rejects a non-string path (number) with 400 bad-path (Wave D branch mop)', async () => {
		const { workspaces } = await importRoutesFresh();
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: JSON.stringify({ path: 42 }) }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-path');
	});

	it('rejects a null JSON body with 400 bad-path (Wave D branch mop)', async () => {
		const { workspaces } = await importRoutesFresh();
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: 'null' }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-path');
	});

	it('passes the host created:false through unchanged (Wave D branch mop)', async () => {
		const { workspaces } = await importRoutesFresh();
		fake.createWorkspace = async () => ({
			workspace: { workspaceId: 'ws-9', path: '/tmp/x', title: 'x', sessionIds: [], createdAt: 't', updatedAt: 't' },
			created: false
		});
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: JSON.stringify({ path: '/tmp/x' }) }) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; created: boolean; workspace: { workspaceId: string } };
		expect(body.ok).toBe(true);
		expect(body.created).toBe(false);
		expect(body.workspace.workspaceId).toBe('ws-9');
	});

	it('maps a host failure through mapRpcFailure', async () => {
		const { workspaces } = await importRoutesFresh();
		fake.createWorkspace = async () => {
			throw new (DshRpcError as new (code: string, message: string) => Error)('path-not-found', 'no such directory');
		};
		const res = await workspaces.POST(
			mkEvent({ request: new Request('http://dsi/workspaces', { method: 'POST', body: JSON.stringify({ path: '/nope' }) }) })
		);
		expect(res.status).toBeGreaterThanOrEqual(400);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		fake.createWorkspace = async () => ({
			workspace: { workspaceId: 'ws-1', path: '/tmp/x', title: 'x', sessionIds: [], createdAt: 't', updatedAt: 't' },
			created: true
		});
	});
});

describe('POST /api/dsh/workspaces/[workspaceId]/rename (Chip Menu ADR D3)', () => {
	it('returns 200 with the workspace view and trims the title', async () => {
		const { wsRename } = await importRoutesFresh();
		let seen: { id: string; title: string } | undefined;
		fake.renameWorkspace = async (id, title) => {
			seen = { id, title };
			return { workspace: { workspaceId: id, title, path: '/tmp/x' } };
		};
		const res = await wsRename.POST(
			mkEvent({
				params: { workspaceId: 'ws-1' },
				request: new Request('http://dsi/workspaces/ws-1/rename', { method: 'POST', body: JSON.stringify({ title: '  Renamed Home  ' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; workspace: { workspaceId: string; title: string } };
		expect(body.ok).toBe(true);
		expect(body.workspace).toEqual({ workspaceId: 'ws-1', title: 'Renamed Home', path: '/tmp/x' });
		expect(seen).toEqual({ id: 'ws-1', title: 'Renamed Home' });
	});

	it('rejects a whitespace-only title with 400 bad-title (ADR D2)', async () => {
		const { wsRename } = await importRoutesFresh();
		const res = await wsRename.POST(
			mkEvent({
				params: { workspaceId: 'ws-1' },
				request: new Request('http://dsi/workspaces/ws-1/rename', { method: 'POST', body: JSON.stringify({ title: '   ' }) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-title');
	});

	it('rejects invalid JSON with 400 bad-json', async () => {
		const { wsRename } = await importRoutesFresh();
		const res = await wsRename.POST(
			mkEvent({
				params: { workspaceId: 'ws-1' },
				request: new Request('http://dsi/workspaces/ws-1/rename', { method: 'POST', body: 'not-json' })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-json');
	});

	it('maps workspace/name-conflict through mapRpcFailure as an honest 502', async () => {
		const { wsRename } = await importRoutesFresh();
		fake.renameWorkspace = async () => {
			throw new (DshRpcError as new (code: string, message: string) => Error)('workspace/name-conflict', 'title taken');
		};
		const res = await wsRename.POST(
			mkEvent({
				params: { workspaceId: 'ws-1' },
				request: new Request('http://dsi/workspaces/ws-1/rename', { method: 'POST', body: JSON.stringify({ title: 'occupied' }) })
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('workspace/name-conflict');
	});
});

describe('POST /api/dsh/workspaces/[workspaceId]/delete (Chip Menu ADR D3)', () => {
	it('returns 200 with the removed workspaceId', async () => {
		const { wsDelete } = await importRoutesFresh();
		let seen: string | undefined;
		fake.deleteWorkspace = async (id) => {
			seen = id;
			return { workspaceId: id };
		};
		const res = await wsDelete.POST(
			mkEvent({ params: { workspaceId: 'ws-1' } })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; workspaceId: string };
		expect(body.ok).toBe(true);
		expect(body.workspaceId).toBe('ws-1');
		expect(seen).toBe('ws-1');
	});

	it('maps workspace/not-found through mapRpcFailure as an honest 502', async () => {
		const { wsDelete } = await importRoutesFresh();
		fake.deleteWorkspace = async () => {
			throw new (DshRpcError as new (code: string, message: string) => Error)('workspace/not-found', 'gone');
		};
		const res = await wsDelete.POST(
			mkEvent({ params: { workspaceId: 'ws-void' } })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('workspace/not-found');
	});

	it('rejects an empty workspaceId param with 400 bad-workspace-id', async () => {
		const { wsDelete } = await importRoutesFresh();
		const res = await wsDelete.POST(mkEvent({ params: { workspaceId: '  ' } }));
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-workspace-id');
	});
});

describe('GET /api/dsh/directory', () => {
	it('returns 200 with the listing for a path', async () => {
		const { directory } = await importRoutesFresh();
		const res = await directory.GET(
			mkEvent({ url: new URL('http://dsi/directory?path=%2FUsers%2Fx') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			listing: { path: string; home: string; crumbs: unknown[]; entries: Array<{ name: string }>; truncated: boolean };
		};
		expect(body.ok).toBe(true);
		expect(body.listing.path).toBe('/Users/x');
		expect(body.listing.entries).toEqual([{ name: 'proj', path: '/Users/x/proj', hidden: false }]);
	});

	it('forwards an absent path as the home listing', async () => {
		const { directory } = await importRoutesFresh();
		let seen: string | undefined | null = 'unset';
		fake.listDirectory = async (path?: string) => {
			seen = path;
			return { path: '/Users/x', home: '/Users/x', crumbs: [], entries: [], truncated: false };
		};
		const res = await directory.GET(mkEvent({ url: new URL('http://dsi/directory') }));
		expect(res.status).toBe(200);
		expect(seen).toBeUndefined();
	});

	it('rejects a blank path with 400 bad-path', async () => {
		const { directory } = await importRoutesFresh();
		const res = await directory.GET(mkEvent({ url: new URL('http://dsi/directory?path=') }));
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.error.code).toBe('bad-path');
	});

	it('maps an unreadable directory to 502 with the host code', async () => {
		const { directory } = await importRoutesFresh();
		fake.listDirectory = async () => {
			throw new (DshRpcError as new (code: string, message: string) => Error)(
				'directory-unreadable',
				'cannot list "/nope"'
			);
		};
		const res = await directory.GET(
			mkEvent({ url: new URL('http://dsi/directory?path=%2Fnope') })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.error.code).toBe('directory-unreadable');
	});
});

describe('POST /api/dsh/pick-directory', () => {
	it('returns 200 with the picked path', async () => {
		const { pickDirectory } = await importRoutesFresh();
		const res = await pickDirectory.POST(
			mkEvent({ request: new Request('http://dsi/pick-directory', { method: 'POST' }) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; path: string | null };
		expect(body.ok).toBe(true);
		expect(body.path).toBe('/Users/x/proj');
	});

	it('returns 200 with a null path when the operator cancels the dialog', async () => {
		const { pickDirectory } = await importRoutesFresh();
		fake.pickDirectory = async () => ({ path: null });
		const res = await pickDirectory.POST(
			mkEvent({ request: new Request('http://dsi/pick-directory', { method: 'POST' }) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; path: string | null };
		expect(body.ok).toBe(true);
		expect(body.path).toBeNull();
	});

	it('maps a native-less host to 502 directory-picker/unavailable with capability details', async () => {
		const { pickDirectory } = await importRoutesFresh();
		fake.pickDirectory = async () => {
			const err = new (DshRpcError as unknown as new (
				code: string,
				message: string,
				details?: unknown
			) => Error)('directory-picker/unavailable', 'stub needs native', { capability: 'browse' });
			throw err;
		};
		const res = await pickDirectory.POST(
			mkEvent({ request: new Request('http://dsi/pick-directory', { method: 'POST' }) })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as {
			ok: boolean;
			error: { code: string; details?: { capability?: string } };
		};
		expect(body.error.code).toBe('directory-picker/unavailable');
		expect(body.error.details?.capability).toBe('browse');
	});
});

describe('GET /api/dsh/session/[sessionId]/attachment (task 3.2)', () => {
	const VALUE = {
		attachment: { attachmentId: 'sha256:img-1', mediaType: 'image/png', bytes: 96, width: 1, height: 1, name: 'shot.png' },
		data: 'iVBOR'
	};

	it('proxies session.attachment (full image ref, 0.2.2 contract) and returns {ok, attachment, data}', async () => {
		const REF = { attachmentId: 'sha256:img-1', mediaType: 'image/png', bytes: 96, width: 1, height: 1, name: 'shot.png' };
		let seen: { id: string; ref: typeof REF } | undefined;
		fake.readAttachment = async (id, ref) => {
			seen = { id, ref: ref as typeof REF };
			return VALUE;
		};
		const { attachment } = await importRoutesFresh();
		const res = await attachment.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/a?ref=%7B%22attachmentId%22%3A%22sha256%3Aimg-1%22%2C%22mediaType%22%3A%22image%2Fpng%22%2C%22bytes%22%3A96%2C%22width%22%3A1%2C%22height%22%3A1%2C%22name%22%3A%22shot.png%22%7D') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as typeof VALUE & { ok: boolean };
		expect(body.ok).toBe(true);
		expect(body.attachment).toEqual(VALUE.attachment);
		expect(body.data).toBe('iVBOR');
		expect(seen).toEqual({ id: 's1', ref: REF });
	});

	it('missing ref is a 400 (validation, not transport)', async () => {
		const { attachment } = await importRoutesFresh();
		const res = await attachment.GET(mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/a') }));
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('missing-attachment-ref');
	});

	it('host refusal (attachment-not-found) maps to 502 with the host code', async () => {
		const REF = { attachmentId: 'sha256:missing', mediaType: 'image/png', bytes: 1, width: 1, height: 1 };
		fake.readAttachment = async () => {
			throw new DshRpcError('attachment-not-found', 'no such attachment');
		};
		const { attachment } = await importRoutesFresh();
		const res = await attachment.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/a?ref=' + encodeURIComponent(JSON.stringify(REF))) })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('attachment-not-found');
	});

	it('transport failure maps to 503 host-unreachable', async () => {
		fake.readAttachment = async () => {
			throw new Error('socket gone');
		};
		const { attachment } = await importRoutesFresh();
		const REF = { attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 1, width: 1, height: 1 };
		const res = await attachment.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/a?ref=' + encodeURIComponent(JSON.stringify(REF))) })
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('host-unreachable');
	});
});

describe('GET /api/dsh/session/[sessionId]/catalog (Slash Menu W1 — the / menu read path)', () => {
	const cmds = [
		{ name: 'compact', description: 'Compact older conversation history' },
		{ name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]', images: true } }
	];
	const skls = { skills: [{ name: 'dsh-doc', description: 'docs', modelInvocable: true }] };

	it('merges both catalog legs into one payload — rows verbatim, skills flattened', async () => {
		fake.listCommands = async () => cmds;
		fake.listSkills = async () => skls;
		const { catalog } = await importRoutesFresh();
		const res = await catalog.GET(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; commands: typeof cmds; skills: unknown };
		expect(body.ok).toBe(true);
		expect(body.commands).toEqual(cmds);
		expect(body.skills).toEqual([{ name: 'dsh-doc', description: 'docs', modelInvocable: true }]);
	});

	it('one failed leg fails the whole catalog — DshRpcError → 502 with the host code', async () => {
		fake.listCommands = async () => cmds;
		fake.listSkills = async () => {
			throw new DshRpcError('session/not-found', 'nope');
		};
		const { catalog } = await importRoutesFresh();
		const res = await catalog.GET(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/not-found');
	});

	it('a transport failure maps to 503 host-unreachable (either leg)', async () => {
		fake.listCommands = async () => {
			throw new Error('fetch failed');
		};
		const { catalog } = await importRoutesFresh();
		const res = await catalog.GET(mkEvent({ params: { sessionId: 's1' } }));
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('host-unreachable');
	});
});

describe('POST /api/dsh/session/[sessionId]/command (Slash Menu W1 — the execute wire, admission-miss honesty)', () => {
	it('passes the line verbatim to executeCommand and surfaces the receipt', async () => {
		let executed: { id: string; line: string } | undefined;
		fake.executeCommand = async (id, line) => {
			executed = { id, line };
			return { commandId: 'cmd-9', result: { kind: 'success', text: 'compacted 12 turns' } };
		};
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '/compact extra   tokens  kept' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; executed: boolean; commandId: string; text: string };
		expect(body).toEqual({ ok: true, executed: true, commandId: 'cmd-9', text: 'compacted 12 turns' });
		expect(executed).toEqual({ id: 's1', line: '/compact extra   tokens  kept' });
	});

	it('an admission miss maps to {ok:true, executed:false} — a negative answer, NEVER a 5xx (ADR §4.3)', async () => {
		fake.executeCommand = async () => null;
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '/nope' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; executed: boolean };
		expect(body).toEqual({ ok: true, executed: false });
	});

	it("the command's own error result reports command-error verbatim", async () => {
		fake.executeCommand = async () => ({ commandId: 'cmd-3', result: { kind: 'error', text: 'plan mode unavailable' } });
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '/plan off' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('command-error');
		expect(body.error.message).toBe('plan mode unavailable');
	});

	it('rejects a non-slash line with 400 (the route executes commands only)', async () => {
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: 'just chat' }) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('not-a-command');
	});

	it('maps an RpcError to 502 with the host code', async () => {
		fake.executeCommand = async () => {
			throw new DshRpcError('session/not-found', 'nope');
		};
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '/compact' }) })
			})
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/not-found');
	});
});

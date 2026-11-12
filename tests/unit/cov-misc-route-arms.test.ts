/**
 * Coverage sweep — the route arms the main suites miss (misc weakest
 * spots). Handlers invoked directly with node-env Request objects (the
 * established a2a-routes / api-dsh-route-edges pattern):
 *
 *   - prompts [id] PATCH: macro/tags type gates (400 before any db touch);
 *   - prompts POST: createPrompt's no-existing failure -> 500;
 *   - settings PUT: a non-parse failure is RETHROWN (chain integrity);
 *   - terminal delete: an unparseable body reads as no token -> 403;
 *   - dsh workspaces rename: empty workspaceId -> 400 bad-workspace-id;
 *   - dsh prompt/respond/select-model body-validation 400 arms;
 *   - dsh events delta: goal + ledgerStats projections ride the poll;
 *   - dsh goal: a stale-ref refusal with NO trailing revision falls back
 *     to the freshest projection revision and retries.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DshRpcError } from '$lib/server/dsh-rpc';

// ---- prompts: the connection seam (mock can force a null db handle) ----
vi.mock('$lib/server/prompts/connection.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/prompts/connection.js')>();
	return { ...actual, openPromptsDb: vi.fn(actual.openPromptsDb) };
});

// ---- settings: real module, save overridden per test ----
const saveSettingsDocumentSpy = vi.fn();
vi.mock('$lib/server/settings-document', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/settings-document')>();
	return {
		...actual,
		saveSettingsDocument: (...args: unknown[]) => saveSettingsDocumentSpy(...args)
	};
});

// ---- terminal registry: light stub (the close ladder is pinned elsewhere) ----
const { destroySpy, registry } = vi.hoisted(() => {
	const destroySpy = vi.fn();
	return { destroySpy, registry: { destroy: destroySpy } };
});
vi.mock('$lib/server/terminal/registry.js', () => ({
	terminalRegistry: registry,
	TerminalRegistryRefusal: class TerminalRegistryRefusal extends Error {
		constructor(public code: 'NO_SESSION' | 'FOREIGN_SESSION') {
			super(code);
		}
	}
}));

// ---- dsh-connection: one mutable fake shared by the dsh routes ----
const goalVerbSpy = vi.fn();
const fakeConn: Record<string, unknown> = {
	goalVerb: goalVerbSpy,
	projectionValue: () => undefined,
	ensureDownlinks: () => {},
	subscribe: () => {},
	pendingFor: () => [],
	settlementsFor: () => [],
	pruneSettlements: () => {},
	eventsSince: () => ({ events: [], lastSeq: -1, running: false, gap: false }),
	liveAssistantStream: () => null,
	isRunning: () => false,
	history: async () => ({ events: [] }),
	prompt: vi.fn(),
	respond: vi.fn(),
	selectModel: vi.fn(),
	renameWorkspace: vi.fn()
};
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => fakeConn
}));

const { openPromptsDb, __resetPromptsDbCache, PROMPTS_DB_ENV } = await import(
	'$lib/server/prompts/connection.js'
);
const openSpy = vi.mocked(openPromptsDb);

const { PATCH } = await import('../../src/routes/api/prompts/[id]/+server');
const { POST: POST_PROMPTS } = await import('../../src/routes/api/prompts/+server');
const { PUT } = await import('../../src/routes/api/settings/+server');
const { DELETE } = await import('../../src/routes/api/terminal/[id]/delete/+server');
const { POST: POST_RENAME } = await import(
	'../../src/routes/api/dsh/workspaces/[workspaceId]/rename/+server'
);
const { POST: POST_GOAL } = await import('../../src/routes/api/dsh/session/[sessionId]/goal/+server');
const { POST: POST_PROMPT } = await import('../../src/routes/api/dsh/session/[sessionId]/prompt/+server');
const { POST: POST_RESPOND } = await import('../../src/routes/api/dsh/session/[sessionId]/respond/+server');
const { POST: POST_SELECT } = await import(
	'../../src/routes/api/dsh/session/[sessionId]/select-model/+server'
);
const { GET: GET_EVENTS } = await import('../../src/routes/api/dsh/session/[sessionId]/events/+server');

function mkEvent(e: Record<string, unknown>): never {
	return { setHeaders: () => {}, ...e } as never;
}

function req(url: string, body: unknown): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-cov-misc-'));
	process.env[PROMPTS_DB_ENV] = join(tmpRoot, 'prompts.sqlite');
	openSpy.mockReset();
	__resetPromptsDbCache();
	goalVerbSpy.mockReset();
	saveSettingsDocumentSpy.mockReset();
	destroySpy.mockReset();
	fakeConn.prompt = vi.fn();
	fakeConn.respond = vi.fn();
	fakeConn.selectModel = vi.fn();
	fakeConn.renameWorkspace = vi.fn();
	fakeConn.projectionValue = () => undefined;
});

afterEach(() => {
	__resetPromptsDbCache();
	delete process.env[PROMPTS_DB_ENV];
	vi.restoreAllMocks();
});

describe('PATCH /api/prompts/[id] — macro/tags type gates', () => {
	it('a non-boolean macro is 400 before any update', async () => {
		const res = await PATCH(mkEvent({ params: { id: '1' }, request: req('http://x', { macro: 'yes' }) }));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('macro must be a boolean');
	});

	it('a non-string tags is 400 before any update', async () => {
		const res = await PATCH(mkEvent({ params: { id: '1' }, request: req('http://x', { tags: ['git'] }) }));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('tags must be a string (space/comma separated words)');
	});
});

describe('POST /api/prompts — the create failure arm', () => {
	it('a createPrompt failure with NO existing row is an honest 500', async () => {
		openSpy.mockReturnValue(null); // unopenable db -> { ok:false, existing:null }
		const res = await POST_PROMPTS(mkEvent({ request: req('http://x', { text: 'doomed' }) }));
		expect(res.status).toBe(500);
		expect((await res.json()).error).toBe('Failed to create prompt');
	});
});

describe('PUT /api/settings — the non-parse failure arm', () => {
	it('rethrows a failure that is NOT a SettingsParseError', async () => {
		saveSettingsDocumentSpy.mockImplementation(() => {
			throw new TypeError('disk on fire');
		});
		const request = req('http://local/api/settings?target=dsi', { text: 'a: 1' });
		await expect(
			PUT({ url: new URL('http://local/api/settings?target=dsi'), request } as never)
		).rejects.toThrow('disk on fire');
	});
});

describe('DELETE /api/terminal/[id]/delete — unparseable body arm', () => {
	it('a body that fails JSON parsing reads as no token -> 403 FOREIGN_SESSION', async () => {
		const res = await DELETE(
			mkEvent({ params: { id: 't-1' }, request: req('http://x', '{not json') })
		);
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('FOREIGN_SESSION');
		expect(destroySpy).not.toHaveBeenCalled();
	});
});

describe('POST /api/dsh/workspaces/[workspaceId]/rename — empty-id gate', () => {
	it('an empty workspaceId is 400 bad-workspace-id before any wire call', async () => {
		const res = await POST_RENAME(
			mkEvent({ params: { workspaceId: '  ' }, request: req('http://x', { title: 'New' }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-workspace-id');
	});
});

describe('dsh session routes — body-validation 400 arms', () => {
	it('prompt: a non-string text is 400 bad-text', async () => {
		const res = await POST_PROMPT(
			mkEvent({ params: { sessionId: 's1' }, request: req('http://x', { text: 42 }) })
		);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-text');
	});

	it('respond: a missing rpcId is 400 bad-rpcId', async () => {
		const res = await POST_RESPOND(
			mkEvent({ params: { sessionId: 's1' }, request: req('http://x', { payload: {} }) })
		);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-rpcId');
	});

	it('select-model: a null body is 400 bad-provider', async () => {
		const res = await POST_SELECT(
			mkEvent({ params: { sessionId: 's1' }, request: req('http://x', 'null') })
		);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-provider');
	});
});

describe('GET …/events delta — goal + ledgerStats projections ride the poll', () => {
	it('a delta poll carries the goal view and the merged ledger stats when projected', async () => {
		fakeConn.projectionValue = (_id: string, key: string) => {
			if (key === 'goal') {
				return {
					goal: { id: 'g1', revision: 4, objective: 'ship it', phase: 'active' },
					roundsStarted: 2
				};
			}
			if (key === 'sessionStats') {
				return {
					turns: 3, steps: 9, llmMs: 100, toolMs: 20,
					ttftMs: 5, ttftSteps: 2, decodeMs: 40, decodeTokens: 60
				};
			}
			if (key === 'tokenUsage') {
				return { uncachedInputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 40 };
			}
			return undefined;
		};
		const res = await GET_EVENTS(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=0') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.goal).toMatchObject({ id: 'g1', revision: 4, roundsStarted: 2 });
		expect(body.ledgerStats).toMatchObject({ turns: 3, outputTokens: 40 });
	});
});

describe('POST …/goal — stale-ref retry via the freshest projection', () => {
	it('a stale refusal with NO trailing revision falls back to the projection revision and retries', async () => {
		goalVerbSpy
			.mockRejectedValueOnce(
				new DshRpcError('GOAL_STALE_REVISION', 'stale goal ref "goal-1"; the goal moved on')
			)
			.mockResolvedValueOnce({ id: 'goal-1', revision: 7, objective: 'ship it' });
		fakeConn.projectionValue = () => ({
			goal: { id: 'goal-1', revision: 7, objective: 'ship it', phase: 'paused' },
			roundsStarted: 1
		});
		const res = await POST_GOAL(
			mkEvent({
				params: { sessionId: 's1' },
				request: req('http://x', { verb: 'resume', ref: { id: 'goal-1', revision: 3 } })
			})
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, value: { id: 'goal-1', revision: 7, objective: 'ship it' } });
		expect(goalVerbSpy.mock.calls[1]).toEqual(['resume', 's1', { id: 'goal-1', revision: 7 }, undefined]);
	});
});

/**
 * command-executor tests (task 1.2-T): the ONE command/send surface the
 * typed path and the macro runner share — /new create+swap (cwd + preset
 * inheritance, failure notes verbatim), /permission + mention paths
 * verbatim from the panel, sendPrompt records iff ordinary. The panel's
 * own suite (conversation-panel.test.ts, 77 tests) pins the extraction
 * contract end-to-end and runs UNMODIFIED.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	executeCommand,
	executeHostCommand,
	resolveHostCommand,
	sendPrompt,
	type ExecutorContext
} from '$lib/services/chat/command-executor';
import { parseCommand, loadinjectedCommand } from '$lib/services/chat/command-parser';
import type { DsiEntry } from '$lib/types';
import {
	registerAddPanel,
	registerReplacePanel,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
const NEW_ID = 'session-22222222-0000-4000-8000-000000000002';
const TARGET_UUID = '1d15d442-94bc-422c-afb1-e870db9906a3';
const TARGET_ID = `session-${TARGET_UUID}`;

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	registerAddPanel(null);
	registerReplacePanel(null);
	vi.unstubAllGlobals();
});

/** Route-stub harness: matchers in order, records every call. */
function stubFetch(
	routes: Array<{ test: (url: string, init?: RequestInit) => boolean; respond: () => Response }>
) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({ url, init });
			for (const r of routes) {
				if (r.test(url, init)) return r.respond();
			}
			return jsonRes({ ok: false }, 404);
		})
	);
	return { calls };
}

function ctx(over: Partial<ExecutorContext> = {}): ExecutorContext {
	return { sessionId: SELF, workspace: '/w/proj', agent: 'main', panelId: 'p1', ...over };
}

// ── /new ────────────────────────────────────────────────────────────────

describe('executeCommand — /new (create + swap)', () => {
	it('POSTs cwd + agentPreset inheritance and swaps with the returned id', async () => {
		const bodies: unknown[] = [];
		const { calls } = stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => {
					bodies.push(JSON.parse('{}')); // body captured via calls below
					return jsonRes({ ok: true, sessionId: NEW_ID });
				}
			}
		]);
		const swaps: Array<{ panelId: string } & PanelAddRequest> = [];
		registerReplacePanel((panelId, request) => swaps.push({ panelId, ...request }));

		const result = await executeCommand(parseCommand('/new')!, ctx());

		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions'));
		expect(create).toBeDefined();
		expect(JSON.parse(String(create!.init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'main' });
		// focus: true — the successor panel's composer takes the caret when
		// it mounts (the swap-focus, 2026-08-29).
		expect(swaps).toEqual([
			{ panelId: 'p1', sessionId: NEW_ID, agentPreset: 'main', focus: true }
		]);
	});

	it('/new @<agent> overrides the inherited preset on the wire AND the swap', async () => {
		const { calls } = stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
			}
		]);
		const swaps: Array<{ agentPreset: string | null }> = [];
		registerReplacePanel((_panelId, request) => {
			if (
				request.kind !== 'terminal' &&
				request.kind !== 'prompt-manager' &&
				request.kind !== 'settings-home' &&
				request.kind !== 'injected-doc' &&
				request.kind !== 'skill-shelf' &&
				request.kind !== 'plugin-rack'
			)
				swaps.push({ agentPreset: request.agentPreset });
		});

		await executeCommand(parseCommand('/new @code')!, ctx());

		expect(JSON.parse(String(calls[0].init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'code' });
		expect(swaps).toEqual([{ agentPreset: 'code' }]);
	});

	it('workspace null → no cwd key; agent null → no preset key (byte-shaped inheritance)', async () => {
		const { calls } = stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
			}
		]);
		registerReplacePanel(() => true);
		await executeCommand(parseCommand('/new')!, ctx({ workspace: null, agent: null }));
		expect(JSON.parse(String(calls[0].init!.body))).toEqual({});
	});

	it('/new --add adds a panel to the right (afterSessionId anchor, keepSelection, no swap)', async () => {
		const { calls } = stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
			}
		]);
		const adds: PanelAddRequest[] = [];
		registerAddPanel((request) => adds.push(request));
		const swaps: unknown[] = [];
		registerReplacePanel((_id, request) => swaps.push(request));

		const result = await executeCommand(parseCommand('/new @app-dev --add')!, ctx());

		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
		expect(JSON.parse(String(calls[0].init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'app-dev' });
		// The add anchors AFTER this session (the right-neighbor slot) and
		// KEEPS the selection here — the successor swap never runs.
		expect(adds).toEqual([
			{ sessionId: NEW_ID, agentPreset: 'app-dev', afterSessionId: SELF, keepSelection: true }
		]);
		expect(swaps).toEqual([]);
	});

	it('/new --add without an agent inherits the preset on the add', async () => {
		stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
			}
		]);
		const adds: PanelAddRequest[] = [];
		registerAddPanel((request) => adds.push(request));
		await executeCommand(parseCommand('/new --add')!, ctx());
		expect(adds).toEqual([
			{ sessionId: NEW_ID, agentPreset: 'main', afterSessionId: SELF, keepSelection: true }
		]);
	});

	it('/new --add with no floor handler reports the floor note', async () => {
		stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
			}
		]);
		const result = await executeCommand(parseCommand('/new --add')!, ctx());
		expect(result).toEqual({ ok: false, note: '/new: the floor is not mounted' });
	});

	it('a malformed multi-token shape keeps its usage error before any wire traffic', async () => {
		// 2026-09-15, Workspace Command ADR D5: a LONE token is now the ws
		// shape (resolved against the registry — Wave 2), so the raw-args
		// usage error only fires on genuinely malformed remainders.
		const { calls } = stubFetch([]);
		const result = await executeCommand(parseCommand('/new a b c')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toBe('usage: /new [@agent] [workspace] [--title <title>] [--add]');
		expect(calls).toHaveLength(0);
	});

	it('no panel floor → verbatim refusal', async () => {
		const { calls } = stubFetch([]);
		const result = await executeCommand(parseCommand('/new')!, ctx({ panelId: null }));
		expect(result.ok).toBe(false);
		expect(result.note).toBe('/new needs a panel floor (open this session on the floor first)');
		expect(calls).toHaveLength(0);
	});

	it('host failure message surfaces verbatim', async () => {
		stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: false, error: { message: 'agent-preset-not-found: nope' } }, 400)
			}
		]);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new @nope')!, ctx());
		expect(result).toEqual({ ok: false, note: 'agent-preset-not-found: nope' });
	});

	it('HTTP non-JSON failure → status note', async () => {
		stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes(null, 503)
			}
		]);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new')!, ctx());
		expect(result.note).toBe('/new failed (HTTP 503)');
	});

	it('swap refused (floor not mounted) → verbatim note', async () => {
		stubFetch([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
			}
		]);
		// No registerReplacePanel call — the registry is unregistered, so
		// replacePanelFromRegistry answers false (floor-not-mounted).
		const result = await executeCommand(parseCommand('/new')!, ctx());
		expect(result).toEqual({ ok: false, note: '/new: the floor is not mounted' });
	});

	it('transport throw → verbatim note with the message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('wire dead');
			})
		);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new')!, ctx());
		expect(result.note).toBe('/new failed (wire dead)');
	});
});

// ── /permission ─────────────────────────────────────────────────────────

describe('executeCommand — /permission', () => {
	it('executes the line on the typed route; ok text is the note', async () => {
		const { calls } = stubFetch([
			{
				test: (url, init) => url.endsWith('/permission') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, text: 'preset: code' })
			}
		]);
		const result = await executeCommand(parseCommand('/permission code')!, ctx());
		expect(result).toEqual({ ok: true, note: 'preset: code' });
		expect(JSON.parse(String(calls[0].init!.body))).toEqual({ line: '/permission code' });
		expect(calls[0].url).toContain(encodeURIComponent(SELF));
	});

	it('bare /permission → ok without text → fixed copy', async () => {
		stubFetch([
			{
				test: (url) => url.endsWith('/permission'),
				respond: () => jsonRes({ ok: true })
			}
		]);
		const result = await executeCommand(parseCommand('/permission')!, ctx());
		expect(result.note).toBe('permission updated');
	});

	it('error reply → verbatim message', async () => {
		stubFetch([
			{
				test: (url) => url.endsWith('/permission'),
				respond: () => jsonRes({ ok: false, error: { message: 'unknown preset: nope' } }, 400)
			}
		]);
		const result = await executeCommand(parseCommand('/permission nope')!, ctx());
		expect(result).toEqual({ ok: false, note: 'unknown preset: nope' });
	});
});

// ── mention ─────────────────────────────────────────────────────────────

describe('executeCommand — @session mention (verbatim contract)', () => {
	function spineRow(over: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			sessionId: TARGET_ID,
			title: 'TE-LO-LET',
			agentPreset: 'main',
			running: false,
			turns: 7,
			...over
		};
	}

	function mentionRoutes(opts: { sessions: unknown[]; promptOk?: boolean; registerOk?: boolean }) {
		return stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/sessions'),
				respond: () => jsonRes({ ok: true, sessions: opts.sessions })
			},
			{
				test: (url, init) => url.endsWith('/api/a2a/register') && init?.method === 'POST',
				respond: () =>
					opts.registerOk === false ? jsonRes({ ok: false }, 500) : jsonRes({ ok: true })
			},
			{
				test: (url) => /\/api\/dsh\/session\/[^/]+\/prompt$/.test(url),
				respond: () =>
					opts.promptOk === false ? jsonRes({ ok: false, error: { message: 'agent-busy' } }, 502) : jsonRes({ ok: true })
			}
		]);
	}

	it('happy path: opens the panel, queues the prompt (protocol line), registers the watch', async () => {
		const { calls } = mentionRoutes({ sessions: [spineRow()] });
		const opened: PanelAddRequest[] = [];
		registerAddPanel((request) => opened.push({ ...request }));

		const result = await executeCommand(
			parseCommand(`@session-${TARGET_UUID} run tests`)!,
			ctx()
		);

		expect(result).toEqual({ ok: true, note: 'sent to TE-LO-LET — panel opened' });
		expect(opened).toEqual([{ sessionId: TARGET_ID, agentPreset: 'main' }]);
		const prompt = calls.find((c) => /\/prompt$/.test(c.url))!;
		const delivered = JSON.parse(String(prompt.init!.body)).text as string;
		expect(delivered).toMatch(
			/^run tests\. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-[a-f0-9]{16};$/
		);
		const reg = calls.find((c) => c.url.endsWith('/api/a2a/register'))!;
		const regBody = JSON.parse(String(reg.init!.body));
		expect(regBody).toMatchObject({ from: SELF, to: TARGET_ID, message: 'run tests', watermark: 7 });
		expect(delivered.endsWith(`_a2a_:${regBody.id};`)).toBe(true);
	});

	it('self-mention: ok no-op note, zero wire traffic', async () => {
		const { calls } = stubFetch([]);
		const selfUuid = SELF.replace(/^session-/, '');
		const result = await executeCommand(parseCommand(`@session-${selfUuid} hello me`)!, ctx());
		expect(result).toEqual({ ok: true, note: 'that is this session — just type your message' });
		expect(calls).toHaveLength(0);
	});

	it('empty message: usage error before any wire traffic', async () => {
		const { calls } = mentionRoutes({ sessions: [spineRow()] });
		const result = await executeCommand(parseCommand(`@session-${TARGET_UUID}`)!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('usage:');
		expect(calls).toHaveLength(0);
	});

	it('no floor: the mention refuses to whisper', async () => {
		mentionRoutes({ sessions: [spineRow()] });
		const result = await executeCommand(parseCommand(`@session-${TARGET_UUID} hi`)!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('panel floor');
	});

	it('prompt rejected: host error verbatim, no register', async () => {
		const { calls } = mentionRoutes({ sessions: [spineRow()], promptOk: false });
		registerAddPanel(() => {});
		const result = await executeCommand(parseCommand(`@session-${TARGET_UUID} hi`)!, ctx());
		expect(result).toEqual({ ok: false, note: 'agent-busy' });
		expect(calls.some((c) => c.url.endsWith('/api/a2a/register'))).toBe(false);
	});

	it('running target → queued-behind note', async () => {
		mentionRoutes({ sessions: [spineRow({ running: true })] });
		registerAddPanel(() => {});
		const result = await executeCommand(parseCommand(`@session-${TARGET_UUID} hi`)!, ctx());
		expect(result.note).toContain(`queued behind TE-LO-LET's current turn`);
	});

	it('turns null → watermark -1 + untracked-watermark note', async () => {
		const { calls } = mentionRoutes({ sessions: [spineRow({ turns: null })] });
		registerAddPanel(() => {});
		const result = await executeCommand(parseCommand(`@session-${TARGET_UUID} ping`)!, ctx());
		const reg = JSON.parse(String(calls.find((c) => c.url.endsWith('/api/a2a/register'))!.init!.body));
		expect(reg.watermark).toBe(-1);
		expect(result.note).toContain('untracked watermark');
	});

	it('register failure → ok: true with "sent, but untracked"', async () => {
		mentionRoutes({ sessions: [spineRow()], registerOk: false });
		registerAddPanel(() => {});
		const result = await executeCommand(parseCommand(`@session-${TARGET_UUID} ping`)!, ctx());
		expect(result.ok).toBe(true);
		expect(result.note).toContain('sent, but untracked');
	});

	it('onNote fires at the ORIGINAL typed-path points (receipt before register)', async () => {
		mentionRoutes({ sessions: [spineRow()] });
		registerAddPanel(() => {});
		const notes: Array<{ ok: boolean; text: string }> = [];
		await executeCommand(parseCommand(`@session-${TARGET_UUID} ping`)!, ctx(), (ok, text) =>
			notes.push({ ok, text })
		);
		expect(notes).toEqual([{ ok: true, text: 'sent to TE-LO-LET — panel opened' }]);
	});

	it('register-failure path: onNote REPLACED with the standalone untracked error (typed-path bytes)', async () => {
		mentionRoutes({ sessions: [spineRow()], registerOk: false });
		registerAddPanel(() => {});
		const notes: Array<{ ok: boolean; text: string }> = [];
		await executeCommand(parseCommand(`@session-${TARGET_UUID} ping`)!, ctx(), (ok, text) =>
			notes.push({ ok, text })
		);
		expect(notes).toHaveLength(2);
		expect(notes[1]).toEqual({
			ok: false,
			text: 'sent, but untracked — the delegation ledger is unavailable'
		});
	});
});

// ── sendPrompt (record guard) ───────────────────────────────────────────

describe('sendPrompt — one /use per admitted ORDINARY send', () => {
	it('admitted ordinary text → ok + one /api/prompts/use POST with the text', async () => {
		const uses: string[] = [];
		stubFetch([
			{
				test: (url) => url.endsWith('/api/prompts/use'),
				respond: () => {
					// body captured via calls
					return jsonRes({ ok: true });
				}
			}
		]);
		// capture bodies via a wrapper: stub again with recording
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/prompts/use')) uses.push(JSON.parse(String(init?.body ?? '{}')).text);
				return jsonRes({ ok: true });
			})
		);
		const result = await sendPrompt('hello world', ctx(), async () => true);
		expect(result.ok).toBe(true);
		await vi.waitFor(() => expect(uses).toEqual(['hello world']));
	});

	it('control traffic never records (/ @ . ? lines)', async () => {
		const uses: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/prompts/use')) uses.push(JSON.parse(String(init?.body ?? '{}')).text);
				return jsonRes({ ok: true });
			})
		);
		await sendPrompt('/new', ctx(), async () => true);
		await sendPrompt('@target hi', ctx(), async () => true);
		await sendPrompt('.ghost', ctx(), async () => true);
		await sendPrompt('?query', ctx(), async () => true);
		await sendPrompt('   ', ctx(), async () => true);
		await new Promise((r) => setTimeout(r, 20));
		expect(uses).toEqual([]);
	});

	it('rejected send → ok: false, no record', async () => {
		const uses: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/prompts/use')) uses.push(JSON.parse(String(init?.body ?? '{}')).text);
				return jsonRes({ ok: true });
			})
		);
		const result = await sendPrompt('hello', ctx(), async () => false);
		expect(result.ok).toBe(false);
		await new Promise((r) => setTimeout(r, 20));
		expect(uses).toEqual([]);
	});

	it('record fetch failure is silent (never blocks the send result)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/prompts/use')) throw new Error('ledger down');
				return jsonRes({ ok: true });
			})
		);
		const result = await sendPrompt('hello', ctx(), async () => true);
		expect(result.ok).toBe(true);
	});
});

describe('Slash Menu W1 (task 1.4) — the host-command ladder rung', () => {
	const CATALOG = [
		{ name: 'compact', description: 'Compact older conversation history' },
		{ name: 'feedback', description: 'record feedback', input: { hint: '<text>' } },
		{ name: 'permission', description: 'preset' }
	];

	it('resolveHostCommand: exact case-insensitive first-token match against the catalog', () => {
		expect(resolveHostCommand('/compact', CATALOG)?.name).toBe('compact');
		expect(resolveHostCommand('/COMPACT', CATALOG)?.name).toBe('compact');
		expect(resolveHostCommand('/Feedback some words', CATALOG)?.name).toBe('feedback');
		expect(resolveHostCommand('/compacting', CATALOG)).toBeNull(); // never a prefix match
		expect(resolveHostCommand('/nope', CATALOG)).toBeNull();
		expect(resolveHostCommand('plain text', CATALOG)).toBeNull(); // non-slash never matches
		expect(resolveHostCommand('  /compact  ', CATALOG)?.name).toBe('compact'); // trimmed
	});

	it('executeHostCommand: fires the command route with the verbatim line and surfaces receipt text', async () => {
		let seen: { url: string; body: string } | undefined;
		const { calls } = stubFetch([
			{
				test: (url) => url.endsWith('/command'),
				respond: () => jsonRes({ ok: true, executed: true, commandId: 'cmd-7', text: 'compacted 12 turns' })
			}
		]);
		const notes: Array<{ ok: boolean; note: string }> = [];
		const result = await executeHostCommand('/compact   keep-spaces', ctx(), (ok, note) => notes.push({ ok, note }));
		expect(result).toEqual({ ok: true, note: 'compacted 12 turns' });
		expect(notes).toEqual([{ ok: true, note: 'compacted 12 turns' }]);
		seen = { url: calls[0]?.url ?? '', body: String(calls[0]?.init?.body) };
		expect(seen.url).toBe(`/api/dsh/session/${SELF}/command`);
		expect(JSON.parse(seen.body)).toEqual({ line: '/compact   keep-spaces' });
		expect(calls.length).toBe(1);
	});

	it('admission miss (executed:false) → honest ok:false note, draft-kept semantics, NO prompt POST', async () => {
		let promptPosted = false;
		stubFetch([
			{
				test: (url) => url.endsWith('/command'),
				respond: () => jsonRes({ ok: true, executed: false })
			},
			{
				test: (url) => url.endsWith('/prompt') || url.includes('/api/prompts/use'),
				respond: () => {
					promptPosted = true;
					return jsonRes({ ok: true });
				}
			}
		]);
		const notes: string[] = [];
		const result = await executeHostCommand('/gone-cmd', ctx(), (_ok, note) => notes.push(note));
		expect(result.ok).toBe(false);
		expect(result.note).toContain('unknown command');
		expect(result.note).toContain('nothing was sent');
		expect(notes.length).toBe(1);
		expect(promptPosted).toBe(false); // the RCA incident stays impossible
	});

	it('command-error arm and wire failure both report honestly (ok:false + message)', async () => {
		stubFetch([
			{ test: (url) => url.endsWith('/command'), respond: () => jsonRes({ ok: false, error: { code: 'command-error', message: 'plan mode unavailable' } }) }
		]);
		const errResult = await executeHostCommand('/plan off', ctx());
		expect(errResult).toEqual({ ok: false, note: 'plan mode unavailable' });

		stubFetch([
			{ test: (url) => url.endsWith('/command'), respond: () => new Response('upstream down', { status: 503 }) }
		]);
		const wireResult = await executeHostCommand('/plan off', ctx());
		expect(wireResult.ok).toBe(false);
		expect(wireResult.note).toContain('HTTP 503');
	});

	it('collision is structural: resolveHostCommand matches commands only — a name shared with a skill resolves to the command', () => {
		// The ladder consults ONLY the command catalog; skills ride the
		// passthrough rung by design (native adjudication — Resolved decision 3).
		const both = [...CATALOG];
		const hit = resolveHostCommand('/permission workspace-write', both);
		expect(hit?.name).toBe('permission');
		expect(resolveHostCommand('/dsh-doc', both)).toBeNull(); // skills never match the rung
	});

	it('typed gestures keep priority: parseCommand hits never reach the rung (ladder contract, Resolved decision 6)', () => {
		// The CALLER runs parseCommand first; pinned here: a gesture line DOES
		// parse (so the panel never consults the rung for it), while the same
		// name in the host catalog would also match — precedence is upstream.
		expect(parseCommand('/permission read-only')?.type).toBe('permission');
		expect(parseCommand('/new')?.type).toBe('new');
		// But a catalog hit that parseCommand declines is exactly the rung domain:
		expect(parseCommand('/compact')).toBeNull();
		expect(resolveHostCommand('/compact', CATALOG)?.name).toBe('compact');
	});
});


// ── /dsi-prompts executor (re-aimed 2026-09-17, The Focus Command ADR D1) ──
describe('executeCommand — /dsi-prompts (Focus Command)', () => {
	it('bare adds (aims) a manager panel after the session — never a swap', async () => {
		const adds: PanelAddRequest[] = [];
		registerAddPanel((request) => adds.push(request));
		registerReplacePanel(() => {
			throw new Error('must not replace');
		});
		const result = await executeCommand(parseCommand('/dsi-prompts')!, ctx());
		expect(result).toEqual({ ok: true });
		expect(adds).toEqual([{ kind: 'prompt-manager', afterSessionId: SELF }]);
	});

	it('retired --add is a usage error, nothing fires (D2)', async () => {
		registerAddPanel(() => {
			throw new Error('must not fire');
		});
		const result = await executeCommand(parseCommand('/dsi-prompts --add')!, ctx());
		expect(result).toEqual({ ok: false, note: 'usage: /dsi-prompts' });
	});

	it('off-floor composer (no panelId) gets the honest floor note', async () => {
		registerAddPanel(() => true);
		const result = await executeCommand(parseCommand('/dsi-prompts')!, ctx({ panelId: null }));
		expect(result).toEqual({
			ok: false,
			note: '/dsi-prompts needs a panel floor (open this session on the floor first)'
		});
	});

	it('leftover args are a usage error, nothing fires', async () => {
		registerAddPanel(() => {
			throw new Error('must not fire');
		});
		const result = await executeCommand(parseCommand('/dsi-prompts leftover')!, ctx());
		expect(result).toEqual({ ok: false, note: 'usage: /dsi-prompts' });
	});

	it('floor not mounted: honest note from the add miss', async () => {
		registerAddPanel(null); // no floor mounted — the registry returns false
		const result = await executeCommand(parseCommand('/dsi-prompts')!, ctx());
		expect(result).toEqual({ ok: false, note: '/dsi-prompts: the floor is not mounted' });
	});
});

// ── /dsi-settings + /dsh-settings executor (re-aimed 2026-09-17, Focus Command D1) ──
describe('executeCommand — /dsi-settings + /dsh-settings (Focus Command)', () => {
	it('bare adds (aims) a dsi settings panel after the session — never a swap', async () => {
		const adds: PanelAddRequest[] = [];
		registerAddPanel((request) => adds.push(request));
		registerReplacePanel(() => {
			throw new Error('must not replace');
		});
		const result = await executeCommand(parseCommand('/dsi-settings')!, ctx());
		expect(result).toEqual({ ok: true });
		expect(adds).toEqual([{ kind: 'settings-home', home: 'dsi', afterSessionId: SELF }]);
	});

	it('bare dshsettings adds a dsh settings panel after the session', async () => {
		const adds: PanelAddRequest[] = [];
		registerAddPanel((request) => adds.push(request));
		const result = await executeCommand(parseCommand('/dsh-settings')!, ctx());
		expect(result).toEqual({ ok: true });
		expect(adds).toEqual([{ kind: 'settings-home', home: 'dsh', afterSessionId: SELF }]);
	});

	it('retired --add is a usage error under its own command name (D2)', async () => {
		registerAddPanel(() => {
			throw new Error('must not fire');
		});
		const result = await executeCommand(parseCommand('/dsh-settings --add')!, ctx());
		expect(result).toEqual({ ok: false, note: 'usage: /dsh-settings' });
	});

	it('off-floor composer gets the honest floor note under its own command name', async () => {
		registerAddPanel(() => true);
		const result = await executeCommand(parseCommand('/dsh-settings')!, ctx({ panelId: null }));
		expect(result).toEqual({
			ok: false,
			note: '/dsh-settings needs a panel floor (open this session on the floor first)'
		});
	});

	it('leftover args are a usage error, nothing fires', async () => {
		registerAddPanel(() => {
			throw new Error('must not fire');
		});
		const result = await executeCommand(parseCommand('/dsi-settings leftover')!, ctx());
		expect(result).toEqual({ ok: false, note: 'usage: /dsi-settings' });
	});

	it('floor not mounted: honest note from the add miss', async () => {
		registerAddPanel(null); // no floor mounted — the registry returns false
		const result = await executeCommand(parseCommand('/dsh-settings')!, ctx());
		expect(result).toEqual({ ok: false, note: '/dsh-settings: the floor is not mounted' });
	});
});

// ── Loadinjected W3 3.2-T — /loadinjected (2026-09-07, ADR D2-D6) ──────

function spEntry(seq: number): DsiEntry {
	return { kind: 'system-prompt', id: `sp:${seq}`, seq, time: seq, text: 'the prompt' };
}
function instrEntry(seq: number, path: string): DsiEntry {
	return {
		kind: 'user-message',
		id: `u:${seq}`,
		seq,
		time: seq,
		text: `Instructions from: ${path}\n\ninjected`,
		meta: 'instructions',
		metaSource: { changes: [{ action: 'set', scope: path, path, digest: 'd' }] }
	};
}

describe('executeCommand — /loadinjected (2.1-T, retired typed surface + constructor shapes)', () => {
	const entries: DsiEntry[] = [spEntry(1), instrEntry(2, 'AGENTS.md')];

	it('every TYPED shape gets the D2 retirement note — no request ever fires', async () => {
		const seen: PanelAddRequest[] = [];
		const swaps: Array<{ panelId: string } & PanelAddRequest> = [];
		registerAddPanel((r) => seen.push(r));
		registerReplacePanel((panelId, r) => swaps.push({ panelId, ...r }));
		const note = '/loadinjected retired — open injected documents with the Injected button on the conversation anchor';
		for (const line of [
			'/loadinjected',
			'/loadinjected AGENTS.md',
			'/loadinjected AGENTS.md --add',
			'/loadinjected NOPE.md',
			'/loadinjected ?'
		]) {
			const result = await executeCommand(parseCommand(line)!, ctx({ entries }));
			expect(result).toEqual({ ok: false, note });
		}
		expect(seen).toEqual([]);
		expect(swaps).toEqual([]);
	});

	it('constructor shape, no floor: the honest panel-floor note under its own command name', async () => {
		const result = await executeCommand(
			loadinjectedCommand('AGENTS.md'),
			ctx({ entries, panelId: null })
		);
		expect(result).toEqual({
			ok: false,
			note: '/loadinjected needs a panel floor (open this session on the floor first)'
		});
	});

	it('constructor shape, no match: the honest note lists the shelf candidates in order', async () => {
		const result = await executeCommand(loadinjectedCommand('NOPE.md'), ctx({ entries }));
		expect(result).toEqual({
			ok: false,
			note: '/loadinjected: no injected NOPE.md here — the shelf holds: system-prompt.md, AGENTS.md'
		});
	});

	it('constructor shape, empty shelf: the honest nothing-injected note', async () => {
		const result = await executeCommand(loadinjectedCommand('AGENTS.md'), ctx({ entries: [] }));
		expect(result).toEqual({
			ok: false,
			note: '/loadinjected: nothing was injected into this conversation yet'
		});
	});

	it('constructor --add: the injected-doc add request flows verbatim (the anchor rides sourceSessionId)', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		const result = await executeCommand(loadinjectedCommand('AGENTS.md', { add: true }), ctx({ entries }));
		expect(result).toEqual({ ok: true });
		expect(seen).toEqual([
			{ kind: 'injected-doc', sourceSessionId: SELF, displayPath: 'AGENTS.md', afterSessionId: SELF }
		]);
	});

	it('constructor bare: the successor-swap targets the panel it ran in (D4); dedupe stays the floor’s (D5)', async () => {
		const swaps: Array<{ panelId: string } & PanelAddRequest> = [];
		registerReplacePanel((panelId, r) => swaps.push({ panelId, ...r }));
		const result = await executeCommand(loadinjectedCommand('AGENTS.md'), ctx({ entries }));
		expect(result).toEqual({ ok: true });
		expect(swaps).toEqual([
			{
				panelId: 'p1',
				kind: 'injected-doc',
				sourceSessionId: SELF,
				displayPath: 'AGENTS.md',
				afterSessionId: SELF
			}
		]);
	});

	it('a unique basename resolves (D4) — RULES.md finds docs/nested/RULES.md', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		const rich = [...entries, instrEntry(3, 'docs/nested/RULES.md')];
		const result = await executeCommand(
			loadinjectedCommand('RULES.md', { add: true }),
			ctx({ entries: rich })
		);
		expect(result).toEqual({ ok: true });
		expect(seen[0]).toMatchObject({ kind: 'injected-doc', displayPath: 'docs/nested/RULES.md' });
	});

	it('floor not mounted on constructor --add: honest note from the registry miss', async () => {
		const result = await executeCommand(
			loadinjectedCommand('AGENTS.md', { add: true }),
			ctx({ entries })
		);
		expect(result).toEqual({ ok: false, note: '/loadinjected: the floor is not mounted' });
	});

	it('a WORKSPACE-ABSOLUTE constructor filename normalizes before resolution (pasted full path)', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		const rich = [...entries, instrEntry(3, 'deepseek-insight/AGENTS.md')];
		// ctx() carries workspace '/w/proj' — the pasted absolute path
		// prefixes down to the shelf's displayPath and resolves.
		const result = await executeCommand(
			loadinjectedCommand('/w/proj/deepseek-insight/AGENTS.md', { add: true }),
			ctx({ entries: rich })
		);
		expect(result).toEqual({ ok: true });
		expect(seen[0]).toMatchObject({
			kind: 'injected-doc',
			sourceSessionId: SELF,
			displayPath: 'deepseek-insight/AGENTS.md'
		});
	});

	it('a ~ home-relative constructor filename stays verbatim — exact shelf match or honest note', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		const rich = [...entries, instrEntry(4, '~/.dsh/AGENTS.md')];
		const result = await executeCommand(
			loadinjectedCommand('~/.dsh/AGENTS.md', { add: true }),
			ctx({ entries: rich })
		);
		expect(result).toEqual({ ok: true });
		expect(seen[0]).toMatchObject({
			kind: 'injected-doc',
			sourceSessionId: SELF,
			displayPath: '~/.dsh/AGENTS.md'
		});
	});
});

describe('/dsi-terminal desk grammar (Terminal Desk ADR D2, 2026-09-24)', () => {
	function ctx(): ExecutorContext {
		return { sessionId: SELF, workspace: null, agent: null, panelId: 'p1' };
	}

	it('bare command requests a terminal with NO action key', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((req) => seen.push(req));
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ enabled: true })));
		const res = await executeCommand(parseCommand('/dsi-terminal')!, ctx(), undefined);
		expect(res.ok).toBe(true);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ kind: 'terminal' });
		expect('action' in seen[0]).toBe(false);
	});

	it('--new-tab forwards action new-tab on the request', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((req) => seen.push(req));
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ enabled: true })));
		const res = await executeCommand(parseCommand('/dsi-terminal --new-tab')!, ctx(), undefined);
		expect(res.ok).toBe(true);
		expect(seen[0]).toMatchObject({ kind: 'terminal', action: 'new-tab' });
	});

	it('--split-down forwards action split-down on the request', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((req) => seen.push(req));
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ enabled: true })));
		const res = await executeCommand(parseCommand('/dsi-terminal --split-down')!, ctx(), undefined);
		expect(res.ok).toBe(true);
		expect(seen[0]).toMatchObject({ kind: 'terminal', action: 'split-down' });
	});

	it('both flags together usage-error and never reach the floor', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((req) => seen.push(req));
		const onNote = vi.fn();
		const res = await executeCommand(parseCommand('/dsi-terminal --new-tab --split-down')!, ctx(), onNote);
		expect(res.ok).toBe(false);
		expect(onNote).toHaveBeenCalledWith(false, 'usage: /dsi-terminal [--new-tab | --split-down]');
		expect(seen).toHaveLength(0);
	});
});


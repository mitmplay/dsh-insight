/**
 * command-new-title tests (2026-10-29, The Workspace Command ADR amendment
 * D7/D8): /new gains --title <title> — the parser captures the remainder
 * verbatim (no quoting grammar), the executor applies it through the
 * session-rename route the fork spine already uses, best-effort and silent
 * on failure, BEFORE the panel mounts. The create wire never grows a title
 * field. Pairs with the spec dev/specs/2026-10/2026-10-29 - DSI New Title/.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommand } from '$lib/services/chat/command-parser';
import { executeCommand, type ExecutorContext } from '$lib/services/chat/command-executor';
import { commandHelpTopic, COMMAND_HELP } from '$lib/services/chat/command-help';
import {
	registerAddPanel,
	registerReplacePanel,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
const NEW_ID = 'session-22222222-0000-4000-8000-000000000002';

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

const CREATE = {
	test: (url: string, init?: RequestInit) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
	respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
};
const isRename = (url: string) => url.endsWith(`/api/dsh/session/${NEW_ID}/rename`);

// ── parser: the --title grammar (D8) ────────────────────────────────────

describe('parseCommand — /new --title (2026-10-29, D8)', () => {
	it('title only: the remainder IS the title, whitespace-joined, verbatim', () => {
		expect(parseCommand('/new --title My Task')).toEqual({
			type: 'new',
			args: '',
			title: 'My Task'
		});
	});

	it('@agent + title', () => {
		expect(parseCommand('/new @ptc --title Recipe Run')).toEqual({
			type: 'new',
			args: '',
			agentId: 'ptc',
			title: 'Recipe Run'
		});
	});

	it('ws + title', () => {
		expect(parseCommand('/new recipe-ws --title Morning Build')).toEqual({
			type: 'new',
			args: '',
			ws: 'recipe-ws',
			title: 'Morning Build'
		});
	});

	it('all four fields: @agent ws --title ... --add', () => {
		expect(parseCommand('/new @app-dev ws-ai --title Refactor Auth --add')).toEqual({
			type: 'new',
			args: '',
			agentId: 'app-dev',
			ws: 'ws-ai',
			title: 'Refactor Auth',
			addPanel: true
		});
	});

	it('bare --title: malformed shape → raw args (the leftover rule)', () => {
		expect(parseCommand('/new --title')).toEqual({ type: 'new', args: '--title' });
	});

	it('leftover tokens before the flag stay raw args', () => {
		expect(parseCommand('/new a b --title X')).toEqual({ type: 'new', args: 'a b --title X' });
	});

	it('a mid-title --add token is NOT the flag; only the trailing one strips', () => {
		expect(parseCommand('/new --title keep --add here')).toEqual({
			type: 'new',
			args: '',
			title: 'keep --add here'
		});
	});

	it('regression: the pinned shapes stay byte-identical', () => {
		expect(parseCommand('/new')).toEqual({ type: 'new', args: '' });
		expect(parseCommand('/new @app-dev')).toEqual({ type: 'new', args: '', agentId: 'app-dev' });
		expect(parseCommand('/new --add')).toEqual({ type: 'new', args: '', addPanel: true });
		expect(parseCommand('/new @app-dev --add')).toEqual({
			type: 'new',
			args: '',
			agentId: 'app-dev',
			addPanel: true
		});
		expect(parseCommand('/new --add @app-dev')).toEqual({ type: 'new', args: '--add @app-dev' });
		expect(parseCommand('/new ws')).toEqual({ type: 'new', args: '', ws: 'ws' });
		expect(parseCommand('/new ws --add')).toEqual({ type: 'new', args: '', ws: 'ws', addPanel: true });
		expect(parseCommand('/new ?')).toEqual({ type: 'new', args: '?' });
	});
});

// ── executor: the rename-after-create wire (D7) ─────────────────────────

describe('executeCommand — /new --title (2026-10-29, D7)', () => {
	it('renames the born session BEFORE the panel mounts; create body never carries the title', async () => {
		const { calls } = stubFetch([CREATE]);
		const swaps: Array<{ sessionId: string } & PanelAddRequest> = [];
		registerReplacePanel((_panelId, request) => {
			if ('sessionId' in request) swaps.push({ ...request, sessionId: request.sessionId });
		});

		const result = await executeCommand(parseCommand('/new --title My Task')!, ctx());

		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions'))!;
		expect(create).toBeDefined();
		expect(JSON.parse(String(create.init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'main' });
		const rename = calls.find((c) => isRename(c.url));
		expect(rename).toBeDefined();
		expect(rename!.init!.method).toBe('POST');
		expect(JSON.parse(String(rename!.init!.body))).toEqual({ title: 'My Task' });
		// Order: create (calls[0]) → rename (calls[1]) → swap (after both).
		expect(calls[1].url).toBe(rename!.url);
		expect(swaps).toHaveLength(1);
	});

	it('--add path: rename fires before addPanel too', async () => {
		const { calls } = stubFetch([CREATE]);
		const adds: PanelAddRequest[] = [];
		registerAddPanel((request) => adds.push(request));

		await executeCommand(parseCommand('/new @app-dev --title Side Panel --add')!, ctx());

		const rename = calls.find((c) => isRename(c.url));
		expect(rename).toBeDefined();
		expect(JSON.parse(String(rename!.init!.body))).toEqual({ title: 'Side Panel' });
		expect(adds).toEqual([
			{ sessionId: NEW_ID, agentPreset: 'app-dev', afterSessionId: SELF, keepSelection: true }
		]);
	});

	it('create failure → NO rename call, honest note', async () => {
		const { calls } = stubFetch([
			{ ...CREATE, respond: () => jsonRes({ ok: false, error: { message: 'nope' } }, 500) }
		]);
		const result = await executeCommand(parseCommand('/new --title X')!, ctx());
		expect(result.ok).toBe(false);
		expect(calls.find((c) => isRename(c.url))).toBeUndefined();
	});

	it('rename 500 → the birth still succeeds, silently (best-effort, D7b)', async () => {
		stubFetch([
			CREATE,
			{ test: (url) => isRename(url), respond: () => jsonRes({ ok: false }, 500) }
		]);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new --title Doomed Name')!, ctx());
		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
	});

	it('rename transport throw → the birth still succeeds, silently', async () => {
		stubFetch([
			CREATE,
			{
				test: (url) => isRename(url),
				respond: () => {
					throw new Error('socket burned');
				}
			}
		]);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new --title Doomed Name')!, ctx());
		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
	});

	it('no title → no rename call (regression)', async () => {
		const { calls } = stubFetch([CREATE]);
		await executeCommand(parseCommand('/new')!, ctx());
		expect(calls.find((c) => isRename(c.url))).toBeUndefined();
	});

	it('malformed shape → the widened usage note, zero wire traffic (lockstep)', async () => {
		const { calls } = stubFetch([]);
		const result = await executeCommand(parseCommand('/new a b --title X')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toBe('usage: /new [@agent] [workspace] [--title <title>] [--add]');
		expect(calls).toHaveLength(0);
	});
});

// ── help card: the one copy source (D6 rule) ────────────────────────────

describe('command help — /new ? carries the --title copy', () => {
	it('the topic resolves and the card carries usage, param, example', () => {
		expect(commandHelpTopic('/new ?')).toBe('new');
		const card = COMMAND_HELP.new;
		expect(card.usage).toBe('/new [@agent] [workspace] [--title <title>] [--add]');
		expect(card.params.some((p) => p.name === '--title <title>')).toBe(true);
		expect(
			card.examples.some((e) => e.line === '/new @app-dev --title Refactor Auth --add')
		).toBe(true);
	});
});

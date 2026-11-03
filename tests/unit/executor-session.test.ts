/**
 * executor/session edge tests — direct calls to runNewLine over stubbed
 * fetch and the panel-registry seams (the house pattern). Every guard arm,
 * the workspace resolution, --title, --add, swap and fresh-install branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNewLine } from '$lib/services/chat/executor/session';
import {
	registerAddPanel,
	registerReplacePanel,
	registerReplacePanelBySession,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import type { ExecutorContext } from '$lib/services/chat/command-executor';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
function ctx(over: Partial<ExecutorContext> = {}): ExecutorContext {
	return { sessionId: SELF, workspace: '/w/inherited', agent: 'base-agent', panelId: 'p1', ...over };
}
function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(routes: Array<{ test: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Response }>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : String(input);
		calls.push({ url, init });
		for (const r of routes) if (r.test(url, init)) return r.respond(url, init);
		return jsonRes({ ok: false }, 404);
	}));
	return calls;
}
const createOk = (id = 'session-33333333-0000-4000-8000-000000000003') => ({ ok: true, sessionId: id });

afterEach(() => {
	resetPanelRegistryForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('runNewLine — guards', () => {
	it('leftover args refuse before any wire; panelId null is the floor note', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const notes: Array<[boolean, string]> = [];
		const r1 = await runNewLine({ args: 'extra' }, ctx(), (ok, n) => notes.push([ok, n]));
		expect(r1).toEqual({ ok: false, note: 'usage: /new [@agent] [workspace] [--title <title>] [--add]' });
		const r2 = await runNewLine({ args: '' }, ctx({ panelId: null }));
		expect(r2).toEqual({ ok: false, note: '/new needs a panel floor (open this session on the floor first)' });
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(notes).toEqual([[false, 'usage: /new [@agent] [workspace] [--title <title>] [--add]']]);
	});

	it('an unresolvable workspace token is the resolver note, no create', async () => {
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: true, workspaces: [] }) }
		]);
		const notes: Array<[boolean, string]> = [];
		const r = await runNewLine({ args: '', ws: 'nowhere' }, ctx(), (ok, n) => notes.push([ok, n]));
		expect(r.ok).toBe(false);
		expect(r.note).toContain('nowhere');
		expect(notes.length).toBe(1);
		expect(calls.some((c) => c.init?.method === 'POST' && c.url.endsWith('/api/dsh/sessions'))).toBe(false);
	});
});

describe('runNewLine — the create path', () => {
	it('create failure surfaces error.message, then the HTTP-status fallback', async () => {
		registerReplacePanelBySession(() => true);
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: false, error: { message: 'quota' } }, 402) }
		]);
		const r1 = await runNewLine({ args: '' }, ctx());
		expect(r1).toEqual({ ok: false, note: 'quota' });
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => new Response('nope', { status: 503 }) }
		]);
		const r2 = await runNewLine({ args: '' }, ctx());
		expect(r2).toEqual({ ok: false, note: '/new failed (HTTP 503)' });
	});

	it('create rejection carries the error message', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		const r = await runNewLine({ args: '' }, ctx());
		expect(r).toEqual({ ok: false, note: '/new failed (offline)' });
	});

	it('swap path: session-addressed replace wins, preset inherits, fresh-install note fires', async () => {
		const swapped: Array<[string | null, unknown]> = [];
		registerReplacePanelBySession((sid, req) => { swapped.push([sid, req]); return true; });
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(createOk()) }
		]);
		const notes: Array<[boolean, string]> = [];
		const r = await runNewLine({ args: '' }, ctx({ workspace: null }), (ok, n) => notes.push([ok, n]));
		expect(r).toEqual({ ok: true, newSessionId: createOk().sessionId, note: '/new: no workspace inherited — this session lands UNGROUPED; adopt one with /workspace <full-path>, then aim with /new <name>' });
		expect(swapped[0][0]).toBe(SELF);
		expect(swapped[0][1]).toMatchObject({ sessionId: createOk().sessionId, agentPreset: 'base-agent', focus: true });
		const body = JSON.parse(String(calls[0].init!.body));
		expect(body).toEqual({ agentPreset: 'base-agent' });
		expect(notes).toEqual([[true, r.note]]);
	});

	it('session swap miss falls back to the panel-id replace; a double miss is the floor note', async () => {
		registerReplacePanelBySession(() => false);
		registerReplacePanel((pid, req) => { expect(pid).toBe('p1'); return true; });
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(createOk()) }]);
		const r1 = await runNewLine({ args: '' }, ctx());
		expect(r1.ok).toBe(true);
		registerReplacePanel(null);
		const r2 = await runNewLine({ args: '' }, ctx());
		expect(r2).toEqual({ ok: false, note: '/new: the floor is not mounted' });
	});

	it('a resolved ws displaces the inherited cwd in the create body; @agent overrides the preset', async () => {
		registerReplacePanelBySession(() => true);
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: (u, i) => i?.method === 'POST' ? jsonRes(createOk()) : jsonRes({ ok: true, workspaces: [{ title: 'Alpha', path: '/w/exact' }] }) }
		]);
		const r = await runNewLine({ args: '', ws: '/w/exact', agentId: 'app-dev' }, ctx());
		expect(r.ok).toBe(true);
		const create = calls[calls.length - 1];
		expect(JSON.parse(String(create.init!.body))).toEqual({ cwd: '/w/exact', agentPreset: 'app-dev' });
	});

	it('--title rides the rename route; a rename throw is swallowed (D7)', async () => {
		registerReplacePanelBySession(() => true);
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(createOk()) },
			{ test: (u) => u.includes('/rename'), respond: () => { throw new Error('rename down'); } }
		]);
		const r = await runNewLine({ args: '', title: 'My Title' }, ctx());
		expect(r.ok).toBe(true);
		const ren = calls.find((c) => c.url.includes('/rename'))!;
		expect(ren.url).toBe('/api/dsh/session/' + createOk().sessionId + '/rename');
		expect(JSON.parse(String(ren.init!.body))).toEqual({ title: 'My Title' });
	});

	it('--add opens a NEW panel anchored here with keepSelection; the fresh-install note fires', async () => {
		const added: unknown[] = [];
		registerAddPanel((req) => { added.push(req); });
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(createOk()) }]);
		const notes: Array<[boolean, string]> = [];
		const r = await runNewLine({ args: '', addPanel: true }, ctx({ workspace: null }), (ok, n) => notes.push([ok, n]));
		expect(r.ok).toBe(true);
		expect(r.note).toContain('UNGROUPED');
		expect(added).toEqual([{ sessionId: createOk().sessionId, agentPreset: 'base-agent', afterSessionId: SELF, keepSelection: true }]);
		expect(notes.length).toBe(1);
	});

	it('--add on a floor-less shell is the not-mounted note', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(createOk()) }]);
		const r = await runNewLine({ args: '', addPanel: true }, ctx({ workspace: '/w' }));
		expect(r).toEqual({ ok: false, note: '/new: the floor is not mounted' });
	});
});

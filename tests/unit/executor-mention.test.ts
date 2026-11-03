/**
 * executor/mention edge tests — direct calls to runMention over stubbed
 * fetch and the panel-registry seams (the house pattern from
 * executor-workspace-edges / executor-panels-edges). Every guard arm and
 * ledger outcome of the @session verb, no composer shell.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMention } from '$lib/services/chat/executor/mention';
import {
	registerAddPanel,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import type { ExecutorContext } from '$lib/services/chat/command-executor';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
const OTHER = '22222222-0000-4000-8000-000000000002';
function ctx(over: Partial<ExecutorContext> = {}): ExecutorContext {
	return { sessionId: SELF, workspace: null, agent: null, panelId: 'p1', ...over };
}
function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const sessionsBody = (rows: unknown[]) => ({ ok: true, sessions: rows });
const row = { sessionId: 'session-' + OTHER, title: 'Twin', agentPreset: 'app-dev', running: true, turns: 4 };

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

afterEach(() => {
	resetPanelRegistryForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('runMention — guards before any wire', () => {
	it('empty message is a usage no-op with no fetch', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const r = await runMention(OTHER, '', undefined, ctx());
		expect(r).toEqual({ ok: false, note: 'usage: @<session-id> <message> — the message is empty' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('self-mention (uuid tail, prefix tolerated) just talks', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const r1 = await runMention('11111111-0000-4000-8000-000000000001', 'hi', undefined, ctx());
		const r2 = await runMention(SELF.replace(/^session-/, ''), 'hi', undefined, ctx());
		expect(r1).toEqual({ ok: true, note: 'that is this session — just type your message' });
		expect(r2.note).toBe(r1.note);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('runMention — the spine look', () => {
	it('a failed list fetch is an honest retry note, never a fib', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
		const r = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r).toEqual({ ok: false, note: 'session list unavailable — try again' });
	});

	it('a list without the id sends NOTHING', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([row])) }]);
		const r = await runMention('99999999-0000-4000-8000-000000000009', 'hi', undefined, ctx());
		expect(r).toEqual({ ok: false, note: 'no such session: 99999999-0000-4000-8000-000000000009 — nothing was sent' });
	});

	it('a non-ok list reply is the same no-such-session note', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: false }, 500) }]);
		const r = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r.note).toContain('no such session');
	});
});

describe('runMention — the send path', () => {
	it('happy queued path: panel opens, notes fire, register records', async () => {
		const added: unknown[] = [];
		registerAddPanel((req) => { added.push(req); });
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([row])) },
			{ test: (u) => u.includes('/prompt'), respond: () => jsonRes({ ok: true }) },
			{ test: (u) => u.endsWith('/api/a2a/register'), respond: () => jsonRes({ ok: true }) }
		]);
		const notes: Array<[boolean, string]> = [];
		const r = await runMention(OTHER, 'hello', 'a2a-1', ctx(), (ok, n) => notes.push([ok, n]));
		expect(r).toEqual({ ok: true, note: "queued behind Twin's current turn — panel opened" });
		expect(added).toEqual([{ sessionId: 'session-' + OTHER, agentPreset: 'app-dev' }]);
		const prompt = calls.find((c) => c.url.includes('/prompt'))!;
		expect(prompt.url).toBe('/api/dsh/session/session-' + OTHER + '/prompt');
		expect(JSON.parse(String(prompt.init!.body)).text).toContain('a2a-1');
		const reg = calls.find((c) => c.url.endsWith('/api/a2a/register'))!;
		expect(JSON.parse(String(reg.init!.body))).toEqual({ from: SELF, to: 'session-' + OTHER, message: 'hello', watermark: 4, id: 'a2a-1' });
		expect(notes).toEqual([[true, "queued behind Twin's current turn — panel opened"]]);
	});

	it('running=false, title=null, turns=null: sent note + untracked watermark', async () => {
		registerAddPanel(() => {});
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([{ ...row, running: false, title: null, turns: null }])) },
			{ test: (u) => u.includes('/prompt'), respond: () => jsonRes({ ok: true }) },
			{ test: (u) => u.endsWith('/api/a2a/register'), respond: () => jsonRes({ ok: true }) }
		]);
		const notes: Array<[boolean, string]> = [];
		const r = await runMention(OTHER, 'hi', undefined, ctx(), (ok, n) => notes.push([ok, n]));
		const untracked = 'sent to session-' + OTHER + ' — untracked watermark: the spine row carries no turns count';
		expect(r.note).toBe(untracked);
		expect(notes[0]).toEqual([true, 'sent to session-' + OTHER + ' — panel opened']);
		expect(notes[1]).toEqual([true, untracked]);
	});

	it('a failed prompt body surfaces error.message; missing message falls back to HTTP status', async () => {
		registerAddPanel(() => {});
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([row])) },
			{ test: (u) => u.includes('/prompt'), respond: () => jsonRes({ ok: false, error: { message: 'queue full' } }, 429) }
		]);
		const r1 = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r1).toEqual({ ok: false, note: 'queue full' });
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([row])) },
			{ test: (u) => u.includes('/prompt'), respond: () => new Response('nope', { status: 503 }) }
		]);
		const r2 = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r2).toEqual({ ok: false, note: 'mention failed (HTTP 503)' });
	});

	it('a prompt fetch rejection carries the error message', async () => {
		registerAddPanel(() => {});
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith('/api/dsh/sessions')) return jsonRes(sessionsBody([row]));
			throw new Error('socket down');
		}));
		const r = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r).toEqual({ ok: false, note: 'mention failed (socket down)' });
	});

	it('no floor mounted refuses before any send', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([row])) }]);
		const r = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r).toEqual({ ok: false, note: '@session needs the panel floor (open this session on the floor first)' });
	});

	it('a failed register still returns ok:true with the untracked note', async () => {
		registerAddPanel(() => {});
		const notes: Array<[boolean, string]> = [];
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes(sessionsBody([{ ...row, running: false, turns: 2 }])) },
			{ test: (u) => u.includes('/prompt'), respond: () => jsonRes({ ok: true }) },
			{ test: (u) => u.endsWith('/api/a2a/register'), respond: () => jsonRes({ ok: false }, 500) }
		]);
		const r = await runMention(OTHER, 'hi', undefined, ctx(), (ok, n) => notes.push([ok, n]));
		expect(r).toEqual({ ok: true, note: 'sent, but untracked — the delegation ledger is unavailable' });
		expect(notes[notes.length - 1]).toEqual([false, 'sent, but untracked — the delegation ledger is unavailable']);
	});

	it('a register fetch rejection is the same untracked ok', async () => {
		registerAddPanel(() => {});
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/api/dsh/sessions')) return jsonRes(sessionsBody([{ ...row, running: false }]));
			if (url.includes('/prompt')) return jsonRes({ ok: true });
			throw new Error('ledger down');
		}));
		const r = await runMention(OTHER, 'hi', undefined, ctx());
		expect(r).toEqual({ ok: true, note: 'sent, but untracked — the delegation ledger is unavailable' });
	});
});

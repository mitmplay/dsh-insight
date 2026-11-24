/**
 * Desk-intent tests (spec 2026-11-24 Wire-Driven Visible Terminal Splits,
 * tasks 1.1-T + 1.2-T; ADR The Headless Split D2/D5). Real engine, real
 * route handlers, DSI_CONFIG_PATH seam — same posture as terminal-routes.
 *
 * Pins:
 *  - route: desk passthrough (valid / invalid / omitted), response shape
 *    byte-identical for headless mints, garbage desk never 400s;
 *  - registry: intent stored + echoed in list(), session-born event
 *    carries { sessionId, deskIntent, baton }, headless mints emit NO
 *    born event and no other event regression.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { GET as listRoute, POST as openRoute } from '../../src/routes/api/terminal/+server';
import { TerminalRegistry } from '$lib/server/terminal/registry.js';
import type { SessionBornEvent } from '$lib/server/terminal/registry.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

const cfgDirs: string[] = [];
const workDirs: string[] = [];
const registries: TerminalRegistry[] = [];

beforeEachTest();
function beforeEachTest(): void {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-desk-intent-'));
	cfgDirs.push(dir);
	process.env.DSI_CONFIG_PATH = join(dir, 'settings.yaml');
	writeFileSync(join(dir, 'settings.yaml'), 'terminal:\n  enabled: true\n', 'utf-8');
}

afterEach(async () => {
	delete process.env.DSI_CONFIG_PATH;
	for (const r of registries) await r.dispose();
	registries.length = 0;
	for (const d of [...cfgDirs, ...workDirs]) rmSync(d, { recursive: true, force: true });
	cfgDirs.length = 0;
	workDirs.length = 0;
});

function post(body: unknown): { request: Request } {
	return { request: new Request('http://localhost/api/terminal', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	}) };
}

function spec(): TerminalSpec {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-desk-intent-work-'));
	workDirs.push(dir);
	return {
		argv: ['/bin/bash', '--norc', '--noprofile', '-i'],
		cwd: dir,
		env: { PS1: '$ ' },
		rows: 24,
		cols: 80,
		terminalType: 'xterm-256color',
		graceMs: 1_000,
		idleMs: 200,
		tailBytes: 262_144
	};
}

describe('desk intent — route seam (1.1-T)', () => {
	it('desk split-down is threaded: list() echoes the intent', async () => {
		const open = await openRoute(post({ desk: 'split-down' })) as Response;
		expect(open.status).toBe(200);
		const body = await open.json() as { sessionId: string; token: string; fromByte: number; totalBytes: number };
		expect(typeof body.sessionId).toBe('string');
		expect(typeof body.token).toBe('string');
		const list = await listRoute() as Response;
		const sessions = (await list.json()) as { sessions: Array<{ id: string; deskIntent?: string }> };
		expect(sessions.sessions).toContainEqual(expect.objectContaining({ id: body.sessionId, deskIntent: 'split-down' }));
	});

	it('desk new-tab passes through identically', async () => {
		const open = await openRoute(post({ desk: 'new-tab' })) as Response;
		expect(open.status).toBe(200);
		const body = await open.json() as { sessionId: string };
		const list = await listRoute() as Response;
		const sessions = (await list.json()) as { sessions: Array<{ id: string; deskIntent?: string }> };
		expect(sessions.sessions).toContainEqual(expect.objectContaining({ id: body.sessionId, deskIntent: 'new-tab' }));
	});

	it('garbage desk is a headless mint — never a 400', async () => {
		for (const desk of ['bogus', 42, null, { mode: 'split' }]) {
			const open = await openRoute(post({ desk })) as Response;
			expect(open.status).toBe(200);
			const body = await open.json() as { sessionId: string };
			const list = await listRoute() as Response;
			const sessions = (await list.json()) as { sessions: Array<{ id: string; deskIntent?: string }> };
			const row = sessions.sessions.find((s) => s.id === body.sessionId);
			expect(row?.deskIntent).toBeUndefined();
		}
	});

	it('omitted desk keeps the headless response shape byte-identical', async () => {
		const open = await openRoute(post({})) as Response;
		expect(open.status).toBe(200);
		const body = await open.json() as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(['fromByte', 'sessionId', 'token', 'totalBytes']);
		// the singleton registry carries earlier tests' intent sessions — the
		// pin is about THIS mint, not the whole table
		const list = await listRoute() as Response;
		const sessions = (await list.json()) as { sessions: Array<{ id: string; deskIntent?: string }> };
		expect(sessions.sessions.find((s) => s.id === (body.sessionId as string))?.deskIntent).toBeUndefined();
	});
});

describe('desk intent — registry (1.2-T)', () => {
	it('intent stored, list() echoes it, born event carries { sessionId, deskIntent, baton }', () => {
		const r = new TerminalRegistry();
		registries.push(r);
		const born: SessionBornEvent[] = [];
		const off = r.onSessionBorn((e) => born.push(e));
		const { session } = r.create(spec(), { deskIntent: 'new-tab' });
		expect(born).toHaveLength(1);
		expect(born[0].sessionId).toBe(session.id);
		expect(born[0].deskIntent).toBe('new-tab');
		expect(born[0].baton).toMatchObject({ holder: 'operator' });
		const row = r.list().find((s) => s.id === session.id);
		expect(row?.deskIntent).toBe('new-tab');
		off();
	});

	it('headless mint: no born event, no deskIntent echo, baton frame unchanged', () => {
		const r = new TerminalRegistry();
		registries.push(r);
		const born: SessionBornEvent[] = [];
		r.onSessionBorn((e) => born.push(e));
		const events: string[] = [];
		const { session } = r.create(spec());
		expect(born).toHaveLength(0);
		expect(r.list().find((s) => s.id === session.id)?.deskIntent).toBeUndefined();
		// the mint's baton frame still flies on the session channel (ADR-0079
		// D7) — the create-time frame fired before we could attach, so catch
		// the next mint on the same session (a reattach)
		session.on('event', (e: { type: string }) => events.push(e.type));
		r.reattach(session.id);
		expect(events).toContain('baton');
		expect(born).toHaveLength(0);
	});

	it('unsubscribe stops delivery; a throwing listener never breaks the birth', () => {
		const r = new TerminalRegistry();
		registries.push(r);
		const born: SessionBornEvent[] = [];
		const off = r.onSessionBorn((e) => born.push(e));
		r.onSessionBorn(() => { throw new Error('dead subscriber'); });
		const { session } = r.create(spec(), { deskIntent: 'split-down' });
		off();
		off(); // idempotent
		const second = r.create(spec(), { deskIntent: 'split-down' });
		expect(born.map((e) => e.sessionId)).toEqual([session.id]);
		expect(second.session).toBeTruthy();
	});
});

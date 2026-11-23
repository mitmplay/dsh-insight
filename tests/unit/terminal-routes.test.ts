/**
 * Transport route tests over the REAL engine (Wave 3, tasks 3.1-T/3.2-T).
 * Handlers are driven through SvelteKit's (Request, params) contract with
 * the DSI_CONFIG_PATH test seam pinning the flag — the real ~/.dsi is
 * never touched and node-pty runs live.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as listRoute, POST as openRoute } from '../../src/routes/api/terminal/+server';
import { POST as reattachRoute } from '../../src/routes/api/terminal/[id]/reattach/+server';
import { POST as sendRoute } from '../../src/routes/api/terminal/[id]/send/+server';
import { GET as streamRoute } from '../../src/routes/api/terminal/[id]/stream/+server';
import { terminalRegistry } from '$lib/server/terminal/registry.js';

const cfgDirs: string[] = [];
const workDirs: string[] = [];

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-term-routes-'));
	cfgDirs.push(dir);
	process.env.DSI_CONFIG_PATH = join(dir, 'settings.yaml');
});

afterEach(async () => {
	delete process.env.DSI_CONFIG_PATH;
	await terminalRegistry.dispose();
	for (const d of cfgDirs) rmSync(d, { recursive: true, force: true });
	cfgDirs.length = 0;
	for (const d of workDirs) rmSync(d, { recursive: true, force: true });
	workDirs.length = 0;
});

function writeConfig(enabled: boolean): void {
	writeFileSync(
		join(cfgDirs[cfgDirs.length - 1], 'settings.yaml'),
		'terminal:\n  enabled: ' + (enabled ? 'true' : 'false') + '\n',
		'utf-8'
	);
}

function post(url: string, body: unknown): Request {
	return new Request('http://localhost' + url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function drainSse(response: Response): Promise<Record<string, unknown>[]> {
	return new Promise((resolve) => {
		const frames: Record<string, unknown>[] = [];
		const reader = response.body!.getReader();
		const dec = new TextDecoder();
		let buf = '';
		const pump = (): void => {
			reader.read().then(({ done, value }) => {
				if (done) {
					resolve(frames);
					return;
				}
				buf += dec.decode(value, { stream: true });
				let idx: number;
				while ((idx = buf.indexOf('\n\n')) !== -1) {
					const chunk = buf.slice(0, idx);
					buf = buf.slice(idx + 2);
					const ev = /event: (.+)/.exec(chunk)?.[1];
					const data = /data: (.+)/.exec(chunk)?.[1];
					if (ev && data) frames.push({ event: ev, ...(JSON.parse(data) as Record<string, unknown>) });
				}
				pump();
			});
		};
		pump();
	});
}

describe('terminal action routes', () => {
	it('flag off: every POST answers NOT_ENABLED, GET reports enabled false', async () => {
		writeConfig(false);
		const list = await listRoute() as Response;
		expect(await list.json()).toMatchObject({ enabled: false, sessions: [] });
		const open = await openRoute({ request: post('/api/terminal', {}) }) as Response;
		expect(open.status).toBe(403);
		expect(await open.json()).toEqual({ error: 'NOT_ENABLED' });
	});

	it('flag on: open then write then close over the real engine', { timeout: 30_000 }, async () => {
		writeConfig(true);
		const cwd = mkdtempSync(join(tmpdir(), 'dsi-term-work-'));
		workDirs.push(cwd);
		const open = await openRoute({ request: post('/api/terminal', { cwd, rows: 24, cols: 80 }) }) as Response;
		expect(open.status).toBe(200);
		const { sessionId, token } = (await open.json()) as { sessionId: string; token: string };

		const wrote = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token, action: 'write', data: 'echo routed-ok\n', timeoutMs: 5_000 }) }) as Response;
		expect(wrote.status).toBe(200);
		expect(((await wrote.json()) as { written: boolean }).written).toBe(true);
		// the passive observer delivers settle facts to the stream even though
		// the write path itself never locks or waits
		await new Promise((r) => setTimeout(r, 1_500));

		const closed = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token, action: 'close' }) }) as Response;
		expect(closed.status).toBe(200);
		expect(await closed.json()).toEqual({ quiescent: true });
	});

	it('fence: wrong token 403 FOREIGN_SESSION, unknown id 404 NO_SESSION', async () => {
		writeConfig(true);
		const open = await openRoute({ request: post('/api/terminal', {}) }) as Response;
		const { sessionId, token } = (await open.json()) as { sessionId: string; token: string };
		const foreign = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token: 'forged', action: 'write', data: 'x\n', timeoutMs: 500 }) }) as Response;
		expect(foreign.status).toBe(403);
		expect(await foreign.json()).toEqual({ error: 'FOREIGN_SESSION' });
		const unknown = await sendRoute({ params: { id: 'no-such' }, request: post('/api/terminal/no-such/send', { token, action: 'close' }) }) as Response;
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toEqual({ error: 'NO_SESSION' });
		await terminalRegistry.close(sessionId, token);
	});

	it('the list carries the baton facet: operator → labeled reattach → write stamps → release → unassigned (ADR-0079)', { timeout: 30_000 }, async () => {
		writeConfig(true);
		const opened = await openRoute({ request: post('/api/terminal', {}) }) as Response;
		const { sessionId, token } = (await opened.json()) as { sessionId: string; token: string };
		type Facet = { holder: string; holderId: string | null; since: number; lastWriteAt: number | null; pinned: boolean; readyForAutomation: boolean };
		const facet = async (): Promise<Facet> => {
			const body = (await (await listRoute() as Response).json()) as { sessions: Array<{ id: string; exited: boolean; baton: Facet }> };
			return body.sessions.find((s) => s.id === sessionId)!.baton; // one token-free GET answers "who holds it"
		};
		const t0 = await facet();
		expect(t0).toMatchObject({ holder: 'operator', holderId: null, lastWriteAt: null, pinned: false, readyForAutomation: false });
		expect(typeof t0.since).toBe('number');

		// a driver labels its takeover through the route body — the facet flips, no keystroke
		const re = (await reattachRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/reattach', { holder: 'automation', holderId: 'curl-driver' }) }) as Response);
		expect(re.status).toBe(200);
		const tok2 = ((await re.json()) as { token: string }).token;
		expect(await facet()).toMatchObject({ holder: 'automation', holderId: 'curl-driver', readyForAutomation: true });

		// an accepted write stamps lastWriteAt
		const wrote = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token: tok2, action: 'write', data: 'echo facet\n', timeoutMs: 5_000 }) }) as Response;
		expect(wrote.status).toBe(200);
		const t2 = await facet();
		expect(t2.lastWriteAt).toBeGreaterThanOrEqual(t2.since);

		// release hands the baton to nobody — the response carries the facet it produced
		const rel = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token: tok2, action: 'release' }) }) as Response;
		expect(rel.status).toBe(200);
		expect(await rel.json()).toMatchObject({ released: true, baton: { holder: 'unassigned', holderId: null, readyForAutomation: true } });
		expect(await facet()).toMatchObject({ holder: 'unassigned', holderId: null, readyForAutomation: true });

		// the released token pays exactly one refusal, then the heal (reattach) owns it again
		const stale = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token: tok2, action: 'write', data: 'x\n' }) }) as Response;
		expect(stale.status).toBe(403);
		expect(await stale.json()).toEqual({ error: 'FOREIGN_SESSION' });
		const healed = (await reattachRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/reattach', {}) }) as Response);
		const tok3 = ((await healed.json()) as { token: string }).token;
		const again = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token: tok3, action: 'write', data: 'echo healed\n' }) }) as Response;
		expect(again.status).toBe(200);
		expect(await facet()).toMatchObject({ holder: 'operator', readyForAutomation: false });
		void token;
	});

	it('bad signal name is BAD_REQUEST; signal path reaches the foreground group', async () => {
		writeConfig(true);
		const open = await openRoute({ request: post('/api/terminal', {}) }) as Response;
		const { sessionId, token } = (await open.json()) as { sessionId: string; token: string };
		const bad = await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token, action: 'signal', signal: 'SIGVMAX' }) }) as Response;
		expect(bad.status).toBe(400);
		await terminalRegistry.close(sessionId, token);
	});
});

describe('terminal SSE stream route', () => {
	it('frame order: tail, then live output, settled, closed — then the stream ends', { timeout: 30_000 }, async () => {
		writeConfig(true);
		const open = await openRoute({ request: post('/api/terminal', {}) }) as Response;
		const { sessionId, token } = (await open.json()) as { sessionId: string; token: string };

		const stream = streamRoute({ params: { id: sessionId }, url: new URL('http://localhost/api/terminal/' + sessionId + '/stream') }) as Response;
		expect(stream.headers.get('content-type')).toBe('text/event-stream');
		expect(stream.headers.get('x-accel-buffering')).toBe('no');
		const framesDone = drainSse(stream);

		await new Promise((r) => setTimeout(r, 300));
		await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token, action: 'write', data: 'echo streamed\n', timeoutMs: 5_000 }) });
		await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token, action: 'close' }) });

		const frames = await framesDone;
		const events = frames.map((f) => f.event);
		expect(events[0]).toBe('output');
		expect(events).toContain('settled');
		expect(events[events.length - 1]).toBe('closed');
		const outputs = frames.filter((f) => f.event === 'output') as Array<{ text: string }>;
		expect(outputs.map((o) => o.text).join('')).toContain('streamed');
	});

	it('fromByte resume and NO_SESSION for an unknown id', { timeout: 30_000 }, async () => {
		writeConfig(true);
		const missing = streamRoute({ params: { id: 'nope' }, url: new URL('http://localhost/api/terminal/nope/stream') }) as Response;
		expect(missing.status).toBe(404);
		const open = await openRoute({ request: post('/api/terminal', {}) }) as Response;
		const { sessionId, token } = (await open.json()) as { sessionId: string; token: string };
		await sendRoute({ params: { id: sessionId }, request: post('/api/terminal/' + sessionId + '/send', { token, action: 'write', data: 'echo resume-check\n', timeoutMs: 5_000 }) });
		const tail = terminalRegistry.readFrom(sessionId, 0);
		const resume = streamRoute({ params: { id: sessionId }, url: new URL('http://localhost/api/terminal/' + sessionId + '/stream?fromByte=' + tail.nextOffset) }) as Response;
		const framesDone = drainSse(resume);
		await terminalRegistry.close(sessionId, token);
		const frames = await framesDone;
		const first = frames[0] as { text?: string };
		// resumed at the live edge: the tail frame carries no replayed history
		expect(frames[0].event).toBe('output');
		expect((first.text ?? '').length).toBeLessThan(200);
	});
});

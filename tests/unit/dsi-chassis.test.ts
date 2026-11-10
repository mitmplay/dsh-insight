/**
 * dsi-chassis companion pins (spec 2026-11-08 Glass Chassis Remote CDP,
 * task 1.1-T; ADR-0054 D3/D4). The REAL launcher is injected — the pins
 * drive the whole HTTP contract (bind refusal, writer-held ownership,
 * response shape, disposable profiles, honest failure, the CDP
 * webSocketDebuggerUrl rewrite) against a fake birth, no Chromium.
 */
// @vitest-environment node
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseArgs, resolveBind, startChassisCompanion } from '../../bin/dsi-chassis.mjs';

const roots: string[] = [];
const root = (): string => {
	const r = mkdtempSync(join(tmpdir(), 'dsi-chassis-pins-'));
	roots.push(r);
	return r;
};
afterAll(() => {
	for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** The injected birth: records the call, returns a fake pid + close. */
function fakeLaunch(calls: { profileDirs: string[]; args: string[][] } = { profileDirs: [], args: [] }) {
	return async ({ profileDir, args }: { profileDir: string; args: string[] }) => {
		calls.profileDirs.push(profileDir);
		calls.args.push(args);
		return { pid: 424242, port: 1, close: async () => undefined };
	};
}

const openBody = (owner: string): { method: string; headers: Record<string, string>; body: string } => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ width: 800, height: 600, ownerSessionId: owner })
});

async function post(base: string, path: string, init: ReturnType<typeof openBody>): Promise<{ status: number; json: Record<string, unknown> }> {
	const res = await fetch(base + path, init);
	return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('dsi-chassis bind contract (ADR-0054 D4)', () => {
	it('--bind is required', () => {
		expect(resolveBind(undefined).ok).toBe(false);
		expect(resolveBind('').ok).toBe(false);
		expect((resolveBind('') as { error: string }).error).toMatch(/--bind/);
	});

	it('refuses 0.0.0.0 (and the IPv6 all-interfaces ::) — never bind-all', () => {
		expect((resolveBind('0.0.0.0') as { ok: boolean }).ok).toBe(false);
		expect((resolveBind('::') as { ok: boolean }).ok).toBe(false);
		expect((resolveBind('0.0.0.0') as { error: string }).error).toMatch(/0\.0\.0\.0/);
	});

	it('accepts a private interface address and startChassisCompanion enforces the refusal', async () => {
		expect(resolveBind('192.168.1.9')).toMatchObject({ ok: true, addr: '192.168.1.9' });
		await expect(startChassisCompanion({ bind: '0.0.0.0' })).rejects.toThrow(/0\.0\.0\.0/);
		await expect(startChassisCompanion({ bind: undefined })).rejects.toThrow(/--bind/);
	});

	it('parseArgs reads --bind <addr>, --bind=<addr> and --port', () => {
		expect(parseArgs(['--bind', '192.168.1.9', '--port', '9560'])).toEqual({ bind: '192.168.1.9', port: 9560 });
		expect(parseArgs(['--bind=127.0.0.1'])).toEqual({ bind: '127.0.0.1', port: undefined });
	});
});

describe('dsi-chassis open/close/ownership (ADR-0054 D3)', () => {
	it('open births a headed glass on a DISPOSABLE profile and answers the contract shape', async () => {
		const r0 = root(); // one root per test — the assertion reads the same dir the birth used
		const calls = { profileDirs: [] as string[], args: [] as string[][] };
		const c = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: r0, launch: fakeLaunch(calls) });
		try {
			const r = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-abc'));
			expect(r.status).toBe(200);
			// the contract: { id, cdpTarget, pid, profileDir }
			expect(typeof r.json.id).toBe('string');
			expect(r.json.pid).toBe(424242);
			expect(typeof r.json.cdpTarget).toBe('string');
			expect(typeof r.json.profileDir).toBe('string');
			// the cdpTarget routes THROUGH the companion (the Host-header hop),
			// never at raw Chrome
			expect(r.json.cdpTarget).toContain('/cdp/' + r.json.id);
			expect(r.json.cdpTarget).toContain('127.0.0.1:' + c.port);
			// the birth is HEADED with a debugging port (the relay's target)
			expect(calls.args[0]).toContain('--no-first-run');
			const dbg = calls.args[0].find((a) => a.startsWith('--remote-debugging-port='));
			expect(dbg).toBeTruthy();
			// DISPOSABLE profile: under the injected root, owner marker written
			expect(calls.profileDirs[0].startsWith(r0)).toBe(true);
			expect(existsSync(join(calls.profileDirs[0], '.dsi-owner.json'))).toBe(true);
			// never the host's real Chrome profile dir
			expect(calls.profileDirs[0]).not.toMatch(/Application Support|Google\/Chrome/);
		} finally {
			await c.stop();
		}
	});

	it('one conversation = one glass: a busy owner is refused writer-held (409 BUSY)', async () => {
		const c = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: root(), launch: fakeLaunch() });
		try {
			const first = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-dup'));
			expect(first.status).toBe(200);
			const second = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-dup'));
			expect(second.status).toBe(409);
			expect(second.json.error).toBe('BUSY');
			expect(String(second.json.message)).toMatch(/writer-held/);
			// a DIFFERENT owner is a different glass — the machine boundary is
			// not an ownership boundary
			const third = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-other'));
			expect(third.status).toBe(200);
		} finally {
			await c.stop();
		}
	});

	it('missing ownerSessionId is a 400 — ownership is keyed by the requesting conversation', async () => {
		const c = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: root(), launch: fakeLaunch() });
		try {
			const r = await post('http://127.0.0.1:' + c.port, '/open', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ width: 800, height: 600 })
			});
			expect(r.status).toBe(400);
		} finally {
			await c.stop();
		}
	});

	it('close releases the ownership seat (by id) and removes the disposable profile', async () => {
		const calls = { profileDirs: [] as string[], args: [] as string[][] };
		const c = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: root(), launch: fakeLaunch(calls) });
		try {
			const open = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-close'));
			const id = String(open.json.id);
			const dir = String(open.json.profileDir);
			expect(existsSync(dir)).toBe(true);
			const closed = await post('http://127.0.0.1:' + c.port, '/close', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			expect(closed.status).toBe(200);
			expect(closed.json).toMatchObject({ ok: true });
			expect(existsSync(dir)).toBe(false);
			// the seat is free: the same owner can open again
			const again = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-close'));
			expect(again.status).toBe(200);
			expect(again.json.id).not.toBe(id);
		} finally {
			await c.stop();
		}
	});

	it('a companion restart: a glass is still closable by pid or profileDir', async () => {
		const c = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: root(), launch: fakeLaunch() });
		try {
			const open = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-restart'));
			const dir = String(open.json.profileDir);
			// simulating the restart: fresh map, same glass found by pid
			const c2 = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: root(), launch: fakeLaunch() });
			try {
				c2.glasses.set(String(open.json.id), {
					id: String(open.json.id), ownerSessionId: 'session-restart', debugPort: 1, pid: 424242,
					profileDir: dir, close: async () => undefined
				});
				const byPid = await post('http://127.0.0.1:' + c2.port, '/close', {
					method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ pid: 424242 })
				});
				expect(byPid.status).toBe(200);
				const byDir = await post('http://127.0.0.1:' + c2.port, '/close', {
					method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ profileDir: dir })
				});
				// already released — honest 404, not a fake ok
				expect(byDir.status).toBe(404);
			} finally {
				await c2.stop();
			}
		} finally {
			await c.stop();
		}
	});

	it('a birth that throws is an HONEST 500 naming the chassis — and cleans the profile dir', async () => {
		const c = await startChassisCompanion({
			bind: '127.0.0.1', port: 0, profileRoot: root(),
			launch: async () => { throw new Error('chrome will not start here'); }
		});
		try {
			const r = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-fail'));
			expect(r.status).toBe(500);
			expect(r.json.error).toBe('CHASSIS_FAILED');
			expect(String(r.json.message)).toMatch(/chrome will not start here/);
		} finally {
			await c.stop();
		}
	});

	it('status lists the glasses with their owners', async () => {
		const c = await startChassisCompanion({ bind: '127.0.0.1', port: 0, profileRoot: root(), launch: fakeLaunch() });
		try {
			await post('http://127.0.0.1:' + c.port, '/open', openBody('session-status'));
			const res = await fetch('http://127.0.0.1:' + c.port + '/status');
			const s = (await res.json()) as { bind: string; glasses: { ownerSessionId: string }[] };
			expect(s.bind).toBe('127.0.0.1');
			expect(s.glasses.map((g) => g.ownerSessionId)).toContain('session-status');
		} finally {
			await c.stop();
		}
	});
});

describe('dsi-chassis CDP bridge (the fact-7 Host hop)', () => {
	it('proxies HTTP to the glass and rewrites webSocketDebuggerUrl to route through the companion', async () => {
		// a fake "Chrome" debugging endpoint on 127.0.0.1 advertising its
		// loopback ws url — the bridge must rewrite it to the companion route
		const fake = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:19555/devtools/browser/x' }));
		});
		await new Promise<void>((res) => fake.listen(19555, '127.0.0.1', () => res()));
		const c = await startChassisCompanion({
			bind: '127.0.0.1', port: 0, profileRoot: root(),
			launch: async ({ args }: { args: string[] }) => {
				const port = Number(args.find((a) => a.startsWith('--remote-debugging-port='))?.split('=')[1]);
				return { pid: 424242, port, close: async () => undefined };
			},
			portFor: async () => 19555
		});
		try {
			const open = await post('http://127.0.0.1:' + c.port, '/open', openBody('session-bridge'));
			const res = await fetch(String(open.json.cdpTarget) + '/json/version');
			const body = (await res.json()) as { webSocketDebuggerUrl: string };
			expect(body.webSocketDebuggerUrl).toBe('ws://127.0.0.1:' + c.port + '/cdp/' + String(open.json.id) + '/devtools/browser/x');
		} finally {
			await c.stop();
			fake.close();
		}
	});
});

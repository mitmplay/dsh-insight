/**
 * drive.mjs discovery ladder pins (ADR-0080 D4, task 3.2-T).
 *
 * The ladder must find the SAME floor on macOS lsof output, Linux lsof
 * output, ss-only (lsof absent), and with NO tool at all (the 5100-5199
 * sweep) — and a candidate whose JSON probe returns broken/non-JSON is
 * NEVER returned. lsof/ss are stubbed with PATH-shim scripts (the script
 * invokes both by bare name); floors are tiny node http servers.
// @vitest-environment node
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { candidatePorts, confirmedFloors } from '../../skills/dsi-drive-terminal/drive.mjs';

const GOOD_PORT = 5123; // a real DSI floor in the 5100-5199 band
const BROKEN_PORT = 5124; // a listener whose GET is not DSI JSON

const origPath = process.env.PATH;
const dirs: string[] = [];
const servers: Server[] = [];
function shimDir(scripts: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'drive-shim-'));
	for (const [name, body] of Object.entries(scripts)) {
		const p = join(dir, name);
		writeFileSync(p, body);
		chmodSync(p, 0o755);
	}
	dirs.push(dir);
	return dir;
}
function usePath(dir: string): void {
	process.env.PATH = dir;
}
const floorServers = new Map<number, Promise<Server>>();
function floorServer(port: number, body: string): Promise<Server> {
	const memo = floorServers.get(port);
	if (memo) return memo;
	const p = new Promise<Server>((resolve) => {
		const s = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(body);
		});
		s.listen(port, '127.0.0.1', () => {
			servers.push(s);
			resolve(s);
		});
	});
	floorServers.set(port, p);
	return p;
}

afterAll(() => {
	process.env.PATH = origPath;
	for (const s of servers) s.close();
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// single-line printf: each argument becomes one shim output line
const MAC_LSOF = "printf '%s\\n' 'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME' 'node    12345   me   24u  IPv6  0xdeadbeef      0t0  TCP *:5123 (LISTEN)' 'node    12345   me   25u  IPv4  0xdeadbeef      0t0  TCP 127.0.0.1:5124 (LISTEN)'";
const LINUX_LSOF = "printf '%s\\n' 'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME' 'node      999   me   18u  IPv4  12345      0t0  TCP 127.0.0.1:5123 (LISTEN)' 'sshd     1000   me   19u  IPv4  12346      0t0  TCP 0.0.0.0:22 (LISTEN)'";
const SS = "printf '%s\\n' 'State  Recv-Q Send-Q  Local Address:Port  Peer Address:Port Process' 'LISTEN 0      511           *:5123             *:*      users:((\"node\",pid=999))' 'LISTEN 0      4096      127.0.0.1:5124       0.0.0.0:*      users:((\"node\",pid=1000))'";
const SHIM_BODY = (tool: string, script: string): Record<string, string> => ({ [tool]: '#!/bin/sh\n' + script });

describe('drive.mjs discovery ladder (ADR-0080 D4)', () => {
	it('(a) macOS-style lsof output finds the floor', async () => {
		await floorServer(GOOD_PORT, JSON.stringify({ enabled: true, sessions: [] }));
		usePath(shimDir(SHIM_BODY('lsof', MAC_LSOF)));
		expect(await candidatePorts()).toContain(GOOD_PORT);
		expect(await confirmedFloors()).toEqual([GOOD_PORT]);
	});

	it('(b) Linux-style lsof output finds the same floor', async () => {
		await floorServer(GOOD_PORT, JSON.stringify({ enabled: true, sessions: [] }));
		usePath(shimDir(SHIM_BODY('lsof', LINUX_LSOF)));
		expect(await confirmedFloors()).toEqual([GOOD_PORT]);
	});

	it('(c) lsof absent, ss present → the ss parse finds the same floor', async () => {
		await floorServer(GOOD_PORT, JSON.stringify({ enabled: true, sessions: [] }));
		usePath(shimDir(SHIM_BODY('ss', SS))); // no lsof shim on PATH at all
		expect(await confirmedFloors()).toEqual([GOOD_PORT]);
	});

	it('(d) neither tool present → the sweep probe finds the same floor', async () => {
		await floorServer(GOOD_PORT, JSON.stringify({ enabled: true, sessions: [] }));
		usePath(shimDir({})); // empty PATH: both execFileSync calls throw
		// the sweep scans the whole 5100-5199 band, so on a machine with REAL
		// floors up it honestly finds those too — pin OUR floor found and the
		// broken port never returned
		const found = await confirmedFloors();
		expect(found).toContain(GOOD_PORT);
		expect(found).not.toContain(BROKEN_PORT);
	});

	it('(e) a broken/non-JSON candidate is NEVER returned — the ladder moves on', async () => {
		await floorServer(BROKEN_PORT, '<html>not json</html>');
		await floorServer(GOOD_PORT, JSON.stringify({ enabled: true, sessions: [] }));
		usePath(shimDir(SHIM_BODY('lsof', MAC_LSOF))); // lists BROKEN_PORT too
		expect(await confirmedFloors()).toEqual([GOOD_PORT]);
	});

	it('the drive.mjs binary itself stays runnable (spawn smoke)', () => {
		usePath(shimDir({}));
		const r = spawnSync(process.execPath, [join(process.cwd(), 'skills/dsi-drive-terminal/drive.mjs')], { encoding: 'utf8' });
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('usage:');
	});
});

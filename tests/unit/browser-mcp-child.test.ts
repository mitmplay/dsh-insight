import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

import { browserRegistry, PLAYWRIGHT_MCP_PIN } from '$lib/server/browser/registry.js';
import { GET as mcpRoute } from '../../src/routes/api/browser/[id]/mcp/+server';

// The in-process suite (browser-mcp-inprocess.test.ts) sets this env marker
// at module top level and vitest workers share process.env across files —
// it leaks here and registry.open would take the in-process brain branch
// (registry.ts: DSI_MCP_IN_PROCESS === '1') instead of spawning the child.
// This file pins the CHILD contract, so force the default spawn shape.
const priorInProcess = process.env.DSI_MCP_IN_PROCESS;
delete process.env.DSI_MCP_IN_PROCESS;
afterAll(() => {
	if (priorInProcess !== undefined) process.env.DSI_MCP_IN_PROCESS = priorInProcess;
});

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});
const ctx = (id: string) => ({ params: { id } });

describe('browser MCP wiring (W3)', () => {
	it('pins the MCP version (never @latest)', () => {
		expect(PLAYWRIGHT_MCP_PIN).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('child mode: session reports child brain with pid; close kills it first', async () => {
		const info = await browserRegistry.open({ port: 9471 + opened.length * 3 }); // spawnMcp default true
		opened.push(info.id);
		expect(info.mcp).toBe('child');
		const res = mcpRoute(ctx(info.id));
		const body = (await res.json()) as { mode: string; health: string; pid?: number };
		expect(body.mode).toBe('stdio');
		expect(body.pid).toBeGreaterThan(0);
		// child really runs — matched by OUR exact cdp-endpoint arg, never the
		// broad 'playwright/mcp' pattern (the operator's own glass brain also
		// carries it; a machine-wide sweep counts THEIR process, not ours —
		// the false "leak" this test once reported after a clean close).
		const ours = 'cdp-endpoint http://127.0.0.1:' + info.port;
		// The child is an npx spawn: under full-suite load it can take seconds
		// for the process to appear in pgrep after the registry reports
		// mcp:'child'. Poll instead of a single instant probe (flake 2026-11-01:
		// first probe ran before the grandchild exec'd, pgrep status 1).
		let childPid = 0;
		for (let i = 0; i < 100 && childPid === 0; i += 1) {
			const running = spawnSync('pgrep', ['-f', ours], { stdio: 'pipe' });
			if (running.status === 0) {
				childPid = Number(running.stdout.toString().trim().split('\n')[0]);
			} else {
				await new Promise((res) => setTimeout(res, 100));
			}
		}
		expect(childPid).toBeGreaterThan(0);
		const before = (await browserRegistry.list()).find((s) => s.id === info.id)!.pid;
		expect(before).toBeGreaterThan(0);
		const r = await browserRegistry.close(info.id);
		expect(r.ok).toBe(true);
		// the brain died with the session: no process matches our args AND the
		// exact spawned child pid is gone (regression pin — a pattern sweep
		// alone could be satisfied by an unrelated process dying instead).
		expect(spawnSync('pgrep', ['-f', ours], { stdio: 'pipe' }).status).not.toBe(0);
		for (let i = 0; i < 20 && spawnSync('ps', ['-p', String(childPid)], { stdio: 'pipe' }).status === 0; i += 1) {
			await new Promise((res) => setTimeout(res, 100));
		}
		expect(spawnSync('ps', ['-p', String(childPid)], { stdio: 'pipe' }).status).not.toBe(0);
	}, 60_000);

	it('child death marks the session brain down, mirror keeps working', async () => {
		const info = await browserRegistry.open({ port: 9471 + opened.length * 3 });
		opened.push(info.id);
		// find OUR child (match this session's cdp port) and SIGKILL it — poll,
		// the npx grandchild may not have exec'd yet under load
		let pid = 0;
		for (let i = 0; i < 100 && pid === 0; i += 1) {
			const pgrep = spawnSync('pgrep', ['-f', 'cdp-endpoint http://127.0.0.1:' + info.port], { stdio: 'pipe' });
			if (pgrep.status === 0) pid = Number(pgrep.stdout.toString().trim().split('\n')[0]);
			else await new Promise((res) => setTimeout(res, 100));
		}
		if (pid) spawnSync('kill', ['-9', String(pid)]);
		await new Promise((r) => setTimeout(r, 300));
		const after = (await browserRegistry.list()).find((s) => s.id === info.id)!;
		expect(after.mcpHealth).toBe('down');
		// D7 fallback: the glass (relay) still answers
		expect(browserRegistry.relay(info.id).latestFrame()).not.toBeNull();
	}, 60_000);
});

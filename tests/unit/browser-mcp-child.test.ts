import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

import { browserRegistry, PLAYWRIGHT_MCP_PIN } from '$lib/server/browser/registry.js';
import { GET as mcpRoute } from '../../src/routes/api/browser/[id]/mcp/+server';

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
		// child really runs
		expect(spawnSync('pgrep', ['-f', 'playwright/mcp'], { stdio: 'pipe' }).status).toBe(0);
		const before = (await browserRegistry.list()).find((s) => s.id === info.id)!.pid;
		expect(before).toBeGreaterThan(0);
		const r = await browserRegistry.close(info.id);
		expect(r.ok).toBe(true);
		// the brain died with the session: the pgrep sweep finds no mcp child
		// for THIS port (a sibling test's child may exist — match our args)
		expect(spawnSync('pgrep', ['-f', 'cdp-endpoint http://127.0.0.1:' + info.port], { stdio: 'pipe' }).status).not.toBe(0);
	}, 60_000);

	it('child death marks the session brain down, mirror keeps working', async () => {
		const info = await browserRegistry.open({ port: 9471 + opened.length * 3 });
		opened.push(info.id);
		// find OUR child (match this session's cdp port) and SIGKILL it
		const pgrep = spawnSync('pgrep', ['-f', 'cdp-endpoint http://127.0.0.1:' + info.port], { stdio: 'pipe' });
		const pid = Number(pgrep.stdout.toString().trim().split('\n')[0]);
		if (pid) spawnSync('kill', ['-9', String(pid)]);
		await new Promise((r) => setTimeout(r, 300));
		const after = (await browserRegistry.list()).find((s) => s.id === info.id)!;
		expect(after.mcpHealth).toBe('down');
		// D7 fallback: the glass (relay) still answers
		expect(browserRegistry.relay(info.id).latestFrame()).not.toBeNull();
	}, 60_000);
});

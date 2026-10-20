import { afterAll, describe, expect, it } from 'vitest';

// in-process mode is env-gated — set BEFORE the module import
process.env.DSI_MCP_IN_PROCESS = '1';
// ISOLATED brain range — a live floor's brains own 9515+; tests must never
// collide with them (found 2026-10-20: floor brains on 9500/9501 ate the
// test's fallback ports and the close probe hit the FLOOR's listener)
process.env.DSI_MCP_PORT = '19515';
const registryMod = await import('$lib/server/browser/registry.js');
const browserRegistry = registryMod.browserRegistry;
const routeMod = await import('../../src/routes/api/browser/[id]/mcp/+server');
const mcpRoute = routeMod.GET;

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});
const ctx = (id: string) => ({ params: { id } });
const postMcp = async (url: string, body: unknown): Promise<{ status: number; json: () => Promise<unknown> }> => {
	const { default: http } = await import('node:http');
	return await new Promise((res, rej) => {
		const data = JSON.stringify(body);
		const req = http.request(
			url,
			{ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } },
			(r) => {
				let raw = '';
				r.on('data', (c: Buffer) => (raw += c.toString()));
				r.on('end', () => {
					console.log('MCP_RAW', r.statusCode, JSON.stringify(raw.slice(0, 200)));
					res({ status: r.statusCode ?? 0, json: () => Promise.resolve(JSON.parse(raw.startsWith('data: ') ? raw.split('\n')[0].slice(6) : raw || '{}')) });
				});
			}
		);
		req.on('error', rej);
		req.end(data);
	});
};

describe('in-process MCP brain (D7, DSI_MCP_IN_PROCESS=1)', () => {
	it('creates the brain in-process: sibling SSE listener + descriptor URL', async () => {
		const info = await browserRegistry.open();
		opened.push(info.id);
		expect(info.mcp).toBe('in-process');
		const body = (await (await mcpRoute(ctx(info.id))).json()) as { mode: string; url: string; health: string };
		expect(body.mode).toBe('in-process');
		expect(body.url).toBe('http://127.0.0.1:19515/sse');
		expect(body.health).toBe('up');
		// streamable-http: POST initialize must return the JSON-RPC result
		const init = await postMcp(body.url, {
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } }
		});
		expect(init.status).toBe(200);
		const payload = (await init.json()) as { result?: { serverInfo?: { name?: string } } };
		expect(payload.result?.serverInfo?.name).toBeTruthy();
	}, 60_000);

	it('close disposes the brain and the sibling listener (D8 ordering)', async () => {
		const info = await browserRegistry.open();
		const body = (await (await mcpRoute(ctx(info.id))).json()) as { url: string };
		const r = await browserRegistry.close(info.id);
		expect(r.ok).toBe(true);
		const portNum = body.url.match(/:(\d+)/)![1];
		console.log('CLOSE_PROBE url', body.url, 'lsof:', require('node:child_process').spawnSync('lsof', ['-i', 'tcp:' + portNum], { stdio: 'pipe' }).stdout.toString().trim());
		// teardown is async (forced connection drops + close callback) —
		// poll until the listener refuses, never a single-shot race
		await expect.poll(async () => {
			const { default: http } = await import('node:http');
			return await new Promise<number>((res) => {
				const req = http.get(body.url, (r) => {
					res(r.statusCode ?? 0);
					r.destroy();
				});
				req.on('error', () => res(0));
				req.setTimeout(1000, () => {
					req.destroy();
					res(0);
				});
			});
		}, { timeout: 10_000 }).toBe(0); // listener closed — connection refused
	}, 60_000);
});
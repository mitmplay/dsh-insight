import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

/** ADR-0040 Wave 2 — /tabs GET + /activate POST: happy paths and the
 *  tombstone (409 CLOSED) / unknown (404) mappings. */
const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

import { GET as tabsGet } from '../../src/routes/api/browser/[id]/tabs/+server';
import { POST as activatePost } from '../../src/routes/api/browser/[id]/activate/+server';

const GET = (id: string): Promise<Response> => tabsGet({ params: { id } });

const POST = (id: string, body: unknown): Promise<Response> =>
	activatePost({ params: { id }, request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }) });

describe('tabs + activate routes (ADR-0040)', () => {
	it('GET /tabs lists pages with the active flag', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9543 + opened.length * 3, url: 'data:text/html,<title>t1</title>route-one' });
		opened.push(info.id);
		const res = await GET(info.id);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { tabs: { targetId: string; active: boolean }[] };
		expect(body.tabs.length).toBeGreaterThanOrEqual(1);
		expect(body.tabs.filter((t) => t.active)).toHaveLength(1);
	}, 120_000);

	it('POST /activate returns the boundary payload and moves the pointer', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9543 + opened.length * 3, url: 'data:text/html,<title>t1</title>route-one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		const page2 = await e.context.newPage();
		await page2.goto('data:text/html,<title>t2</title>route-two').catch(() => undefined);
		const { tabs } = (await (await GET(info.id)).json()) as { tabs: { targetId: string; active: boolean }[] };
		const t2 = tabs.find((t) => !t.active)!.targetId;
		const res = await POST(info.id, { targetId: t2 });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { targetId: string; seq: number; jpeg: string | null };
		expect(body.targetId).toBe(t2);
		expect(body.seq).toBeGreaterThanOrEqual(0);
		const after = (await (await GET(info.id)).json()) as { tabs: { targetId: string; active: boolean }[] };
		expect(after.tabs.find((t) => t.targetId === t2)?.active).toBe(true);
	}, 120_000);

	it('shape refusals and tombstones: 400 bad body, 404 unknown target/id, 409 CLOSED', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9543 + opened.length * 3, url: 'data:text/html,<title>t1</title>route-one' });
		opened.push(info.id);
		expect((await POST(info.id, {})).status).toBe(400);
		expect((await POST(info.id, { targetId: 42 })).status).toBe(400);
		expect((await POST(info.id, { targetId: 'no-such' })).status).toBe(404);
		expect((await GET('no-such-session')).status).toBe(404);
		await browserRegistry.close(info.id);
		opened.splice(opened.indexOf(info.id), 1);
		expect((await GET(info.id)).status).toBe(409);
		expect((await POST(info.id, { targetId: 'x' })).status).toBe(409);
	}, 120_000);
});

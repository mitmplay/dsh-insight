import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';
import { POST as navigateRoute } from '../../src/routes/api/browser/[id]/navigate/+server';
import { GET as pageRoute } from '../../src/routes/api/browser/[id]/page/+server';
import { POST as viewportRoute } from '../../src/routes/api/browser/[id]/viewport/+server';
import { POST as inputRoute } from '../../src/routes/api/browser/[id]/input/+server';

/** ADR-0040 Task 2.2-T — the existing routes forward an optional targetId
 *  (query or body) to the registry; absent targetId keeps old behavior. */
const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

const post = (handler: (ctx: { params: { id: string }; request: Request }) => Promise<Response>, id: string, body: unknown): Promise<Response> =>
	handler({ params: { id }, request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }) });

describe('route targetId forwarding (ADR-0040 D3)', () => {
	it('navigate route honors targetId and answers THAT tab pageInfo', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<title>t1</title>active-one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		const page2 = await e.context.newPage();
		await page2.goto('data:text/html,<title>t2</title>second').catch(() => undefined);
		const tabs = await browserRegistry.listTabs(info.id);
		const t2 = tabs.find((t) => !t.active)!.targetId;
		await browserRegistry.activate(info.id, t2);
		const t1 = tabs.find((t) => t.active)!.targetId;
		await browserRegistry.activate(info.id, t1); // pointer back on tab 1
		const res = await post(navigateRoute, info.id, { url: 'data:text/html,<title>t2b</title>routed-two', targetId: t2 });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { url: string };
		expect(body.url).toContain('routed-two');
		// page route with targetId query agrees
		const p2 = await pageRoute({ params: { id: info.id }, url: new URL('http://x/?targetId=' + t2) });
		expect(((await p2.json()) as { url: string }).url).toContain('routed-two');
		// default page route still reports the ACTIVE tab (tab 1)
		const pdef = await pageRoute({ params: { id: info.id }, url: new URL('http://x/') });
		expect(((await pdef.json()) as { url: string }).url).toContain('active-one');
	}, 120_000);

	it('input + viewport routes accept targetId; unknown target answers 404 NO_TARGET', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<title>t1</title>active-one' });
		opened.push(info.id);
		const okVp = await post(viewportRoute, info.id, { width: 1024, height: 700 });
		expect((await okVp.json()) as { ok: boolean }).toEqual({ ok: true });
		const okIn = await post(inputRoute, info.id, { kind: 'text', text: 'hi' });
		expect((await okIn.json()) as { ok: boolean }).toEqual({ ok: true });
		const badVp = await post(viewportRoute, info.id, { width: 800, height: 600, targetId: 'no-such' });
		expect(badVp.status).toBe(404);
		expect(((await badVp.json()) as { error: string }).error).toBe('NO_TARGET');
		const badIn = await post(inputRoute, info.id, { kind: 'text', text: 'x', targetId: 'no-such' });
		expect(badIn.status).toBe(404);
		expect(((await badIn.json()) as { error: string }).error).toBe('NO_TARGET');
	}, 120_000);
});

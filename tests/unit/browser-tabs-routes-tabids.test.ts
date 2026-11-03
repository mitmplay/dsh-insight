import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

/** Glass-tab-ids task 2 — the wire exposes the session-stable ordinal:
 *  /tabs rows carry tabId, /opentab answers tabId, /closetab accepts
 *  { tabId } OR { targetId }, and a retired/unknown tabId is an EXPLICIT
 *  404 { error } (never a silent nearest-match). Same shape as
 *  browser-tabs-routes.test.ts: real headless chromium, spawnMcp off. */
const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

import { GET as tabsGet } from '../../src/routes/api/browser/[id]/tabs/+server';
import { POST as openTabPost } from '../../src/routes/api/browser/[id]/opentab/+server';
import { POST as closeTabPost } from '../../src/routes/api/browser/[id]/closetab/+server';

const GET = (id: string): Promise<Response> => tabsGet({ params: { id } });

const POST = (handler: (ctx: never) => Promise<Response>, id: string, body: unknown): Promise<Response> =>
	handler({
		params: { id },
		request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) })
	} as never) as Promise<Response>;

describe('tabs routes expose tabId (glass-tab-ids)', () => {
	it('GET /tabs rows carry a unique numeric tabId', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9561 + opened.length * 3, url: 'data:text/html,<title>t1</title>tabids-one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		const page2 = await e.context.newPage();
		await page2.goto('data:text/html,<title>t2</title>tabids-two').catch(() => undefined);
		const res = await GET(info.id);
		expect(res.status).toBe(200);
		const { tabs } = (await res.json()) as { tabs: { tabId: unknown; targetId: string }[] };
		expect(tabs.length).toBe(2);
		for (const t of tabs) {
			expect(typeof t.tabId).toBe('number');
			expect(t.tabId as number).toBeGreaterThanOrEqual(1);
		}
		expect(new Set(tabs.map((t) => t.tabId)).size).toBe(tabs.length); // ordinals unique
	}, 120_000);

	it('POST /opentab response carries the new tab’s tabId, matching the list', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9561 + opened.length * 3, url: 'data:text/html,<title>t1</title>tabids-open' });
		opened.push(info.id);
		const res = await POST(openTabPost, info.id, {});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { targetId: string; tabId: unknown };
		expect(typeof body.tabId).toBe('number');
		const { tabs } = (await (await GET(info.id)).json()) as { tabs: { tabId: number; targetId: string }[] };
		expect(tabs.find((t) => t.targetId === body.targetId)?.tabId).toBe(body.tabId);
	}, 120_000);

	it('POST /closetab accepts { tabId } and closes exactly that tab', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9561 + opened.length * 3, url: 'data:text/html,<title>t1</title>tabids-close' });
		opened.push(info.id);
		// the second tab via opentab (an ATTACHED tab — a bare newPage is
		// enumerated-but-unattached and the strip could not close it either)
		const openedRes = await POST(openTabPost, info.id, { url: 'data:text/html,<title>t2</title>tabids-close-two' });
		expect(openedRes.status).toBe(200);
		const { tabs } = (await (await GET(info.id)).json()) as { tabs: { tabId: number; targetId: string; active: boolean }[] };
		const victim = tabs.find((t) => !t.active)!;
		const res = await POST(closeTabPost, info.id, { tabId: victim.tabId });
		expect(res.status).toBe(200);
		const after = (await (await GET(info.id)).json()) as { tabs: { targetId: string }[] };
		expect(after.tabs.find((t) => t.targetId === victim.targetId)).toBeUndefined();
	}, 120_000);

	it('a retired or unknown tabId is an EXPLICIT 404 { error }', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9561 + opened.length * 3, url: 'data:text/html,<title>t1</title>tabids-retired' });
		opened.push(info.id);
		const openedRes = await POST(openTabPost, info.id, { url: 'data:text/html,<title>t2</title>tabids-retired-two' });
		expect(openedRes.status).toBe(200);
		const { tabs } = (await (await GET(info.id)).json()) as { tabs: { tabId: number; active: boolean }[] };
		const victim = tabs.find((t) => !t.active)!;
		expect((await POST(closeTabPost, info.id, { tabId: victim.tabId })).status).toBe(200);
		// retired: the same ordinal again
		const retired = await POST(closeTabPost, info.id, { tabId: victim.tabId });
		expect(retired.status).toBe(404);
		expect(typeof ((await retired.json()) as { error: unknown }).error).toBe('string');
		// never-issued ordinal
		const ghost = await POST(closeTabPost, info.id, { tabId: 999 });
		expect(ghost.status).toBe(404);
		expect(typeof ((await ghost.json()) as { error: unknown }).error).toBe('string');
	}, 120_000);
});

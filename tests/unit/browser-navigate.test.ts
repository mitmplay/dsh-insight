import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';
import { POST as navigate } from '../../src/routes/api/browser/[id]/navigate/+server';
import { GET as page } from '../../src/routes/api/browser/[id]/page/+server';

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });

describe('browser navigate + page routes', () => {
	it('navigates to a data fixture and reads back url + title', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		const res = await navigate({ ...ctx(info.id), request: post({ url: 'data:text/html,<title>FIX</title><h1>here</h1>' }) });
		const body = (await res.json()) as { title?: string; error?: string };
		expect(body.title).toBe('FIX');
		const p = (await (await page(ctx(info.id))).json()) as { url: string; title: string };
		expect(p.title).toBe('FIX');
		expect(p.url.startsWith('data:text/html')).toBe(true);
	}, 60_000);

	it('rejects junk urls and unknown sessions', async () => {
		expect((await navigate({ ...ctx('nope'), request: post({ url: 'https://x.test' }) })).status).toBe(404);
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		expect((await navigate({ ...ctx(info.id), request: post({ url: 'javascript:alert(1)' }) })).status).toBe(400);
	}, 60_000);
});

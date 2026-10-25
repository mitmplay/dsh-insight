import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';
import { GET as list, POST as open } from '../../src/routes/api/browser/+server';
import { POST as input } from '../../src/routes/api/browser/[id]/input/+server';
import { POST as close } from '../../src/routes/api/browser/[id]/close/+server';
import { GET as stream } from '../../src/routes/api/browser/[id]/stream/+server';

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

// route context stubs — the handlers only touch params/request
const ctx = (id: string) => ({ params: { id } });
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('browser API routes (real session)', () => {
	it('open returns id + port; list contains the session', async () => {
		const res = await open();
		const info = (await res.json()) as { id: string; port: number };
		opened.push(info.id);
		expect(info.id).toBeTruthy();
		expect(info.port).toBeGreaterThan(0);
		const listing = (await (await list()).json()) as { sessions: { id: string }[] };
		expect(listing.sessions.map((s) => s.id)).toContain(info.id);
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('input after close returns 409 CLOSED; unknown id 404 NO_SESSION', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9534 + opened.length * 3, });
		await browserRegistry.close(info.id);
		const bad = await input({ ...ctx(info.id), request: post({ kind: 'text', text: 'hi' }) });
		expect(bad.status).toBe(409);
		const unknown = await input({ ...ctx('nope'), request: post({ kind: 'text', text: 'hi' }) });
		expect(unknown.status).toBe(404);
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('close route removes the entry (D8) and is idempotent', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9534 + opened.length * 3, });
		const r1 = await (await close(ctx(info.id))).json();
		expect(r1).toEqual({ ok: true, alreadyClosed: false });
		const r2 = await (await close(ctx(info.id))).json();
		expect(r2).toEqual({ ok: true, alreadyClosed: true });
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('stream endpoint 404s unknown id and speaks SSE for a live one', async () => {
		expect((await stream({ ...ctx('nope'), url: new URL('http://x/stream') })).status).toBe(404);
		const info = await browserRegistry.open({ spawnMcp: false, port: 9534 + opened.length * 3, });
		opened.push(info.id);
		const res = stream({ ...ctx(info.id), url: new URL('http://x/stream') });
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		await res.body?.cancel(); // cancel arm: client gone
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling
});
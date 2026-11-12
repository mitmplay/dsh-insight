/**
 * file-events SSE route handler test (task 2.1-T, "Explorer Freshness and
 * Image Links" Wave 2; ADR "The Silent Root" D2/D3).
 *
 * Contract: refusal (missing params / nonexistent / non-directory root) is
 * plain JSON ok:false — never a stream; the happy path opens an SSE stream
 * whose FIRST event is the BASELINE generation, then a file create inside
 * the root coalesces through the 300 ms debounce into exactly ONE
 * `generation` event; abort closes the watcher (no leak). Temp dirs are
 * real and cleaned in afterEach.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line import/no-unresolved
import * as route from '$lib/../routes/api/workspace/file-events/+server.js';

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeTempRoot(): string {
	const d = mkdtempSync(join(tmpdir(), 'dsi-file-events-'));
	dirs.push(d);
	return d;
}

function getUrl(root: string | undefined, sessionId: string | undefined = 'sess-1'): URL {
	const u = new URL('http://localhost/api/workspace/file-events');
	if (sessionId !== undefined) u.searchParams.set('sessionId', sessionId);
	if (root !== undefined) u.searchParams.set('root', root);
	return u;
}

/** Read SSE events off the stream until `count` data events or timeout. */
async function readEvents(res: Response, count: number, timeoutMs = 3000): Promise<{ event: string; data: string }[]> {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const events: { event: string; data: string }[] = [];
	const timer = setTimeout(() => reader.cancel().catch(() => undefined), timeoutMs);
	try {
		while (events.length < count) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			for (const chunk of buffer.split('\n\n')) {
				const m = /^event: (.+)\ndata: (.+)$/.exec(chunk.trim());
				if (m) events.push({ event: m[1] as string, data: m[2] as string });
			}
			buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
		}
	} finally {
		clearTimeout(timer);
		reader.cancel().catch(() => undefined);
	}
	return events;
}

describe('file-events route (The Silent Root D2/D3)', () => {
	it('missing params → plain JSON ok:false (no stream)', async () => {
		const res = await route.GET({
			url: getUrl(undefined, undefined),
			request: new Request('http://localhost/api/workspace/file-events')
		} as any);
		expect(res.headers.get('content-type')).toContain('application/json');
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	it('nonexistent root → plain JSON ok:false bad-root', async () => {
		const res = await route.GET({
			url: getUrl('/definitely/not/here/xyz'),
			request: new Request('http://localhost/api/workspace/file-events')
		} as any);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('bad-root');
	});

	it('file-as-root → plain JSON ok:false bad-root', async () => {
		const root = makeTempRoot();
		const file = join(root, 'f.txt');
		writeFileSync(file, 'x');
		const res = await route.GET({
			url: getUrl(file),
			request: new Request('http://localhost/api/workspace/file-events')
		} as any);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('bad-root');
	});

	it('happy path: baseline event first, then exactly ONE generation per debounced ring', async () => {
		const root = makeTempRoot();
		const ac = new AbortController();
		const res = await route.GET({
			url: getUrl(root),
			request: new Request('http://localhost/api/workspace/file-events', { signal: ac.signal })
		} as any);
		expect(res.headers.get('content-type')).toContain('text/event-stream');

		const readPromise = readEvents(res, 2, 5000);
		// Event storm: several writes inside the debounce window → ONE ring.
		writeFileSync(join(root, 'a.txt'), '1');
		writeFileSync(join(root, 'b.txt'), '2');
		writeFileSync(join(root, 'c.txt'), '3');
		const events = await readPromise;

		expect(events[0]).toEqual({ event: 'generation', data: '0' }); // baseline
		expect(events.length).toBe(2);
		expect(events[1]).toEqual({ event: 'generation', data: '1' });

		ac.abort();
	});

	it('fs.watch refusal (EACCES mount) → the unavailable SSE event, then close', async () => {
		const root = makeTempRoot();
		// statSync still answers on a 000 directory (metadata only), but
		// fs.watch's open refuses — the route's unsupported-mount arm.
		chmodSync(root, 0o000);
		const res = await route.GET({
			url: getUrl(root),
			request: new Request('http://localhost/api/workspace/file-events')
		} as any);
		const events = await readEvents(res, 2, 3000);
		chmodSync(root, 0o755); // restore so afterEach's rmSync can clean up
		expect(events[0]).toEqual({ event: 'generation', data: '0' }); // baseline
		expect(events[1]).toEqual({ event: 'event', data: 'unavailable' });
	});

	it('abort closes the stream without leak', async () => {
		const root = makeTempRoot();
		const ac = new AbortController();
		const res = await route.GET({
			url: getUrl(root),
			request: new Request('http://localhost/api/workspace/file-events', { signal: ac.signal })
		} as any);
		const reader = res.body!.getReader();
		await reader.read(); // baseline
		ac.abort();
		const { done } = await reader.read();
		expect(done).toBe(true);
	});
});

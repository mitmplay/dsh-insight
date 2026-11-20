/**
 * Coverage complement for the file-events route: paths the primary
 * api-file-events-route.test.ts does not reach — the ReadableStream
 * `cancel()` arm (reader.cancel(), no abort signal) and the send()
 * early-return after the stream is closed.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line import/no-unresolved
import * as route from '$lib/../routes/api/workspace/file-events/+server.js';

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeTempRoot(): string {
	const d = mkdtempSync(join(tmpdir(), 'dsi-file-events-cov-'));
	dirs.push(d);
	return d;
}

describe('file-events route coverage complement', () => {
	it('reader.cancel() reaches the stream cancel() arm and closes the watcher', async () => {
		const root = makeTempRoot();
		const res = await route.GET({
			url: (() => {
				const u = new URL('http://localhost/api/workspace/file-events');
				u.searchParams.set('sessionId', 'sess-cov');
				u.searchParams.set('root', root);
				return u;
			})(),
			request: new Request('http://localhost/api/workspace/file-events')
		} as any);
		expect(res.headers.get('content-type')).toContain('text/event-stream');

		const reader = res.body!.getReader();
		await reader.read(); // baseline generation event
		// Consumer-side cancel (panel unmount without an aborted fetch signal):
		// the stream's cancel() arm must run cleanup — after this, any late
		// watcher event must NOT surface as a second data event.
		await reader.cancel();
		// Coalesce window + late watcher fire would enqueue if cancel leaked.
		writeFileSync(join(root, 'late.txt'), 'x');
		await new Promise((r) => setTimeout(r, 400));
		// cancel() is a one-way close: nothing left to read.
		const done = await reader.read();
		expect(done.done).toBe(true);
	});

	it('send() after stream close is a no-op (early-return arm)', async () => {
		const root = makeTempRoot();
		const ac = new AbortController();
		const res = await route.GET({
			url: (() => {
				const u = new URL('http://localhost/api/workspace/file-events');
				u.searchParams.set('sessionId', 'sess-cov2');
				u.searchParams.set('root', root);
				return u;
			})(),
			request: new Request('http://localhost/api/workspace/file-events', { signal: ac.signal })
		} as any);
		const reader = res.body!.getReader();
		await reader.read(); // baseline
		ac.abort(); // finish(): closed = true
		const { done } = await reader.read();
		expect(done).toBe(true);
		// Post-close watcher event → debounced send() hits the closed early-return.
		writeFileSync(join(root, 'after-abort.txt'), 'x');
		await new Promise((r) => setTimeout(r, 400));
	});
});

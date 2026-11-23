/**
 * file-events SSE route handler test (task 2.1-T, "Explorer Freshness and
 * Image Links" Wave 2; ADR "The Silent Root" D2/D3).
 *
 * Contract pinned (src/routes/api/workspace/file-events/+server.ts):
 * - refusal (missing params L30 / non-directory L42 / nonexistent root L48)
 *   is plain JSON ok:false — never a stream;
 * - the happy path opens an SSE stream whose FIRST event is the BASELINE
 *   generation 0 (L72);
 * - fs.watch(root, { persistent: false }, listener) (L77) coalesces writes
 *   through the 300 ms trailing debounce (L80-L85) into exactly ONE
 *   `generation` event per quiet window, numbered N+1 (L83);
 * - an fs.watch refusal takes the `event: unavailable` arm (L87-L91);
 * - abort runs finish() (L93-L106): watcher closed, stream closed.
 *
 * Temp dirs are real and cleaned in afterEach, which ALSO aborts every live
 * stream first — a failed assertion never leaks a watcher on a deleted temp
 * dir (the old "FileHandle was closed during garbage collection" fallout).
 *
 * Root cause of the full-run flake (diagnosed 2026-11-23, macOS 15.3.2 /
 * Node 26.12.1): on macOS fs.watch is backed by FSEvents and is NOT live
 * when fs.watch() returns. A write landing in that arming gap is dropped
 * for good — never delivered, even after 8 s — while the watcher itself
 * stays healthy (a later write always rang). Probe "mkdtemp → watch → 3
 * writes in the same tick": 0-2 of 100 bursts lost idle, 13-14 of 100
 * under CPU contention (12 busy loops on a 12-core box); delivery latency
 * itself stayed ~50 ms p99, so this is NOT starvation. The old test wrote
 * its storm into the gap and then waited 15 s for a ring that could never
 * come. The happy path now ARMS the watcher first: a probe write that must
 * ring exactly once (bounded retries — a dropped probe is written again),
 * a settled quiet window, and only then the asserted storm.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line import/no-unresolved
import * as route from '$lib/../routes/api/workspace/file-events/+server.js';

const dirs: string[] = [];
/** Streams opened by a test — aborted in afterEach BEFORE the temp dirs go. */
const live: AbortController[] = [];

afterEach(() => {
	for (const ac of live.splice(0)) ac.abort();
	for (const d of dirs.splice(0)) {
		try {
			chmodSync(d, 0o755); // the EACCES test leaves its root at 000
		} catch {
			// already gone
		}
		rmSync(d, { recursive: true, force: true });
	}
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

type SseEvent = { event: string; data: string };

const CLOSED: unique symbol = Symbol('stream closed');

/**
 * Pump one SSE response in the background and hand its frames out one at a
 * time WITHOUT a per-read cancel: `next(ms)` resolves with the next frame,
 * null when `ms` passes without one (the stream stays open — that is how a
 * quiet window is proven), or CLOSED once the route ended the stream.
 */
function tapStream(res: Response): { next: (deadlineMs: number) => Promise<SseEvent | null | typeof CLOSED> } {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	const queued: SseEvent[] = [];
	const waiters: ((ev: SseEvent | typeof CLOSED) => void)[] = [];
	let buffer = '';
	let ended = false;
	void (async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				for (let cut = buffer.indexOf('\n\n'); cut !== -1; cut = buffer.indexOf('\n\n')) {
					const m = /^event: (.+)\ndata: (.+)$/.exec(buffer.slice(0, cut).trim());
					buffer = buffer.slice(cut + 2);
					if (m === null) continue;
					const ev: SseEvent = { event: m[1] as string, data: m[2] as string };
					const waiter = waiters.shift();
					if (waiter !== undefined) waiter(ev);
					else queued.push(ev);
				}
			}
		} catch {
			// reader released — end of stream
		}
		ended = true;
		for (const waiter of waiters.splice(0)) waiter(CLOSED);
	})();
	return {
		next(deadlineMs: number): Promise<SseEvent | null | typeof CLOSED> {
			return new Promise<SseEvent | null | typeof CLOSED>((resolve) => {
				const first = queued.shift();
				if (first !== undefined) return resolve(first);
				if (ended) return resolve(CLOSED);
				let timer: ReturnType<typeof setTimeout>;
				const waiter = (ev: SseEvent | typeof CLOSED): void => {
					clearTimeout(timer);
					resolve(ev);
				};
				timer = setTimeout(() => {
					const i = waiters.indexOf(waiter);
					if (i !== -1) waiters.splice(i, 1); // a late frame must stay queued, not swallowed
					resolve(null);
				}, deadlineMs);
				waiters.push(waiter);
			});
		}
	};
}

// Bounded budgets (ms) for the happy path. RING covers fs.watch latency
// (p99 ≈ 55 ms under a saturated 12-core box, probe 2026-11-23) plus the
// route's 300 ms debounce; QUIET is > 2× the debounce, so a ring that was
// already caused lands inside it. Worst case = RING + 6 probes × (RING +
// QUIET) + RING + QUIET + CLOSE ≈ 17 s — that sum, not a sleep, is what the
// 20 s per-test budget covers; the test itself returns in ~2.5 s.
const RING_MS = 1200;
const QUIET_MS = 800;
const CLOSE_MS = 1500;
const MAX_PROBES = 6;

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
	// Timing note (supersedes the old "15 s readEvents budget" note): the
	// failure was never a slow ring — it was a ring that could not happen
	// because the storm was written before fs.watch was live (see header).
	// Every assertion below is a hard behavioural claim: the baseline is the
	// first frame; every ring is exactly +1 over the previous one; the storm
	// produces exactly ONE ring and then the line stays quiet; abort ends the
	// stream.
	it(
		'happy path: baseline first, exactly ONE generation per debounced ring, abort closes',
		{ timeout: 20_000 },
		async () => {
			const root = makeTempRoot();
			const ac = new AbortController();
			live.push(ac);
			const res = await route.GET({
				url: getUrl(root),
				request: new Request('http://localhost/api/workspace/file-events', { signal: ac.signal })
			} as any);
			expect(res.headers.get('content-type')).toContain('text/event-stream');
			const tap = tapStream(res);

			// 1. FIRST frame on the wire is the baseline — before any write.
			expect(await tap.next(RING_MS)).toEqual({ event: 'generation', data: '0' });

			// 2. Arm the watcher: one probe write must ring exactly once. A probe
			//    that fell into fs.watch's arming gap is dropped for good, so it is
			//    written again (bounded) — a probe that DID ring yields exactly the
			//    next generation, never two.
			let gen = 0;
			let armed = false;
			for (let probe = 1; probe <= MAX_PROBES && !armed; probe++) {
				writeFileSync(join(root, `probe-${probe}.txt`), 'p');
				const ring = await tap.next(RING_MS);
				if (ring === null) continue; // dropped by the arming gap — probe again
				gen += 1;
				expect(ring).toEqual({ event: 'generation', data: String(gen) });
				armed = true;
			}
			expect(armed, 'no probe write ever rang — fs.watch delivered nothing').toBe(true);
			// A dropped-looking probe may still have been merely slow: whatever lands
			// before the line goes quiet must be a +1 ring too.
			for (let late = await tap.next(QUIET_MS); late !== null; late = await tap.next(QUIET_MS)) {
				gen += 1;
				expect(late).toEqual({ event: 'generation', data: String(gen) });
			}

			// 3. The asserted storm: several writes inside the debounce window →
			//    exactly ONE ring, numbered gen+1, and then silence for a window
			//    longer than two debounce periods (a second ring would show up).
			writeFileSync(join(root, 'a.txt'), '1');
			writeFileSync(join(root, 'b.txt'), '2');
			writeFileSync(join(root, 'c.txt'), '3');
			gen += 1;
			expect(await tap.next(RING_MS)).toEqual({ event: 'generation', data: String(gen) });
			expect(await tap.next(QUIET_MS)).toBeNull(); // exactly ONE ring

			// 4. Abort (panel unmount) ends the stream.
			ac.abort();
			expect(await tap.next(CLOSE_MS)).toBe(CLOSED);
		}
	);

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

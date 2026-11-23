/**
 * file-events SSE route — the watch → debounce → ring unit contract
 * (ADR "The Silent Root" D2/D3). Deterministic twin of the real-fs.watch
 * happy path in tests/unit/api-file-events-route.test.ts: that one waits on
 * macOS fs.watch delivery latency and times out under full-suite load, so
 * the listener arms went unmeasured in coverage. Here ONLY fs.watch is
 * stubbed (vi.mock('node:fs'); statSync stays real on a real temp dir),
 * the captured listener is invoked by hand and the 300 ms debounce is
 * driven with fake timers — no real fs timing is involved anywhere.
 *
 * Pins src/routes/api/workspace/file-events/+server.ts:
 *   - L72    start() sends the BASELINE `generation` / `0` first.
 *   - L77-86 the watch listener arms ONE trailing 300 ms timer — clearing
 *           a pending one first (L80) so an event storm rings exactly once —
 *           then bumps generation and sends `generation` (L83-84).
 *   - L61-68 send() returns early once closed (L62); a throwing encode or
 *           enqueue marks the stream closed instead of escaping (L66).
 *   - L87-91 fs.watch refusing sends `event` / `unavailable`.
 *   - L93-104 finish() is an idempotent close (L94): clears the pending
 *           debounce (L96), closes the watcher (L97), closes the controller
 *           (L99); wired to request.signal 'abort' (L106) and to the
 *           stream's cancel() (L108-110).
 */
// @vitest-environment node
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FSWatcher } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const watchMock = vi.hoisted(() => vi.fn<typeof import('node:fs').watch>());

vi.mock('node:fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:fs')>()),
	watch: (...a: Parameters<typeof import('node:fs').watch>) => watchMock(...a)
}));

// eslint-disable-next-line import/no-unresolved
import * as route from '$lib/../routes/api/workspace/file-events/+server.js';

/** The route's DEBOUNCE_MS — mirrored here to drive the trailing edge exactly. */
const DEBOUNCE_MS = 300;

type Sse = { event: string; data: string };

const dirs: string[] = [];
const streams: { ac: AbortController; reader: ReadableStreamDefaultReader<Uint8Array> }[] = [];

function makeTempRoot(): string {
	const d = mkdtempSync(join(tmpdir(), 'dsi-file-events-unit-'));
	dirs.push(d);
	return d;
}

function getUrl(root: string): URL {
	const u = new URL('http://localhost/api/workspace/file-events');
	u.searchParams.set('sessionId', 'sess-1');
	u.searchParams.set('root', root);
	return u;
}

/** One enqueued SSE frame — the route emits exactly one `event:/data:` frame per send(). */
function parseFrame(chunk: Uint8Array): Sse {
	const text = new TextDecoder().decode(chunk);
	const m = /^event: (.+)\ndata: (.+)$/.exec(text.trim());
	if (!m) throw new Error(`malformed SSE frame: ${JSON.stringify(text)}`);
	return { event: m[1] as string, data: m[2] as string };
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Sse> {
	const { done, value } = await reader.read();
	if (done) throw new Error('stream ended before the expected SSE frame');
	return parseFrame(value);
}

/**
 * A pending read() with a settled flag. `settled === false` after the timers
 * and microtasks were flushed proves the stream emitted NOTHING — the
 * negative half of the debounce and close contracts.
 */
function pendingRead(reader: ReadableStreamDefaultReader<Uint8Array>) {
	const state = { settled: false, promise: reader.read() };
	state.promise.then(
		() => {
			state.settled = true;
		},
		() => {
			state.settled = true;
		}
	);
	return state;
}

interface Opened {
	root: string;
	ac: AbortController;
	res: Response;
	reader: ReadableStreamDefaultReader<Uint8Array>;
	/** close() on the fake watcher the route received from the stubbed fs.watch. */
	close: ReturnType<typeof vi.fn>;
	/** The listener the route handed to fs.watch — a real watcher event, by hand. */
	listener: (eventType: string, filename: string | null) => void;
}

/**
 * GET with fs.watch stubbed (statSync real): captures the listener the route
 * registers and hands back a fake watcher whose close() is a spy.
 */
async function open(): Promise<Opened> {
	const root = makeTempRoot();
	const ac = new AbortController();
	const close = vi.fn();
	watchMock.mockImplementation(() => ({ close } as unknown as FSWatcher));
	const res = await route.GET({
		url: getUrl(root),
		request: new Request('http://localhost/api/workspace/file-events', { signal: ac.signal })
	} as any);
	const reader = res.body!.getReader();
	streams.push({ ac, reader });
	expect(watchMock).toHaveBeenCalledTimes(1); // one shallow watch per connection
	const listener = (watchMock.mock.calls as unknown as Array<[unknown, unknown, (event: unknown) => void]>)[0]![2];
	return {
		root,
		ac,
		res,
		reader,
		close,
		listener: listener as unknown as (eventType: string, filename: string | null) => void
	};
}

/** Resolves a pendingRead() promise into its frame — the positive half once the timers advanced. */
async function frameOf(pending: Promise<ReadableStreamReadResult<Uint8Array>>): Promise<Sse> {
	const { done, value } = await pending;
	if (done) throw new Error('stream ended before the expected SSE frame');
	return parseFrame(value);
}

describe('file-events route — watch → debounce → ring (fs.watch stubbed, fake timers)', () => {
	beforeEach(() => {
		// Only the two timers the route uses; nothing else here is time-dependent.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	});

	afterEach(async () => {
		// Tear every stream down so no pending read outlives its test.
		for (const s of streams.splice(0)) {
			s.ac.abort();
			await s.reader.cancel().catch(() => undefined);
		}
		vi.useRealTimers();
		vi.restoreAllMocks();
		watchMock.mockReset();
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	it('a watch event arms the 300 ms trailing debounce and rings exactly once; a second event inside the window coalesces (pending timer cleared)', async () => {
		const { root, res, reader, listener, close, ac } = await open();
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		// Shallow, non-persistent watch on the very root (L77), one per connection.
		expect(watchMock.mock.calls[0]!.slice(0, 2)).toEqual([root, { persistent: false }]);

		// The FIRST event is the baseline (L72); nothing is armed before any watch event.
		expect(await readFrame(reader)).toEqual({ event: 'generation', data: '0' });
		expect(vi.getTimerCount()).toBe(0);

		// t=0 — watch event #1: ONE timer armed, nothing sent synchronously (trailing).
		listener('rename', 'a.txt');
		expect(vi.getTimerCount()).toBe(1);
		const ring = pendingRead(reader);
		await vi.advanceTimersByTimeAsync(200); // t=200, still inside the window
		expect(ring.settled).toBe(false);

		// t=200 — watch event #2 inside the window: the t=300 timer is cleared (L80)
		// and re-armed for t=500 — still exactly ONE armed timer.
		listener('change', 'b.txt');
		expect(vi.getTimerCount()).toBe(1);

		// t=300 — the FIRST timer would have rung here had it survived the clear.
		await vi.advanceTimersByTimeAsync(100);
		expect(ring.settled).toBe(false);

		// t=500 — the trailing edge: exactly one ring for the storm, generation 1 (L83-84).
		await vi.advanceTimersByTimeAsync(200);
		expect(await frameOf(ring.promise)).toEqual({ event: 'generation', data: '1' });
		expect(vi.getTimerCount()).toBe(0); // the fired timer is detached (L82)

		// ...and nothing else follows: no second ring, no timer left behind.
		const after = pendingRead(reader);
		await vi.advanceTimersByTimeAsync(5000);
		expect(after.settled).toBe(false);
		expect(vi.getTimerCount()).toBe(0);

		// Panel unmount: abort closes the watcher (L97) and ends the stream (L99).
		ac.abort();
		expect(close).toHaveBeenCalledTimes(1);
		expect(await after.promise).toMatchObject({ done: true });
	});

	it('a later, separate watch event rings again with generation 2 (the counter is per connection, never reset)', async () => {
		const { reader, listener, close, ac } = await open();
		expect(await readFrame(reader)).toEqual({ event: 'generation', data: '0' });

		listener('rename', 'a.txt');
		const first = pendingRead(reader);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1); // 299 ms: not yet — trailing, not leading
		expect(first.settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await frameOf(first.promise)).toEqual({ event: 'generation', data: '1' });
		expect(vi.getTimerCount()).toBe(0);

		// A quiet window later, the next event is a NEW ring — generation 2, not a replay of 1.
		listener('rename', 'c.txt');
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(await readFrame(reader)).toEqual({ event: 'generation', data: '2' });
		expect(vi.getTimerCount()).toBe(0);

		ac.abort();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('abort while a debounce is pending: the timer is cleared, nothing more is sent, the watcher closes and the stream ends', async () => {
		const { reader, listener, close, ac } = await open();
		expect(await readFrame(reader)).toEqual({ event: 'generation', data: '0' });
		listener('rename', 'a.txt');
		expect(vi.getTimerCount()).toBe(1);

		ac.abort(); // finish() (L93-104) through the signal listener (L106)
		expect(close).toHaveBeenCalledTimes(1); // L97
		expect(vi.getTimerCount()).toBe(0); // L96 — the pending ring was cancelled, not left to fire
		expect(await reader.read()).toMatchObject({ done: true }); // L99 — controller.close()

		// The cancelled timer never fires; the closed gate (L62/L94) swallows anything late.
		await vi.advanceTimersByTimeAsync(5000);
		expect(vi.getTimerCount()).toBe(0);
		expect(await reader.read()).toMatchObject({ done: true });

		// finish() is idempotent (L94): the cancel path after an abort neither
		// re-closes the watcher nor throws.
		await reader.cancel();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('cancelling the reader (stream cancel, L108-110) runs the same teardown: watcher closed, pending debounce cleared, stream done', async () => {
		const { reader, listener, close, ac } = await open();
		expect(await readFrame(reader)).toEqual({ event: 'generation', data: '0' });
		listener('rename', 'a.txt');
		expect(vi.getTimerCount()).toBe(1);

		await reader.cancel('panel unmounted'); // cancel() → cleanup() (L109) → finish()
		expect(close).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		expect(await reader.read()).toMatchObject({ done: true });

		// A late abort after the cancel changes nothing (L94) and nothing is emitted again.
		ac.abort();
		expect(close).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5000);
		expect(vi.getTimerCount()).toBe(0);
		expect(await reader.read()).toMatchObject({ done: true });
	});

	it('a throwing encoder is swallowed (L66): GET still answers, later sends are no-ops and the consumer can still tear the stream down', async () => {
		// The very first send() is the baseline (L72) — make its encode throw ONCE.
		const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementationOnce(() => {
			throw new Error('encode boom');
		});
		const { res, reader, listener, ac } = await open(); // must not reject (L63-67)
		expect(res.headers.get('content-type')).toContain('text/event-stream');

		// A watch event still arms the debounce and its timer still fires — but the
		// closed gate (L62) drops the ring before it ever reaches the encoder.
		listener('rename', 'a.txt');
		const ring = pendingRead(reader);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(vi.getTimerCount()).toBe(0);
		expect(ring.settled).toBe(false);
		expect(encode).toHaveBeenCalledTimes(1);

		// NOTE (reported to the lead): once the L66 arm marks the stream closed,
		// finish() early-returns (L94) — an abort here neither closes the controller
		// nor the watcher; the stream only ends through the reader's cancel(). This
		// pins the no-throw teardown, deliberately not the hang.
		expect(() => ac.abort()).not.toThrow();
		await reader.cancel();
		expect(await reader.read()).toMatchObject({ done: true });
	});

	it('fs.watch throwing → the `event` / `unavailable` SSE frame after the baseline; abort then ends the stream', async () => {
		watchMock.mockImplementationOnce(() => {
			throw Object.assign(new Error('watch EACCES'), { code: 'EACCES' });
		});
		const { reader, ac } = await open(); // GET does not propagate the refusal (L87-91)
		expect(await readFrame(reader)).toEqual({ event: 'generation', data: '0' }); // baseline (L72)
		expect(await readFrame(reader)).toEqual({ event: 'event', data: 'unavailable' });
		expect(vi.getTimerCount()).toBe(0); // no watcher exists → nothing ever arms a debounce

		ac.abort(); // finish(): no watcher to close (L75 stays null), only the controller (L99)
		expect(await reader.read()).toMatchObject({ done: true });
	});
});

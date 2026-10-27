/**
 * /api/browser/[id]/stream — the SSE downstream (Wave 1 task 1.4).
 * Frames: frame (seq + jpeg base64 + metadata), closed. ?fromSeq resumes a
 * late attacher from the latest frame (the terminal fromByte pattern).
 * Cancel arm: client going away MUST drop the subscriber or the next frame
 * enqueues into a dead controller (crash RCA 2026-09-24 lesson).
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';
import type { BrowserRelay, RelayFrame } from '$lib/server/browser/relay.js';

const SSE_HEADERS: Record<string, string> = {
	'content-type': 'text/event-stream',
	'cache-control': 'no-store',
	connection: 'keep-alive',
	'x-accel-buffering': 'no',
	// the preview server's compression middleware gzip-BUFFERS text/event-stream
	// when the client sends Accept-Encoding: gzip — EventSource starves (frames
	// sat in the zlib buffer for seconds). Declaring identity claims the
	// encoding slot first and the middleware passes the stream through.
	'content-encoding': 'identity'
};

function sse(event: string, data: unknown): string {
	return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

export const GET = (ctx: { params: { id: string }; url: URL }): Response => {
	const id = ctx.params.id;
	try {
		browserRegistry.peek(id);
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		throw err;
	}
	const fromSeq = Number(ctx.url.searchParams.get('fromSeq') ?? '0');
	// Reaper liveness (ADR-0030 D2): a watched stream is never reaper-
	// eligible; the cancel arm drops the count (crash-safe either way).
	browserRegistry.noteStreamOpen(id);

	const encoder = new TextEncoder();
	const state = { closed: false };
	let off: (() => void) | null = null;
	let offActive: (() => void) | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const push = (chunk: string) => {
				if (state.closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					state.closed = true;
					off?.();
					offActive?.();
				}
			};
			// D5 amendment 2026-10-27: the stream follows the ACTIVE pointer.
			// The old code bound ONE relay at connect — a brain-driven activate
			// (creation auto-focus) moved the strip but the mirror kept painting
			// the old tab. The panel reconnects only on its OWN strip clicks;
			// registry-side switches re-bind here, pushing the new face's latest
			// frame as the boundary so the mirror flips immediately.
			let current: BrowserRelay | null = null;
			const bind = () => {
				let relay: BrowserRelay;
				try {
					relay = browserRegistry.relay(id);
				} catch {
					return; // closing / no handle yet — keep the old face
				}
				if (relay === current) return;
				off?.();
				off = null;
				current = relay;
				const latest = relay.latestFrame();
				if (latest && (Number.isNaN(fromSeq) || latest.seq > fromSeq)) push(sse('frame', latest));
				off = relay.subscribe((f: RelayFrame) => push(sse('frame', f)));
			};
			bind();
			offActive = browserRegistry.onActiveChange(id, () => bind());
		},
		cancel() {
			state.closed = true;
			off?.();
			offActive?.();
			browserRegistry.noteStreamClose(id);
		}
	});
	return new Response(stream, { headers: SSE_HEADERS });
};
/**
 * api-dsh — GET /api/dsh/jobs/stream
 *
 * The Job Bridge's birth channel (ADR-0081 D1, the PUSH stage): one
 * text/event-stream per connected desk, forwarding the relay's roster frames
 * — the same whole-set frames the mux hands to `relay.dispatchJobRoster` —
 * verbatim, one SSE `data:` line per frame: `{ sessionId, jobs }`.
 *
 * Unnamed events on purpose: the browser's EventSource reads `onmessage`,
 * so a named-event frame would never reach it (the sibling follow route
 * frames the same way). The stream is a live tap, not a log — a frame
 * dispatched before connect is NOT replayed; the browser's spine-tick
 * snapshot is the fallback stage that catches what a missed push loses.
 *
 * Listener discipline (the weakest point, karpathy-context 2.6): ONE
 * `relay.onJobRoster` listener per connection, added in `start()` and
 * released on cancel AND on `request.signal.abort` — a browser tab that
 * reconnects in a loop never leaks listeners. Read-only by construction:
 * no POST exists on this route.
 */

import { getDshConnection } from '$lib/server/dsh-connection';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => {
	const relay = getDshConnection().relay;
	const encoder = new TextEncoder();
	const state = { closed: false };
	let unsubscribe: (() => void) | null = null;

	/** Release the relay listener and mark the stream closed. Idempotent —
	 *  cancel and abort can both fire for the same connection; a released
	 *  listener is inert (enqueue returns before touching the controller). */
	const release = () => {
		unsubscribe?.();
		unsubscribe = null;
		state.closed = true;
	};

	// `start` runs synchronously on construction, so the controller is in
	// scope for the abort hook registered below — no nullable holder.
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const enqueue = (chunk: string) => {
				if (state.closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// a cancel raced an in-flight enqueue — treat as closed
					state.closed = true;
				}
			};
			unsubscribe = relay.onJobRoster((sessionId, jobs) => {
				enqueue('data: ' + JSON.stringify({ sessionId, jobs }) + '\n\n');
			});
			// The client goes away and the platform aborts the request — close
			// the body so the platform releases it, after unref'ing the listener.
			request.signal.addEventListener('abort', () => {
				release();
				try {
					controller.close();
				} catch {
					// already cancelled or closed — nothing left to hand the reader
				}
			});
		},
		cancel() {
			// the consumer cancelled the body — unref the relay
			release();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};

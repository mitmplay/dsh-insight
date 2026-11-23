/**
 * /api/terminal/[id]/stream — the SSE downstream (Wave 3, task 3.2).
 *
 * Frames: output (byte-offset deltas with lossy + spillPath), settled,
 * exit, closed, baton (ADR-0079 D7 — holder/holderId/since, token-free),
 * error. Watching is the open path (no token — ADR D7);
 * the stream ends after closed. fromByte resumes a late attacher from the
 * ring tail; a slid-out offset reports lossy and names the spill.
 * X-Accel-Buffering: no keeps reverse proxies from buffering the stream.
 *
 * Cancel arm (crash RCA 2026-09-24): a CLIENT going away (reload / tab
 * close) cancels the ReadableStream while the PTY lives on — without
 * dropping the session listener there, the next output chunk enqueues
 * into a dead controller and the ERR_INVALID_STATE throw kills the
 * server process.
 */
import { json } from '@sveltejs/kit';

import { terminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import type { TerminalSessionEvent } from '$lib/server/terminal/types.js';

const SSE_HEADERS: Record<string, string> = {
	'content-type': 'text/event-stream',
	'cache-control': 'no-store',
	connection: 'keep-alive',
	'x-accel-buffering': 'no'
};

function sseFrame(event: string, data: unknown): string {
	return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

export const GET = (ctx: { params: { id: string }; url: URL }): Response => {
	const id = ctx.params.id;
	try {
		terminalRegistry.peek(id);
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		throw err;
	}
	const fromByteRaw = Number(ctx.url.searchParams.get('fromByte') ?? '0');
	const fromByte = Number.isFinite(fromByteRaw) && fromByteRaw >= 0 ? fromByteRaw : 0;

	const session = terminalRegistry.events(id);
	if (!session) return json({ error: 'NO_SESSION' }, { status: 404 });

	const encoder = new TextEncoder();
	const state = { closed: false };
	let onEvent: (event: TerminalSessionEvent) => void = () => undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// closed is set by BOTH ends: the session's own closed frame, and
			// the client going away (cancel below).
			const enqueue = (chunk: string) => {
				if (state.closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// a cancel raced an in-flight enqueue — treat as closed
					state.closed = true;
				}
			};

			// Tail first, then live deltas — one attach, no gap.
			const read = session.readFrom(fromByte);
			enqueue(sseFrame('output', { text: read.text, nextOffset: read.nextOffset, lossy: read.lossy, spillPath: read.spillPath }));

			onEvent = (event: TerminalSessionEvent) => {
				if (event.type === 'output') {
					// Live chunks flow through the same ring; the session emits
					// bytes, we trust the offset it published.
					enqueue(sseFrame('output', { text: event.bytes, nextOffset: event.nextOffset, lossy: false }));
					return;
				}
				if (event.type === 'settled') {
					enqueue(sseFrame('settled', { reason: event.reason }));
					return;
				}
				if (event.type === 'baton') {
					// the baton facet moved (mint / release) — projected one-to-one
					enqueue(sseFrame('baton', { holder: event.holder, holderId: event.holderId, since: event.since }));
					return;
				}
				if (event.type === 'exit') {
					enqueue(sseFrame('exit', { outcome: event.outcome }));
					return;
				}
				if (event.type === 'closed') {
					enqueue(sseFrame('closed', { quiescent: event.quiescent, lingeringPids: event.lingeringPids }));
					state.closed = true;
					session.off('event', onEvent);
					try {
						controller.close();
					} catch {
						// already cancelled by the client — nothing to close
					}
				}
			};
			session.on('event', onEvent);

			if (session.isExited() && terminalRegistry.exitOutcome(id) !== null && !terminalRegistry.list().some((s) => s.id === id)) {
				// session vanished between peek and subscribe — end honestly
				enqueue(sseFrame('error', { error: 'NO_SESSION' }));
				state.closed = true;
				session.off('event', onEvent);
				controller.close();
			}
		},
		cancel() {
			// the CLIENT vanished (reload / tab close cancels the stream):
			// drop the listener so a live PTY cannot enqueue into a cancelled
			// controller (crash RCA 2026-09-24)
			state.closed = true;
			session.off('event', onEvent);
		}
	});

	return new Response(stream, { headers: SSE_HEADERS });
};

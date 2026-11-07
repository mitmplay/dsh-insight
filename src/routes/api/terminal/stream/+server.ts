/**
 * /api/terminal/stream — the ONE multiplexed SSE hub (ADR-0053 Wave 1).
 *
 * Plain terms: instead of one private pipe per terminal row (the browser's
 * 6-per-host HTTP/1.1 budget — RCA 2026-11-07), this endpoint carries every
 * subscribed session's frames down ONE stream, each frame labelled with its
 * sessionId; the client hub fans them back out by id.
 *
 * Wire: GET ?ids=<url-encoded JSON array>&resume=<url-encoded JSON object
 * mapping id -> byte offset>. EventSource cannot POST, so both ride the
 * query string (ADR-0053 constraint). Per id:
 * - tail replay via registry.readFrom(id, resume[id] ?? 0) — the FIRST
 *   output frame carries nextOffset/lossy/spillPath (same shape as the
 *   per-session endpoint, plus the sessionId tag);
 * - live subscription via registry.events(id), frames tagged sessionId;
 * - a dead/unknown id is NOT fatal to the hub: it emits one per-session
 *   error frame (NO_SESSION) and keeps serving the rest (AC5).
 *
 * Cancel arm (crash RCA 2026-09-24, AC7): a client going away cancels the
 * ReadableStream — ALL per-session listeners are dropped there so no live
 * PTY can enqueue into a dead controller. Each session's own closed frame
 * drops only that id's listener; the hub keeps serving the other ids.
 *
 * The per-session endpoint /api/terminal/[id]/stream stays untouched as
 * the fallback (ADR-0053 D6).
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

/** Parse the ids query param — a JSON array of session ids (deduped). */
function parseIds(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return [...new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0))];
	} catch {
		return [];
	}
}

/** Parse the resume query param — a JSON object mapping id -> byte offset. */
function parseResume(raw: string | null): Record<string, number> {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, number> = {};
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

export const GET = (ctx: { url: URL }): Response => {
	const ids = parseIds(ctx.url.searchParams.get('ids'));
	const resume = parseResume(ctx.url.searchParams.get('resume'));
	if (ids.length === 0) return json({ error: 'NO_IDS' }, { status: 400 });

	const encoder = new TextEncoder();
	const state = { closed: false };

	// One listener per subscribed id — dropped individually when that
	// session closes, and ALL dropped when the client cancels (AC7).
	const detachFns: Array<() => void> = [];

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

			const makeOnEvent = (id: string) => {
				return (event: TerminalSessionEvent) => {
					if (event.type === 'output') {
						enqueue(sseFrame('output', { sessionId: id, text: event.bytes, nextOffset: event.nextOffset, lossy: false }));
						return;
					}
					if (event.type === 'settled') {
						enqueue(sseFrame('settled', { sessionId: id, reason: event.reason }));
						return;
					}
					if (event.type === 'exit') {
						enqueue(sseFrame('exit', { sessionId: id, outcome: event.outcome }));
						return;
					}
					if (event.type === 'closed') {
						enqueue(sseFrame('closed', { sessionId: id, quiescent: event.quiescent, lingeringPids: event.lingeringPids }));
						// this session ended — drop ONLY its listener; the hub
						// keeps serving the remaining ids (AC5's survival shape)
						detachFns.find((fn) => fn === detach.get(id))?.();
					}
				};
			};

			const detach = new Map<string, () => void>();

			for (const id of ids) {
				// Unknown id: one error frame for THAT id, hub survives (AC5).
				try {
					terminalRegistry.peek(id);
				} catch (err) {
					if (err instanceof TerminalRegistryRefusal) {
						enqueue(sseFrame('error', { sessionId: id, error: err.code }));
						continue;
					}
					throw err;
				}

				const session = terminalRegistry.events(id);
				if (!session) {
					enqueue(sseFrame('error', { sessionId: id, error: 'NO_SESSION' }));
					continue;
				}

				// Tail first, then live deltas — one attach per id, no gap.
				const fromByte = resume[id] ?? 0;
				const read = terminalRegistry.readFrom(id, fromByte);
				enqueue(sseFrame('output', { sessionId: id, text: read.text, nextOffset: read.nextOffset, lossy: read.lossy, spillPath: read.spillPath }));

				const onEvent = makeOnEvent(id);
				session.on('event', onEvent);
				const off = () => {
					session.off('event', onEvent);
					detach.delete(id);
					const idx = detachFns.indexOf(off);
					if (idx >= 0) detachFns.splice(idx, 1);
				};
				detach.set(id, off);
				detachFns.push(off);

				if (session.isExited() && terminalRegistry.exitOutcome(id) !== null && !terminalRegistry.list().some((s) => s.id === id)) {
					// session vanished between peek and subscribe — one honest
					// error frame for this id, drop its listener, hub survives
					enqueue(sseFrame('error', { sessionId: id, error: 'NO_SESSION' }));
					off();
				}
			}
		},
		cancel() {
			// the CLIENT vanished: drop ALL per-session listeners so no live
			// PTY enqueues into a cancelled controller (crash RCA 2026-09-24,
			// AC7) — and the hub holds nothing with zero subscribers (BC-7)
			state.closed = true;
			for (const off of [...detachFns]) off();
			detachFns.length = 0;
		}
	});

	return new Response(stream, { headers: SSE_HEADERS });
};

/**
 * roster-push-client.svelte.ts — the BROWSER side of The Job Bridge's birth
 * channel (ADR-0081 D1, the PUSH stage). ONE module-level EventSource on
 * /api/dsh/jobs/stream, refcounted the spine-feed way: the FIRST
 * subscribeRosterPush(fn) opens it, the LAST unsubscribe closes it — one
 * connection per page however many desks mount, and no leaked stream when
 * none remain. No client timer lives here (BC-7): the browser's EventSource
 * owns its own reconnect.
 *
 * Frames are `{ sessionId, jobs }` data lines — the route forwards the
 * relay's roster frames VERBATIM. This module knows nothing of rows: it
 * parses, shape-checks, and fans out to every subscriber; the desk owns the
 * adoption rule (job-adoption). Malformed frames are dropped, never
 * rendered (connectJobFollow's rule) — and one subscriber's throw can
 * neither break its neighbours nor the stream.
 *
 * Boundary (PRD 4.3): the desk subscribes here. The roster list never
 * imports the desk; this module imports neither.
 */

import type { DsiJobView } from '$lib/types';

/** One roster frame as the route forwards it (Task 1.3). */
export interface RosterPushFrame {
	sessionId: string;
	jobs: DsiJobView[];
}

/** What a desk registers: `(sessionId, jobs)` per frame. */
export type RosterPushListener = (sessionId: string, jobs: DsiJobView[]) => void;

/** The route Task 1.3 opened — the browser never reaches the relay itself. */
const STREAM_URL = '/api/dsh/jobs/stream';

/**
 * Registered desks, in subscription order — a plain array, the same shape
 * as follow-client's pending queue. An event-bus registry is bookkeeping,
 * never render state: nothing derives from it, so it carries no reactivity
 * (the reason this is NOT a SvelteSet).
 */
const listeners: RosterPushListener[] = [];

/** The one stream — null while no desk is subscribed. */
let source: EventSource | null = null;

/**
 * Parse one SSE `data:` line into a roster frame; null when it is not one
 * (not JSON, wrong shape, no jobs array). Entries inside `jobs` that are not
 * objects are not jobs — dropped here so no consumer ever sees them.
 */
function parseRosterFrame(data: string): RosterPushFrame | null {
	let raw: unknown;
	try {
		raw = JSON.parse(data);
	} catch {
		return null;
	}
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const { sessionId, jobs } = raw as { sessionId?: unknown; jobs?: unknown };
	if (typeof sessionId !== 'string' || !Array.isArray(jobs)) return null;
	return {
		sessionId,
		jobs: jobs.filter((entry): entry is DsiJobView => entry !== null && typeof entry === 'object')
	};
}

function open(): void {
	const es = new EventSource(STREAM_URL);
	source = es;
	es.onmessage = (m: MessageEvent<string>) => {
		// A superseded stream is inert: when the last unsubscribe closes it
		// and a new desk re-opens in the same flush, a frame already queued
		// on the old connection must not speak for the new one.
		if (source !== es) return;
		const frame = parseRosterFrame(m.data);
		if (frame === null) return;
		// A snapshot: a listener that unsubscribes mid-frame must not be
		// visited, and one that subscribes mid-frame waits for the next one.
		for (const listener of listeners.slice()) {
			try {
				listener(frame.sessionId, frame.jobs);
			} catch {
				// one desk's throw must not break the others or the stream
			}
		}
	};
}

function close(): void {
	source?.close();
	source = null;
}

/**
 * Register a desk. The first registration opens the stream. Returns the
 * unsubscribe — the LAST one closes the stream.
 *
 * D-f (The Job Bridge, Wave 3): the push DEGRADES, it never crashes. With
 * no EventSource on the platform (a unit environment), register nothing,
 * open nothing, and hand back a no-op unsubscribe — 'no platform push:
 * the snapshot fallback is the desk's only birth signal'.
 */
export function subscribeRosterPush(listener: RosterPushListener): () => void {
	if (typeof EventSource === 'undefined') return () => {};
	if (source === null) open();
	if (!listeners.includes(listener)) listeners.push(listener); // one desk, one entry
	return () => {
		const at = listeners.indexOf(listener);
		if (at !== -1) listeners.splice(at, 1);
		if (listeners.length === 0) close();
	};
}

/** Test isolation only: drop every listener and close the stream. */
export function __resetRosterPushForTests(): void {
	listeners.length = 0;
	close();
}

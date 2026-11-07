/**
 * stream-hub.svelte.ts — the ONE client hub for terminal frames
 * (ADR-0053 Wave 2, D1–D5).
 *
 * Plain terms: every terminal row on the page hands this service a
 * subscription instead of opening its own private pipe. The service holds
 * THE EventSource to /api/terminal/stream, stamps each arriving frame
 * with its sessionId, and hands it back to the row that owns the id.
 * The pipe opens when the first row needs it and closes when the last
 * one leaves — the desk's connection appetite stops scaling with the
 * terminal count (RCA 2026-11-07).
 *
 * Lifecycle (the spine-feed refcount precedent, BC-7):
 * - subscribe count 0 → 1 opens the source; 1 → 0 closes it. The hub
 *   NEVER outlives its last subscriber.
 * - Session-set changes (a row joins/leaves) cannot POST (EventSource),
 *   so the source RE-OPENS with the new ids — debounced 300 ms so a
 *   rapid tab open/close settles into ONE re-open (D3).
 * - A re-open carries a resume map built from each ROW's painted offset
 *   (the row is the offset authority — ADR-0053 state homes), so no
 *   scrollback replays twice and no bytes are lost between connections.
 * - ONE hub-level backoff ladder (1 s doubling to 8 s, D4); a successful
 *   output frame resets it. Per-session failures ride the wire as error
 *   frames, never as hub disconnects.
 *
 * Isolation (AC3): dispatch is strictly by sessionId — a row only ever
 * sees frames carrying its own id. Rows never import this module's
 * internals; they call subscribeTerminalStream and get an unsubscribe.
 */

export type TerminalHubFrameKind = 'output' | 'settled' | 'exit' | 'closed' | 'error';

export interface TerminalHubFrameData {
	sessionId: string;
	text?: string;
	nextOffset?: number;
	lossy?: boolean;
	spillPath?: string;
	reason?: string;
	outcome?: unknown;
	quiescent?: boolean;
	lingeringPids?: number[];
	error?: string;
	[key: string]: unknown;
}

export interface TerminalHubHandlers {
	/** The row's frame brain entry point — same shapes the per-session
	 *  endpoint delivered, PLUS the sessionId tag (extra keys are
	 *  ignored by reduceTerminalFrame — karpathy 2.5). */
	onFrame(kind: TerminalHubFrameKind, data: TerminalHubFrameData): void;
}

interface HubSubscription {
	id: string;
	/** The offset this row has ACTUALLY painted — the re-open resume
	 *  authority (karpathy 2.4: built from ROWS' offsets, not the hub's). */
	paintedOffset: number;
	handlers: TerminalHubHandlers;
}

const RESYNC_DEBOUNCE_MS = 300;
const HUB_RECONNECT_MIN_MS = 1000;
const HUB_RECONNECT_MAX_MS = 8000;

const subs = new Map<number, HubSubscription>();
let nextSubToken = 0;

let liveEs: EventSource | null = null;
/** The id set the live source was opened with — the diff baseline. */
let liveIds: string[] | null = null;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = HUB_RECONNECT_MIN_MS;
/** Bumping the generation invalidates a ladder timer that fired while a
 *  deliberate close was in flight — it must never re-open the hub. */
let generation = 0;

function currentIds(): string[] {
	return [...new Set([...subs.values()].map((s) => s.id))];
}

/** Resume map at re-open time: each subscriber's painted offset wins
 *  (a subscriber that painted past the snapshot dedupes by nextOffset). */
function currentResume(): Record<string, number> {
	const map: Record<string, number> = {};
	for (const s of subs.values()) {
		map[s.id] = Math.min(map[s.id] ?? Number.POSITIVE_INFINITY, s.paintedOffset);
	}
	for (const id of Object.keys(map)) {
		if (!Number.isFinite(map[id])) delete map[id];
	}
	return map;
}

function closeHub(): void {
	generation += 1;
	liveEs?.close();
	liveEs = null;
	liveIds = null;
	reconnectDelayMs = HUB_RECONNECT_MIN_MS;
	if (resyncTimer !== null) {
		clearTimeout(resyncTimer);
		resyncTimer = null;
	}
	if (reconnectTimer !== null) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

/** Set-diff at FIRE time (not schedule time): a closed id that left
 *  during the debounce never enters the re-open set (risk register). */
function resyncIfSetChanged(): void {
	resyncTimer = null;
	const desired = currentIds();
	if (subs.size === 0) {
		// last subscriber left before the debounce fired — nothing to serve
		closeHub();
		return;
	}
	const sameSet =
		liveIds !== null && desired.length === liveIds.length && desired.every((id) => liveIds!.includes(id));
	if (sameSet) return;
	openHub(desired);
}

function openHub(ids: string[]): void {
	const gen = generation;
	liveEs?.close();
	const params = new URLSearchParams();
	params.set('ids', JSON.stringify(ids));
	const resume = currentResume();
	if (Object.keys(resume).length > 0) params.set('resume', JSON.stringify(resume));
	const es = new EventSource('/api/terminal/stream?' + params.toString());
	liveEs = es;
	liveIds = ids;

	const dispatch = (kind: TerminalHubFrameKind, raw: string): void => {
		let data: TerminalHubFrameData;
		try {
			data = JSON.parse(raw) as TerminalHubFrameData;
		} catch {
			return; // a torn frame is dropped, never dispatched
		}
		const id = typeof data?.sessionId === 'string' ? data.sessionId : '';
		if (!id) return; // untagged frames have no owner — dropped (AC3)
		for (const sub of subs.values()) {
			if (sub.id !== id) continue;
			if (kind === 'output') {
				const next = Number(data.nextOffset);
				if (Number.isFinite(next)) {
					// row-side dedupe (karpathy 2.6, the re-open window): bytes
					// this row already painted are not painted twice — and a
					// successful output resets the hub ladder
					if (next <= sub.paintedOffset) continue;
					sub.paintedOffset = next;
				}
				reconnectDelayMs = HUB_RECONNECT_MIN_MS;
			}
			sub.handlers.onFrame(kind, data);
		}
	};

	for (const kind of ['output', 'settled', 'exit', 'closed', 'error'] as const) {
		es.addEventListener(kind, (e) => {
			const data = 'data' in e ? (e as MessageEvent).data : '';
			dispatch(kind, String(data));
		});
	}

	es.onerror = () => {
		es.close();
		if (liveEs === es) {
			liveEs = null;
			liveIds = null;
		}
		if (gen !== generation || reconnectTimer !== null) return;
		// ONE hub-level ladder (D4): re-open from the rows' painted offsets
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			if (gen !== generation || subs.size === 0) return;
			openHub(currentIds());
		}, reconnectDelayMs);
		reconnectDelayMs = Math.min(reconnectDelayMs * 2, HUB_RECONNECT_MAX_MS);
	};
}

/**
 * Subscribe one row to the hub. The FIRST subscriber opens THE
 * EventSource; a set change schedules a debounced re-open; the LAST
 * unsubscribe closes it. @returns the unsubscribe function.
 */
export function subscribeTerminalStream(id: string, fromByte: number, handlers: TerminalHubHandlers): () => void {
	const token = nextSubToken++;
	subs.set(token, { id, paintedOffset: Math.max(0, Math.floor(fromByte)), handlers });
	if (subs.size === 1) {
		openHub(currentIds());
	} else {
		// set change: one debounced re-open regardless of join/leave bursts
		if (resyncTimer === null) resyncTimer = setTimeout(resyncIfSetChanged, RESYNC_DEBOUNCE_MS);
	}
	return () => {
		subs.delete(token);
		if (subs.size === 0) {
			closeHub(); // BC-7: the hub never outlives its last subscriber
			return;
		}
		if (resyncTimer === null) resyncTimer = setTimeout(resyncIfSetChanged, RESYNC_DEBOUNCE_MS);
	};
}

/** Test-only: tear everything down (file isolation). */
export function resetStreamHubForTests(): void {
	closeHub();
	subs.clear();
	nextSubToken = 0;
}

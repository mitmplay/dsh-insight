/**
 * deliverables — the session's presented-file inventory (ADR-0027f, D1):
 * reduces RAW `deliverables/presented` ledger events into the list the
 * DeliverablesButton renders. Runs server-side ONLY (cold load + resync +
 * poll delta in the events lane) because the entries lane drops silent
 * events (dsh-events.ts filters mapper nulls — the fact that forces this
 * payload lane; ADR-0027f §2 fact 6).
 *
 * Wire contract (DSH packages/deliverables/tool-present/src/types.ts:15,
 * re-read 2026-10-19): `{ turn: number; callId: ToolCallId; files:
 * PresentedFile[] }`, one event per successful final present result
 * including nested calls (index.ts:105). Append-only within a session;
 * newest last. Junk parses to a skip, never a throw (the todo-lists rule).
 */

import type { DshRawEvent } from './events/content';

/** One presented file, wire-verbatim (DSH PresentedFile). */
export interface PresentedFile {
	/** Absolute or session-cwd-relative path — the ledger's truth. */
	path: string;
	/** Optional one-line description supplied by the model. */
	description?: string;
}

/** One deliverables/presented event, reduced. */
export interface PresentedDelivery {
	turn: number;
	callId: string;
	files: PresentedFile[];
}

/** True for the deliverables wire type (this module's one family). */
export function isDeliverablesEventType(type: string): boolean {
	return type === 'deliverables/presented';
}

/**
 * Reduce raw events → deliveries in ledger order (append-only, newest
 * last). Events of other types are skipped; a deliverables event with a
 * junk payload (missing/non-numeric turn, missing callId, missing or
 * non-array files, or any malformed file row) is skipped whole — never
 * partially kept, never thrown.
 */
export function deliverablesFromEvents(events: readonly DshRawEvent[]): PresentedDelivery[] {
	const out: PresentedDelivery[] = [];
	for (const event of events) {
		if (!isDeliverablesEventType(event.type)) continue;
		const delivery = parseDelivery(event.data);
		if (delivery !== undefined) out.push(delivery);
	}
	return out;
}

/** Validate one event payload; undefined on any junk. */
function parseDelivery(data: unknown): PresentedDelivery | undefined {
	if (data === null || typeof data !== 'object') return undefined;
	const raw = data as Record<string, unknown>;
	if (typeof raw.turn !== 'number' || !Number.isFinite(raw.turn)) return undefined;
	if (typeof raw.callId !== 'string' || raw.callId.length === 0) return undefined;
	if (!Array.isArray(raw.files) || raw.files.length === 0) return undefined;
	const files: PresentedFile[] = [];
	for (const file of raw.files) {
		if (file === null || typeof file !== 'object') return undefined;
		const f = file as Record<string, unknown>;
		if (typeof f.path !== 'string' || f.path.length === 0) return undefined;
		const parsed: PresentedFile = { path: f.path };
		if (typeof f.description === 'string' && f.description.length > 0) {
			parsed.description = f.description;
		}
		files.push(parsed);
	}
	return { turn: raw.turn, callId: raw.callId, files };
}

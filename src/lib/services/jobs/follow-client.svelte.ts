/**
 * follow-client — the BROWSER side of the job surface (ADR-0035 D2/D4; The
 * Job Bridge ADR-0081 D3 — the job ROW, the Tn-J tab species being retired):
 * the communication layer between the roster readout (JobRosterList) and
 * the desk. The desk registers an opener (and a clearer); roster rows emit
 * openJobTab / clearJobTab commands — the names are this bus's stable
 * contract (with a desk mounted, openJobTab attaches or selects the job's
 * row); per-job follows are EventSource subscriptions over the SSE route.
 * No cross-imports: both sides touch only this bus.
 */
import type { DsiJobFollowEvent } from '$lib/types';

export type JobTabOpener = (owner: string, jobId: string, label: string) => void;

let opener: JobTabOpener | null = null;
let clearer: ((owner: string, jobId: string) => void) | null = null;
let launcher: (() => void) | null = null;
/** Requests that arrived with no desk mounted — replayed on registration. */
const pending: Array<{ owner: string; jobId: string; label: string }> = [];

/**
 * The page registers the floor launch (doAdd terminal request). Without it,
 * a click with no desk mounted would stay a silent no-op (RCA 2026-10-21).
 */
export function registerJobTabLauncher(fn: () => void): () => void {
	launcher = fn;
	return () => {
		if (launcher === fn) launcher = null;
	};
}

/** The desk registers itself; pending clicks replay into it immediately. */
export function registerJobTabOpener(fn: JobTabOpener): () => void {
	opener = fn;
	const drain = pending.splice(0);
	for (const r of drain) fn(r.owner, r.jobId, r.label);
	return () => {
		if (opener === fn) opener = null;
	};
}

/** The desk registers how to close its job ROWS for one job (the function's
 *  name is this bus's stable contract — The Job Bridge 4.1). */
export function registerJobTabClearer(fn: (owner: string, jobId: string) => void): () => void {
	clearer = fn;
	return () => {
		if (clearer === fn) clearer = null;
	};
}

/**
 * Roster rows call this. No desk mounted? LAUNCH the terminal panel
 * (the surface is created, not assumed) and replay the request once the
 * fresh desk registers — never a silent no-op.
 */
export function openJobTab(owner: string, jobId: string, label: string): void {
	if (opener !== null) {
		opener(owner, jobId, label);
		return;
	}
	pending.push({ owner, jobId, label });
	launcher?.();
}

/** The roster row's clear button: close that job's terminal row(s) now. */
export function clearJobTab(owner: string, jobId: string): void {
	clearer?.(owner, jobId);
}

/**
 * One SSE follow per job row. Returns the closer (EventSource.close).
 * Frames arrive as JSON DsiJobFollowEvent data lines; parse failures are
 * dropped (never rendered as garbage).
 */
export function connectJobFollow(
	owner: string,
	jobId: string,
	onEvent: (event: DsiJobFollowEvent) => void
): () => void {
	const params = new URLSearchParams({ jobId });
	if (owner) params.set('sessionId', owner);
	const es = new EventSource('/api/dsh/jobs/follow?' + params.toString());
	es.onmessage = (m: MessageEvent<string>) => {
		let event: DsiJobFollowEvent;
		try {
			event = JSON.parse(m.data) as DsiJobFollowEvent;
		} catch {
			return; // malformed frame — drop
		}
		try {
			onEvent(event);
		} catch {
			// a consumer's throw never breaks the stream's own bookkeeping
		}
		// The host's follow stream ENDS at the job's status frame — and an
		// EventSource reconnects by itself when its stream ends. Without this
		// close every settled row re-opened its follow every few seconds for the
		// page's life: one reconnect loop per settled row, and under the browser's
		// six-connections-per-host limit those loops starve the page's other
		// requests (The Job Bridge live gate, 2026-11-25). The row keeps its
		// tail — nothing follows a settled job.
		if (event.type === 'status') es.close();
	};
	return () => es.close();
}

/** Test isolation only: clear the module-level bus state. */
export function __resetFollowClientForTests(): void {
	opener = null;
	clearer = null;
	launcher = null;
	pending.splice(0);
}

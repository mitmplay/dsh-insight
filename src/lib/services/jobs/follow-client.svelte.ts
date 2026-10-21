/**
 * follow-client — the BROWSER side of the Job Follower Tab (ADR-0035 D2/D4):
 * the communication layer between the roster readout (JobRosterList) and
 * the desk. The desk registers an opener (and a clearer); roster rows emit
 * openJobTab / clearJobTab commands; per-tab follows are EventSource
 * subscriptions over the SSE route. No cross-imports: both sides touch
 * only this bus.
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

/** The desk registers how to clear its -J tabs for one job. */
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

/** The roster row's clear button: close that job's -J tab(s) now. */
export function clearJobTab(owner: string, jobId: string): void {
	clearer?.(owner, jobId);
}

/**
 * One SSE follow per job tab. Returns the closer (EventSource.close).
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
		try {
			onEvent(JSON.parse(m.data) as DsiJobFollowEvent);
		} catch {
			// malformed frame — drop
		}
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

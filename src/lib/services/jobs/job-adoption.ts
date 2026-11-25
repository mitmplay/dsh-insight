/**
 * job-adoption — THE adoption rule of The Job Bridge (ADR-0081 D1/D2) as
 * ONE pure predicate both birth stages share: the roster PUSH (a frame
 * forwarded the instant the relay hears it) and the spine-tick SNAPSHOT
 * fallback. One rule, so the two stages can never disagree — and never
 * double-attach the same job (PRD 4.5). Push and snapshot MUST both go
 * through here (karpathy-context 3.2: one predicate).
 *
 * Pure by construction: no state, no I/O, no runes. The only runtime
 * import is the shared `isLiveJob` — never a re-implementation of it.
 *
 * A job is adoptable when ALL hold:
 *   1. autoAttach                 — the operator's consent (jobs.autoAttach)
 *   2. isLiveJob(job)              — 'running' | 'stopping'
 *   3. no attached row             — attachedKeys lacks jobKey(job)
 *   4. not dismissed this session  — dismissedKeys lacks jobKey(job).
 * Sticky on purpose: the snapshot REPLACES on every spine tick, so the
 * same running job re-arrives every refreshMs — a dismissed row must
 * stay closed or it resurrects within 5 s (trap 1, karpathy 3.10).
 */

import type { DsiJobView } from '$lib/types';
import { isLiveJob } from '$lib/services/jobs/roster-store.svelte';

/** Keys the desk already tracks: attached rows, and dismissed ones. */
export type JobKeySet = ReadonlySet<string>;

/**
 * One job's identity: `owner|id` — the follow relay's own refcount key
 * (JobFollowRelay.keyOf), so a row, its follow stream and its mirror
 * entry share one identity. An unowned job has no owner: its key is `|id`.
 */
export function jobKey(job: DsiJobView): string {
	return (job.owner ?? '') + '|' + job.id;
}

/**
 * The adoption rule. `attachedKeys` and `dismissedKeys` are the desk's own
 * record — the caller adds a key to `attachedKeys` once the row exists,
 * which is what makes a repeated roster frame inert.
 */
export function isAdoptable(
	job: DsiJobView,
	attachedKeys: JobKeySet,
	dismissedKeys: JobKeySet,
	autoAttach: boolean
): boolean {
	if (!autoAttach) return false;
	// A roster frame is wire data. An entry without an id has no identity
	// and cannot be followed (the follow route answers 400) — malformed,
	// never adoptable, whichever stage delivered it.
	if (typeof job?.id !== 'string' || job.id === '') return false;
	if (!isLiveJob(job)) return false;
	const key = jobKey(job);
	if (attachedKeys.has(key)) return false;
	if (dismissedKeys.has(key)) return false;
	return true;
}

/**
 * Filter one roster frame down to the jobs to attach NOW — in frame
 * order, each key at most once even if the frame repeats it.
 */
export function selectAdoptable(
	jobs: readonly DsiJobView[],
	attachedKeys: JobKeySet,
	dismissedKeys: JobKeySet,
	autoAttach: boolean
): DsiJobView[] {
	const out: DsiJobView[] = [];
	const seen = new Set<string>();
	for (const job of jobs) {
		if (!isAdoptable(job, attachedKeys, dismissedKeys, autoAttach)) continue;
		const key = jobKey(job);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(job);
	}
	return out;
}

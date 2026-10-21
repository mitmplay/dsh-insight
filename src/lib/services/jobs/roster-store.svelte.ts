/**
 * roster-store — the per-session job roster (Job Badge Wave 1, ADR-0026
 * D2/D3). ONE shared truth for the sidebar badge and the conversation
 * JobsButton, so the dot and the popup never disagree.
 *
 * Reference-counted (host parity — job-controller client service.ts
 * acquire/releaser): the first watch of a session seeds the set and loads
 * once, the last unwatch drops it. A refresh is a /api/dsh/jobs snapshot
 * (the server-side Roster Mirror cache — ADR 2026-10-17, the stream's
 * last frame) — the WHOLE visible set (own jobs + unowned) — so a frame
 * REPLACES, never merges (host JobListFrame contract). Settlement may be
 * late or absent (ADR fact 10): the store renders the registry's last
 * word and NEVER synthesizes a finish time.
 *
 * CADENCE (BC-7, Roster Mirror wave): this store owns NO client timer —
 * the page owns the spine cadence. The spine tick (spine-feed.loadOnce)
 * calls refreshWatched(), so the roster rides the ONE page-owned interval
 * instead of a component-triggered setInterval; watch() only fires the
 * immediate first load so a badge is never born blind.
 *
 * REACTIVITY CONTRACT (Wave 3 virgin-session fix, 2026-10-16): every jobs()
 * read subscribes to ONE module-level version signal, born at module init
 * outside every reaction; the roster data itself lives in a PLAIN
 * (non-reactive) Map. Rationale, from the virgin-mount RCA: Svelte 5's
 * object/Map proxies do not register a dependency when the read key does
 * not exist yet — so the FIRST watcher of a session (a sidebar row whose
 * badge derived runs before its watcher mounts any data) subscribed to
 * nothing and stayed blind to its first fill forever. Per-entry class
 * fields, reactive Maps of instances, and object-of-arrays all hit the
 * same hole in different guises. A version counter has no key lifetime to
 * race: the signal exists before any session is watched, every mutation
 * bumps it, every reader re-runs. The consumer set is a handful of badges
 * and buttons — coarse granularity is the cheapest correct option.
 * Watch refcounts stay in a plain Map — effects of watching, not render
 * state.
 */

import type { DsiJobView } from '$lib/types';

/** A job the operator can still stop — what lights a badge. */
export function isLiveJob(job: DsiJobView): boolean {
	return job.status === 'running' || job.status === 'stopping';
}

/**
 * The eternal signal — bumped on EVERY roster mutation. Born at module
 * init, outside every reaction, so a reader can always subscribe to it no
 * matter how early it reads. Read (never written) by jobs().
 */
let version = $state(0);

/** The roster data — deliberately NON-reactive; version carries the news. */
const jobsBySession = new Map<string, DsiJobView[]>();

/** Watch bookkeeping — refcount only (the cadence is the page's). */
interface RosterWatch {
	refs: number;
}
/** Watch refcounts — bookkeeping only, never render state. */
const watches = new Map<string, RosterWatch>();

/** Chunk size for the batch tick (ADR-0032 D3 — the URL-length guard). */
const JOBS_BATCH_CHUNK = 50;

/** The singleton surface every consumer imports (Wave 1 API, preserved). */
class JobsRosterStore {
	/** Begin watching a session (idempotent per extra watcher). */
	watch(sessionId: string): void {
		if (!sessionId) return;
		let w = watches.get(sessionId);
		if (w === undefined) {
			w = { refs: 0 };
			watches.set(sessionId, w);
			jobsBySession.set(sessionId, []);
			// No version bump here: the seed is EMPTY data — nothing mounted
			// needs to re-render for it, and watch() runs inside effects,
			// where a version write would loop the update depth.
		}
		w.refs += 1;
		if (w.refs > 1) return;
		// Immediate first load only — NO client timer (BC-7): the page's
		// spine tick drives every later refresh via refreshWatched().
		void this.refresh(sessionId);
	}

	/** Release one watch — the mount point's destroy handler MUST call it. */
	unwatch(sessionId: string): void {
		const w = watches.get(sessionId);
		if (w === undefined) return;
		w.refs = Math.max(0, w.refs - 1);
		if (w.refs > 0) return;
		watches.delete(sessionId);
		jobsBySession.delete(sessionId);
		// No version bump: this runs in a destroy cleanup; the consumer
		// going away is the only reader that cared, and any surviving
		// reader implies refs > 0 — i.e. no delete happened.
	}

	/**
	 * The session's whole visible set. Reads the version signal FIRST so
	 * even a not-yet-watched session's empty result is a tracked read.
	 */
	jobs(sessionId: string): DsiJobView[] {
		void version;
		return sessionId ? (jobsBySession.get(sessionId) ?? []) : [];
	}

	/** Live (running/stopping) count — the badge's number. */
	liveCount(sessionId: string): number {
		return this.jobs(sessionId).filter(isLiveJob).length;
	}

	/**
	 * One snapshot fetch; a failure keeps the last known set (no flicker).
	 * A pending frame (Roster Mirror ADR 2026-10-17 D3 — the stream is open
	 * but no frame has arrived) is honest darkness, NOT an empty set: it
	 * must not clobber the last known jobs.
	 */
	async refresh(sessionId: string): Promise<void> {
		try {
			const res = await fetch(`/api/dsh/jobs?sessionId=${encodeURIComponent(sessionId)}`);
			if (!res.ok) return;
			const body = (await res.json()) as { ok?: boolean; jobs?: DsiJobView[]; pending?: boolean };
			if (body.ok && body.pending === true) return;
			if (body.ok && Array.isArray(body.jobs)) {
				jobsBySession.set(sessionId, body.jobs);
				version += 1;
			}
		} catch {
			// network hiccup — the next spine tick retries; never blank on error
		}
	}

	/**
	 * Refresh EVERY watched session — the spine tick's piggyback hook
	 * (BC-7: the cadence belongs to the page's ONE interval, never to a
	 * component timer). Unwatched sessions refresh nowhere.
	 *
	 * ADR-0032 D3 — ONE batch fetch per chunk of ≤50 watched ids
	 * (`/api/dsh/jobs?sessionIds=…`), not one request per session: the
	 * tick's request count scales with chunks, not watchers. Each applied
	 * roster follows the same rules as refresh() — a pending frame is
	 * honest darkness and must not clobber the last known jobs — and the
	 * version signal bumps at most ONCE per chunk.
	 */
	refreshWatched(): void {
		const ids = [...watches.keys()];
		for (let i = 0; i < ids.length; i += JOBS_BATCH_CHUNK) {
			void this.refreshBatch(ids.slice(i, i + JOBS_BATCH_CHUNK));
		}
	}

	/** One batched snapshot fetch for a chunk of watched sessions. */
	private async refreshBatch(ids: string[]): Promise<void> {
		try {
			const res = await fetch(`/api/dsh/jobs?sessionIds=${ids.map(encodeURIComponent).join(',')}`);
			if (!res.ok) return;
			const body = (await res.json()) as {
				ok?: boolean;
				rosters?: Record<string, { jobs?: DsiJobView[]; pending?: boolean }>;
			};
			if (!body.ok || !body.rosters) return;
			let changed = false;
			for (const sessionId of ids) {
				if (!watches.has(sessionId)) continue; // unwatched mid-flight: drop the frame
				const roster = body.rosters[sessionId];
				if (!roster || roster.pending === true || !Array.isArray(roster.jobs)) continue;
				jobsBySession.set(sessionId, roster.jobs);
				changed = true;
			}
			if (changed) version += 1; // ONE bump per chunk, not per session
		} catch {
			// network hiccup — the next spine tick retries; never blank on error
		}
	}
	/**
	 * ADR-0034 D2 — arm a batch of ids WITHOUT the per-id singular first
	 * load: the heartbeat scope is the sole watcher for these, and it
	 * batch-fetches them itself. Refs arm at 1 (scope ownership); a later
	 * badge-side watch() is a free extra ref.
	 */
	armMany(ids: string[]): void {
		const fresh = ids.filter((id) => id && !watches.has(id));
		for (const id of fresh) {
			watches.set(id, { refs: 1 });
			jobsBySession.set(id, []);
		}
		if (fresh.length > 0) void this.refreshBatch(fresh);
	}
}

export const jobsRoster = new JobsRosterStore();

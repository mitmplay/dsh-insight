/**
 * jobs/follow-relay — the server-side job follower (ADR-0035 D4): ONE
 * refcounted host job.follow logical stream per (owner, jobId), fanned out
 * to every browser subscriber (SSE sinks). The last unsubscriber closes the
 * host stream — the same unwatch discipline the roster mirror accepted.
 *
 * The host transport is INJECTED (open/close + frames via onFrame/onError)
 * so unit tests drive it without a DSH connection.
 */
import type { DsiJobFollowEvent } from '$lib/types';

export type FollowSink = (event: DsiJobFollowEvent) => void;

export interface FollowTransport {
	/** Ensure the host job.follow logical stream for this key. */
	open(owner: string, jobId: string): void;
	/** Drop the host stream for this key (last-unwatch). */
	close(owner: string, jobId: string): void;
}

interface FollowEntry {
	sinks: Set<FollowSink>;
}

export class JobFollowRelay {
	private entries = new Map<string, FollowEntry>();

	constructor(private readonly transport: FollowTransport) {}

	static keyOf(owner: string, jobId: string): string {
		return owner + '|' + jobId;
	}

	/** Subscribe one browser sink; opens the host stream on first ref. */
	subscribe(owner: string, jobId: string, sink: FollowSink): () => void {
		const key = JobFollowRelay.keyOf(owner, jobId);
		let entry = this.entries.get(key);
		if (entry === undefined) {
			entry = { sinks: new Set() };
			this.entries.set(key, entry);
			this.transport.open(owner, jobId);
		}
		entry.sinks.add(sink);
		return () => {
			const e = this.entries.get(key);
			if (e === undefined) return;
			e.sinks.delete(sink);
			if (e.sinks.size === 0) {
				this.entries.delete(key);
				this.transport.close(owner, jobId);
			}
		};
	}

	/** Owners with at least one live follow (mux generation reopen). */
	owners(): string[] {
		const set = new Set<string>();
		for (const key of this.entries.keys()) set.add(key.slice(0, key.indexOf('|')));
		return [...set];
	}

	/** Job ids one owner follows live (mux generation reopen). */
	jobsOf(owner: string): string[] {
		const prefix = owner + '|';
		return [...this.entries.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
	}

	/** One host stream item (opened | output | status) to every sink. */
	onFrame(owner: string, jobId: string, value: unknown): void {
		const entry = this.entries.get(JobFollowRelay.keyOf(owner, jobId));
		if (entry === undefined) return;
		const event = normalizeFrame(value);
		if (event !== null) for (const sink of entry.sinks) sink(event);
	}

	/** Host stream error to every sink (the tab shows an honest error). */
	onError(owner: string, jobId: string, code?: string, message?: string): void {
		const entry = this.entries.get(JobFollowRelay.keyOf(owner, jobId));
		if (entry === undefined) return;
		const event: DsiJobFollowEvent = { type: 'error', code, message };
		for (const sink of entry.sinks) sink(event);
	}
}

/** Coerce one raw host frame into a DsiJobFollowEvent (never trust wire). */
export function normalizeFrame(value: unknown): DsiJobFollowEvent | null {
	if (value === null || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const type = v.type;
	if (type === 'opened' || type === 'status') {
		if (v.job !== null && typeof v.job === 'object') {
			return { type, job: v.job, from: typeof v.from === 'number' ? v.from : 0 } as DsiJobFollowEvent;
		}
		return null;
	}
	if (type === 'output') {
		const text = decodeChunks(v.chunks);
		return { type: 'output', text, next: typeof v.next === 'number' ? v.next : 0, ...(v.lossy === true ? { lossy: true as const } : {}) };
	}
	return null;
}

/** Decode the host's JobChunk[] into one text blob (best-effort). */
function decodeChunks(chunks: unknown): string {
	if (!Array.isArray(chunks)) return '';
	let out = '';
	for (const chunk of chunks) {
		if (typeof chunk === 'string') out += chunk;
		else if (chunk && typeof chunk === 'object') {
			const c = chunk as Record<string, unknown>;
			if (typeof c.text === 'string') out += c.text;
			else if (typeof c.data === 'string') out += c.data;
		}
	}
	return out;
}

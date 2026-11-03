/**
 * attachment-urls (task 3.3) — the per-session object-URL cache for durable
 * image reads. The echo renders ledger REFS; bytes are fetched once through
 * the authorized proxy (BC-1/BC-A5) and held as browser object URLs until
 * the panel that showed them closes.
 *
 * In-flight dedupe: concurrent resolves of one attachment share a single
 * fetch. Generation invalidation (BC-A9): invalidateSession revokes every
 * URL the session owns and bumps its generation; a load still in flight
 * from the dead generation never publishes — its freshly minted URL is
 * revoked and the promise rejects, so no leaked blob and no zombie render.
 *
 * Rune module (module-scoped state, the app-config singleton pattern): one
 * cache for the app; sessions are the isolation unit.
 */
import { base64ToBytes } from '$lib/utils/base64';
import type { DsiImageRef } from '$lib/types';

interface CacheEntry {
	url: string;
	generation: number;
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();
const generations = new Map<string, number>();
const ownedUrls = new Set<string>();

const SEAM = String.fromCharCode(0); // key seam: ids may contain anything else

function keyOf(sessionId: string, attachmentId: string): string {
	return sessionId + SEAM + attachmentId;
}

function revoke(url: string): void {
	if (!ownedUrls.delete(url)) return;
	URL.revokeObjectURL(url);
}

/**
 * Resolve one attachment to a browser URL, fetching through the authorized
 * proxy on cache miss.
 *
 * 0.2.2 contract (2026-10-29 release jump): the host verifies the SUPPLIED
 * full ref, so the whole DsiImageRef travels (id-only reads reject
 * gateway/input-invalid). Cache key stays the content-addressed id.
 *
 * @param sessionId - owning session (authorization scope, cache bucket).
 * @param ref - the full image reference from the ledger fold (DsiImageRef).
 * @returns object URL valid until its session is invalidated.
 */
export function resolveAttachmentUrl(sessionId: string, ref: DsiImageRef): Promise<string> {
	const key = keyOf(sessionId, ref.attachmentId);
	const cached = entries.get(key);
	if (cached !== undefined && cached.generation === generations.get(sessionId)) {
		return Promise.resolve(cached.url);
	}
	const pending = inFlight.get(key);
	if (pending !== undefined) return pending;
	const generation = generations.get(sessionId) ?? 0;
	const load = (async () => {
		const res = await fetch(
			'/api/dsh/session/' +
				encodeURIComponent(sessionId) +
				'/attachment?ref=' +
				encodeURIComponent(JSON.stringify(ref))
		);
		const body = (await res.json().catch(() => null)) as
			| { ok: true; attachment: { mediaType: string }; data: string }
			| { ok: false; error: { message?: string } }
			| null;
		if (!res.ok || body === null || body.ok !== true) {
			throw new Error(
				body?.ok === false ? (body.error.message ?? 'attachment read failed (' + res.status + ')') : 'attachment read failed (' + res.status + ')'
			);
		}
		const url = URL.createObjectURL(
			new Blob([base64ToBytes(body.data)] as BlobPart[], { type: body.attachment.mediaType })
		);
		ownedUrls.add(url);
		if ((generations.get(sessionId) ?? 0) !== generation) {
			// The session was invalidated while loading: the URL belongs to a
			// dead generation — revoke immediately and fail the caller.
			revoke(url);
			throw new Error('attachment scope was released before loading completed');
		}
		entries.set(key, { url, generation });
		return url;
	})();
	inFlight.set(key, load);
	load.catch(() => {}).finally(() => inFlight.delete(key));
	return load;
}

/**
 * Invalidate every cached URL one session owns (its panel closed — BC-A9).
 * Revokes all owned URLs and bumps the generation so in-flight loads from
 * the dead generation never publish.
 */
export function invalidateSessionAttachmentUrls(sessionId: string): void {
	const prefix = sessionId + SEAM;
	generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
	for (const [key, entry] of entries) {
		if (!key.startsWith(prefix)) continue;
		revoke(entry.url);
		entries.delete(key);
	}
}

/**
 * fork-session — the shared fork spine (The Fork-Here Button ADR,
 * 2026-09-02). One POST to /api/dsh/session/[sessionId]/fork, the host's
 * refusal surfaced verbatim, the child renamed best-effort " (fork)" through
 * the existing rename route, and the child placed AFTER ITS SOURCE on the
 * panel floor (off-floor: the seed-navigation fallback). The header
 * ForkButton (atSeq omitted — the host cuts at the last completed turn) and
 * the turn-level ForkHereButton (atSeq present — the clicked turn's anchor)
 * are thin shells over this spine; each owns its own busy lock and failure
 * display.
 *
 * Self-contained like the shells it serves: it speaks to /api/dsh/* only
 * (BC-2 — never a server-module import) and reports nothing upward beyond
 * the returned outcome.
 */
import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
import { conversationSeedUrl } from '$lib/utils/seed-url';
import { getWorkspaceState } from './workspace-context.svelte';

export type ForkRequest = {
	/** The source session — the fork's cut source. */
	sessionId: string;
	/** Wire anchor — the first entry seq of the turn to cut at. Omitted =
	 *  the host's default: the source's LAST COMPLETED TURN (the header
	 *  button's always-safe cut). A present anchor inside an open turn is
	 *  a host refusal, never a silent clip. */
	atSeq?: number;
	/** Live source title — seeds the child's best-effort " (fork)" rename;
	 *  null/blank skips the rename (nothing to disambiguate). */
	title?: string | null;
	/** Raw preset id carried onto the opened child panel's chip (the host
	 *  composes the child's real preset from the source). */
	agentPreset?: string | null;
};

/** The fork's end state: the child id, or the verbatim failure text the
 *  shell displays (host refusal message, HTTP status, or transport error). */
export type ForkOutcome = { ok: true; childId: string } | { ok: false; message: string };

async function renameChild(childId: string, title: string | null | undefined): Promise<void> {
	const base = title?.trim();
	if (!base) return;
	try {
		await fetch(`/api/dsh/session/${encodeURIComponent(childId)}/rename`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: `${base} (fork)` })
		});
	} catch {
		// Best-effort only: a failed rename leaves parent and child with
		// identical titles — lineage, not the title, is the identity.
	}
}

/** Fork `request.sessionId` and open the child below its source. Resolves
 *  to the outcome instead of throwing — the shells render `message` as-is.
 *  @param request - source session, optional wire anchor, rename seed, chip preset.
 *  @returns the child id on success, or the verbatim failure message. */
export async function forkFromSession(request: ForkRequest): Promise<ForkOutcome> {
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(request.sessionId)}/fork`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(request.atSeq === undefined ? {} : { atSeq: request.atSeq })
		});
		const data = (await res.json().catch(() => null)) as
			| { ok: true; sessionId: string }
			| { ok: false; error?: { message?: string } }
			| null;
		if (!res.ok || data === null || !data.ok) {
			const message =
				data && !data.ok ? (data.error?.message ?? 'fork failed') : `fork failed (HTTP ${res.status})`;
			return { ok: false, message };
		}
		const childId = data.sessionId;
		await renameChild(childId, request.title);
		const added = addPanelFromSidebar({
			sessionId: childId,
			agentPreset: request.agentPreset ?? null,
			focus: true,
			afterSessionId: request.sessionId
		});
		if (!added) {
			// Off-floor fallback — the pre-floor behavior (SidebarSessions parity).
			window.location.assign(conversationSeedUrl(childId, getWorkspaceState()?.profile ?? null));
		}
		return { ok: true, childId };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}

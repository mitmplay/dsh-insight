/**
 * glass-release — the Glass Close Ladder executor (ADR 2026-10-24 D1/D3):
 * the ONE wire-kill caller. The registry stays the only teardown authority;
 * this module merely knocks on its door — fire-and-forget POST close per
 * doomed glass id, an ok answer pruning the slot entry LIVE (D4). A network
 * failure swallows (the reaper stays the net); a refusal never prunes.
 * Pure seam shape: fetch and the prune are injectable for tests.
 */
import { removeBrowserSlot } from "./browser-session-resolver.js";

export interface ReleaseDeps {
	fetchImpl?: typeof fetch;
	/** Slot prune (D4). Defaults to removeBrowserSlot on localStorage. */
	prune?: (sessionId: string) => void;
	/** The wire root (e2e same-origin default). */
	apiBase?: string;
}

export async function releaseGlasses(sessionIds: readonly string[], deps: ReleaseDeps = {}): Promise<void> {
	if (sessionIds.length === 0) return;
	const doFetch = deps.fetchImpl ?? fetch;
	const apiBase = deps.apiBase ?? "";
	await Promise.all(
		sessionIds.map(async (id) => {
			try {
				const res = await doFetch(apiBase + "/api/browser/" + id + "/close", { method: "POST" });
				if (!res.ok) return; // refusal — never prune
				void (deps.prune ?? ((sid: string) => removeBrowserSlot(sid)))(id);
			} catch {
				// network down — the reaper stays the net; no prune
			}
		})
	);
}
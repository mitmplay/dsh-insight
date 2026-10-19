/**
 * polling-orchestrator — adaptive poll loop for one conversation (BC-7).
 *
 * 500ms while the session is running, 2000ms while idle — no other intervals.
 * Single active client per page (W3 scope): one orchestrator, one store.
 *
 * submit() follows BC-3: it POSTs the prompt, awaits ONLY the receipt, adds
 * the optimistic user bubble, flips to fast cadence, and returns. The answer
 * arrives as poll deltas, never as the POST's response body.
 */

import type { DsiEntry, PendingAnswer, AnsweredSettlement } from '$lib/types';
import { DEFAULT_POLL_IDLE_MS, DEFAULT_POLL_RUNNING_MS } from '$lib/config';
import { appConfig } from '$lib/services/config/app-config.svelte';
import type { DshRawEvent } from './dsh-events';
import type { DsiPermission } from './permission-state';
import type { ConversationStore } from './store.svelte';

/** BC-7 cadence defaults (ms) — config-overridable via
 *  ~/.dsi/settings.yaml `conversation.pollRunningMs` / `pollIdleMs`. */
export const POLL_RUNNING_MS = DEFAULT_POLL_RUNNING_MS;
export const POLL_IDLE_MS = DEFAULT_POLL_IDLE_MS;

export interface PollResult {
	entries: DsiEntry[];
	lastSeq: number;
	running: boolean;
}

export interface OrchestratorDeps {
	/** Transport used by tests; production binds to global fetch. */
	fetchFn?: typeof fetch;
	/** Cadence overrides for tests (config values are the production
	 *  defaults — read once per orchestrator, at creation). */
	runningMs?: number;
	idleMs?: number;
	/** setTimeout/clearTimeout injection for fake-clock tests. */
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (t: unknown) => void;
}

export function createPollingOrchestrator(store: ConversationStore, deps: OrchestratorDeps = {}) {
	const fetchFn = deps.fetchFn ?? fetch;
	const runningMs = deps.runningMs ?? appConfig().conversation.pollRunningMs;
	const idleMs = deps.idleMs ?? appConfig().conversation.pollIdleMs;
	const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
	const clearTimer = deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));

	let timer: unknown;
	let stopped = true;

	/** One poll cycle: GET events since lastSeq → store.applyPoll. */
	async function poll(): Promise<void> {
		try {
			// POC-3 W2: ack consumed settlements (ring prune, delivered-then-pruned)
			// alongside the delta request.
			const acked = store.ackedAnswerIds();
			const url =
				`/api/dsh/session/${encodeURIComponent(store.sessionId)}/events?since=${store.lastSeq}` +
				(acked.length > 0 ? `&acked=${encodeURIComponent(acked.join(','))}` : '');
			const res = await fetchFn(url);
			if (!res.ok) {
				store.setError(`poll failed (${res.status})`);
			} else {
				const body = (await res.json()) as {
					ok: boolean;
					entries: DsiEntry[];
					lastSeq: number;
					running: boolean;
					gap?: boolean;
					pendingAnswers?: PendingAnswer[];
					settledAnswers?: AnsweredSettlement[];
					knobEvents?: DshRawEvent[];
					permission?: import('$lib/services/conversation/permission-state').DsiPermission | null;
					imageLimits?: import('$lib/services/conversation/image-limits').DsiImageLimits | null;
					todos?: import('$lib/utils/todo-lists').TodoItem[] | null;
					plan?: import('$lib/services/conversation/plan-projection').DsiPlanProjection | null;
					goal?: import('$lib/utils/goals').GoalResultGoal | null;
					ledgerStats?: import('$lib/types').DsiLedgerStats | null;
					deliverables?: import('$lib/services/conversation/deliverables').PresentedDelivery[];
					liveStream?: import('$lib/types').DsiLiveStreamTail | null;
				};
				if (!body.ok) {
					store.setError('poll returned an error');
				} else if (body.gap) {
					// Wave 4.2: the server's buffer lost events below our mark —
					// re-read the ledger (BC-4: ledger truth, stream freshness).
					await resync();
				} else {
					store.applyPoll(body);
				}
			}
		} catch (err) {
			store.setError(err instanceof Error ? err.message : String(err));
		}
		schedule();
	}

	/** Next-tick scheduling per BC-7: fast while running, slow while idle. */
	function schedule(): void {
		if (stopped) return;
		clearTimer(timer);
		const delay = store.running ? runningMs : idleMs;
		timer = setTimer(poll, delay);
	}

	/** Start polling (immediate first poll establishes status fast). */
	async function start(): Promise<void> {
		if (!stopped) return;
		stopped = false;
		await poll();
	}

	/** Stop the loop and clear timers (idempotent). */
	function stop(): void {
		stopped = true;
		clearTimer(timer);
		timer = undefined;
	}

	/**
	 * Wave 4.2 — full ledger re-read (gap detected or manual). The events
	 * endpoint with since=-1&full=1 asks the server for the ledger tail page
	 * instead of the ring-buffer delta; the store replaces from it.
	 */
	async function resync(): Promise<void> {
		try {
			const url = `/api/dsh/session/${encodeURIComponent(store.sessionId)}/events?since=-1&full=1`;
			const res = await fetchFn(url);
			if (!res.ok) {
				store.setError(`resync failed (${res.status})`);
				return;
			}
			const body = (await res.json()) as {
				ok: boolean;
				entries: DsiEntry[];
				lastSeq: number;
				running: boolean;
				pendingAnswers?: PendingAnswer[];
				settledAnswers?: AnsweredSettlement[];
				permission?: DsiPermission | null;
				imageLimits?: import('$lib/services/conversation/image-limits').DsiImageLimits | null;
				todos?: import('$lib/utils/todo-lists').TodoItem[] | null;
				plan?: import('$lib/services/conversation/plan-projection').DsiPlanProjection | null;
				goal?: import('$lib/utils/goals').GoalResultGoal | null;
				ledgerStats?: import('$lib/types').DsiLedgerStats | null;
				deliverables?: import('$lib/services/conversation/deliverables').PresentedDelivery[];
				knobEvents?: DshRawEvent[];
				liveStream?: import('$lib/types').DsiLiveStreamTail | null;
			};
			if (body.ok) {
				store.resyncFromLedgerEntries(
					body.entries,
					body.lastSeq,
					body.running,
					{
						permission: body.permission ?? null,
						knobEvents: body.knobEvents ?? []
					},
					// BC-E: answerer state rides the resync payload like every
					// poll — a gap-resync page must still render its cards.
					{ pendingAnswers: body.pendingAnswers, settledAnswers: body.settledAnswers },
					// ADR-0027f D1: the ledger tail's whole inventory replaces.
					body.deliverables ?? []
				);
				// 0.1.3-alpha.1: the resync replaced the whole list — re-fold
				// the in-flight attempt's live tail (null clears a stale id).
				store.applyLiveStream(body.liveStream);
				// 0.1.2: the ledger page carries no projections block — the live
				// imageLimits seed rides the same resync payload (null clears).
				store.seedImageLimits(body.imageLimits ?? null);
				// The todos projection rides the same resync payload; null
				// clears (the host says no current plan).
				store.seedTodos(body.todos ?? null);
				store.seedPlanMode(body.plan ?? null);
				// The goal projection rides the same resync payload; null
				// clears (the host says no current goal).
				store.seedGoal(body.goal ?? null);
				// The whole-log ledger stats ride the same resync payload; null
				// clears (no host pair — the panel degrades to its partial fold).
				store.seedLedgerStats(body.ledgerStats ?? null);
			} else {
				store.setError('resync returned an error');
			}
		} catch (err) {
			store.setError(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * BC-3: POST prompt → receipt only. Optimistic bubble, flip to fast
	 * cadence, return true on accepted. Rejection (agent-busy etc.) surfaces
	 * via the store's error banner and returns false — never a thrown answer.
	 *
	 * Wave 2 (task 2.4): serialized images ride the POST body ({text, images});
	 * a text-only submit keeps the byte-identical {text} body. The optimistic
	 * bubble is keyed by its returned local id (R-3) so a rejected send drops
	 * exactly its own bubble — attachments-only sends share text ''.
	 */
	async function submit(
		text: string,
		images: readonly { mediaType: string; data: string; name?: string }[] = []
	): Promise<boolean> {
		store.setError(null);
		const optimisticId = store.addOptimisticUserEntry(text, images.length);
		const body = images.length > 0 ? { text, images } : { text };
		try {
			const res = await fetchFn(`/api/dsh/session/${encodeURIComponent(store.sessionId)}/prompt`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const failure = (await res.json().catch(() => null)) as {
					error?: { code?: string; message?: string; details?: { reason?: string } };
				} | null;
				// Wire code + details.reason ride along (2026-08-26): the panel
				// routes attachment refusals to the composer note; everything
				// else keeps the transcript-top banner.
				const err = failure?.error;
				const reason = typeof err?.details?.reason === 'string' ? err.details.reason : undefined;
				store.setError(err?.message ?? `prompt rejected (${res.status})`, err?.code, reason);
				store.dropOptimistic(optimisticId); // rejected — the bubble was never accepted
				return false;
			}
			store.dedupeOptimistic(); // receipt ok: the ledger's copy arrives via poll
			schedule(); // refresh cadence immediately
			return true;
		} catch (err) {
			store.setError(err instanceof Error ? err.message : String(err));
			store.dropOptimistic(optimisticId);
			return false;
		}
	}

	/** POST cancel — one POST away from stopping the turn (PRD §3.4). */
	async function cancel(): Promise<boolean> {
		try {
			const res = await fetchFn(`/api/dsh/session/${encodeURIComponent(store.sessionId)}/cancel`, {
				method: 'POST'
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	/**
	 * POC-3 W2 (task 2.3) — answer a pending approval/question.
	 *
	 * The per-rpcId in-flight lock lives in the store (double-submit guard);
	 * this wrapper owns the POST. Receipt semantics (BC-B): accepted:false is
	 * a SUCCESSFUL exchange — the store settles the card answered-elsewhere
	 * (not-pending: another claimant won) and surfaces bad-response honestly.
	 * Transport failure (HTTP error / throw) → the store releases the lock so
	 * the card stays answerable (the host replays the pending frame — spec
	 * 20's recovery).
	 */
	async function respond(rpcId: string, payload: Record<string, unknown>): Promise<{ ok: boolean; accepted?: boolean; reason?: string }> {
		if (!store.lockAnswer(rpcId)) return { ok: false, reason: 'in-flight' };
		try {
			const res = await fetchFn(`/api/dsh/session/${encodeURIComponent(store.sessionId)}/respond`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rpcId, payload })
			});
			if (!res.ok) {
				// Transport failure: card stays answerable — release the lock.
				// The route carries the host's message in the error body (e.g.
				// a stale $events generation); surfacing it is the difference
				// between "Answer did nothing" and an actionable failure.
				const failure = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
				store.releaseAnswer(rpcId);
				return { ok: false, reason: failure?.error?.message ?? `respond failed (${res.status})` };
			}
			const body = (await res.json()) as { ok: boolean; accepted?: boolean; reason?: string };
			if (!body.ok) {
				store.releaseAnswer(rpcId);
				return { ok: false, reason: body.reason ?? 'respond returned an error' };
			}
			if (body.accepted === false) {
				// Refused ≠ error (BC-B): not-pending → answered elsewhere;
				// bad-response → validation refusal. Both settle without a re-ask.
				store.markAnswerElsewhere(rpcId, body.reason);
				return { ok: true, accepted: false, reason: body.reason };
			}
			// accepted:true — OUR answer won the first-claimant race (the receipt
			// is the host's word). Settle optimistically WITH the outcome we sent
			// (the resolved broadcast may be missed entirely — answered while the
			// mux was down; e2e spec 20 pinned the stuck-in-flight bug, spec 16/17
			// pin the outcome label). The poll settlement stays the confirming
			// path and cannot double-settle (idempotent phases).
			store.markAnswerAccepted(rpcId, answerOutcome(payload));
			return { ok: true, accepted: true };
		} catch (err) {
			store.releaseAnswer(rpcId);
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	return { start, stop, poll, resync, submit, cancel, respond, get running() { return store.running; } };
}

/** The outcome WE sent, for the optimistic settle label (spec 16/17): an
 * approval names its own outcome arm; a question batch answers 'answered'. */
function answerOutcome(payload: Record<string, unknown>): string | undefined {
	if (typeof payload.outcome === 'string' && payload.outcome.length > 0) return payload.outcome;
	if (payload.answer !== undefined) return 'answered';
	return undefined;
}

export type PollingOrchestrator = ReturnType<typeof createPollingOrchestrator>;

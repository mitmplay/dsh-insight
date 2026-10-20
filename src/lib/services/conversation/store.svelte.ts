/**
 * conversation store — client-side conversation state (Svelte 5 runes).
 *
 * Owns the DsiEntry render list + streaming truth; merges poll deltas and
 * cold-load ledger data through the same dsh-events merge rules, applies
 * host-status flips, and holds the optimistic user bubble from submit until
 * the real user/message event arrives to replace it (dedupe by text identity
 * — the wire carries no client correlation id in v1).
 *
 * The store never performs I/O; the polling orchestrator feeds it. No server
 * imports (BC-2), no :3080 anywhere (BC-1).
 */

import type { DsiEntry, DsiLedgerStats, DsiLiveStreamTail, PendingAnswer, AnsweredSettlement } from '$lib/types';
import { collapseSystemPromptEntries, mergeEntries } from './dsh-events';
import type { DshRawEvent } from './dsh-events';
import type { DsiImageLimits } from './image-limits';
import type { TodoItem } from '$lib/utils/todo-lists';
import type { DsiPlanProjection } from './plan-projection';
import type { GoalResultGoal } from '$lib/utils/goals';
import type { PresentedDelivery } from './deliverables';
import {
	EMPTY_KNOBS,
	applyKnobEvent,
	localPermission,
	resolvePermission,
	type DsiPermission,
	type DsiPresetOption,
	type KnobState
} from './permission-state';

/** An optimistic user bubble: durable user-message shape + local marker.
 *  R-3: imageCount records an image-carrying submit (dedupe matching stays
 *  text-only until Wave 3's mapper makes durable twins image-aware). */
export type OptimisticEntry = Extract<DsiEntry, { kind: 'user-message' }> & {
	local: true;
	imageCount?: number;
};

/**
 * The last submit's rejection. Attachment refusals (code
 * 'attachment-error', the host's admission) render at the COMPOSER — the
 * drafts they rejected are still attached there (BC-A3); every other
 * failure renders above the transcript.
 */
export interface UiError {
	message: string;
	/** Host RPC error code when the rejection crossed the wire (e.g. 'attachment-error', 'agent-busy'); absent on local failures. */
	code?: string;
	/** The wire error's details.reason (e.g. 'MODEL_DOES_NOT_SUPPORT_IMAGES'), when the host sent one. */
	reason?: string;
}

/**
 * POC-3 W2 (task 2.3) — the card-side phases of one pending answer.
 *
 * waiting/in-flight are LOCAL truth (the user is deciding / the POST is on
 * the wire); settled/answered-elsewhere/withdrawn are WIRE truth from the
 * settlement ring. The store maps settlements onto phases; the components
 * render them (ApprovalCard / QuestionCard own no state machine).
 */
export type AnswerPhase = 'waiting' | 'in-flight' | 'settled' | 'answered-elsewhere' | 'withdrawn';

/** One answerable request as the PAGE renders it (pending + local phase fused). */
export interface AnswerView extends PendingAnswer {
	phase: AnswerPhase;
	/** Settlement outcome once terminal (allowed-once / rejected / answered / cancelled / …). */
	outcome?: string;
}

/** Fresh store bound to one session. */
export function createConversationStore(sessionId: string) {
	let entries = $state<DsiEntry[]>([]);
	let running = $state(false);
	let lastSeq = $state(-1);
	let error = $state<UiError | null>(null);

	// ── ADR-0007 (2026-08-25): access-mode state ─────────────────────────
	/** Knob triple accumulated from every raw knob event seen (cold seed +
	 *  poll deltas) — the delta-application base. Nulls = unknown. */
	let knobs = $state<KnobState>(EMPTY_KNOBS);
	/** Host truth from the history tail's projections block — the baseline
	 *  current + the deployment's real option list (custom-filtered). */
	let basePermission = $state<DsiPermission | null>(null);

	// ── POC-3 W2 (task 2.3): answerer state ──────────────────────────────
	/** rpcId → view. Pending answers are CONTROL state, never ledger entries
	 * (BC-E): replace-by-rpcId, no dedupe churn, not part of `entries`. */
	let answers = $state<Record<string, AnswerView>>({});
	/** rpcIds the client already consumed a settlement for (delivered-then-
	 * consumed; a re-delivered ack'd id is an at-least-once retransmit). */
	let ackedSettlements = new Set<string>();

	function answerViews(): AnswerView[] {
		return Object.values(answers).sort((a, b) => a.receivedAt - b.receivedAt);
	}

	function isTerminal(phase: AnswerPhase): boolean {
		return phase === 'settled' || phase === 'answered-elsewhere' || phase === 'withdrawn';
	}

	/**
	 * Replace-by-rpcId (BC-C client twin): mux-open replay re-delivers the
	 * same rpcId — set() overwrites, never duplicates. LOCAL phase survives
	 * an unchanged pending re-delivery (an in-flight answer keeps its lock;
	 * a terminal card is never resurrected by a stale replay).
	 * Settlements move their rpcId to a terminal phase and are then consumed
	 * (acked); unknown-rpcId settlements (answered before we subscribed)
	 * have no card to settle and are simply consumed.
	 */
	function applyAnswers(pendingAnswers: PendingAnswer[] | undefined, settledAnswers: AnsweredSettlement[] | undefined): void {
		for (const p of pendingAnswers ?? []) {
			const prev = answers[p.rpcId];
			if (prev && isTerminal(prev.phase)) continue; // first claimant won — settled stays settled
			answers[p.rpcId] = {
				...p,
				phase: prev?.phase ?? 'waiting',
				outcome: prev?.outcome
			};
		}
		for (const s of settledAnswers ?? []) {
			if (ackedSettlements.has(s.rpcId)) continue;
			ackedSettlements.add(s.rpcId);
			const view = answers[s.rpcId];
			if (view && !isTerminal(view.phase)) {
				// Cancelled = the turn died; the request is withdrawn, not answered.
				// Our own in-flight POST is the claimant → settled; anything else
			// (waiting card, or the receipt already said not-pending) → elsewhere.
				const phase: AnswerPhase =
					s.outcome === 'cancelled' ? 'withdrawn' : view.phase === 'in-flight' ? 'settled' : 'answered-elsewhere';
				answers[s.rpcId] = { ...view, phase, outcome: s.outcome };
			}
		}
	}

	/** Replace the whole list (cold load / ledger resync — BC-4). */
	function replaceAll(next: DsiEntry[]): void {
		entries = [...next];
	}

	// ── 0.1.3-alpha.1: live assistant-stream tail ────────────────────────

	/**
	 * The bubble id this store currently owns as LIVE (the in-flight
	 * attempt's `a:turn:step`). Null = no live bubble. The tail is the only
	 * producer of `streaming: true` bubbles since ledger v2 retired the
	 * durable chunk events.
	 */
	let liveTailId = $state<string | null>(null);

	/**
	 * Fold one poll's liveStream value (0.1.3-alpha.1):
	 *
	 *   undefined — key not delivered (pre-rebuild server): keep state.
	 *   null      — no attempt in flight: clear the owned bubble if it is
	 *               still streaming (the attempt settled committed-
	 *               assistant/attempt or abandoned, and no durable message
	 *               will finalize it). A bubble already finalized by its
	 *               durable assistant/message survives untouched.
	 *   a tail    — REPLACE the bubble's text/reasoning with the served
	 *               FULL accumulation (never concat: every poll carries the
	 *               whole stream, so reconnects and retries converge). A
	 *               bubble already finalized (durable message landed in
	 *               this batch or before) wins — the tail is stale, its
	 *               end frame is imminent.
	 *
	 * A new tail whose id differs from the owned one first clears the old
	 * bubble (still-streaming only): the host runs one attempt at a time,
	 * so a new attempt id means the old partial is dead.
	 */
	function applyLiveStream(tail: DsiLiveStreamTail | null | undefined): void {
		if (tail === undefined) return;
		if (tail === null) {
			clearLiveTail();
			return;
		}
		if (liveTailId !== null && liveTailId !== tail.id) clearLiveTail();
		liveTailId = tail.id;
		const at = entries.findIndex((e) => e.id === tail.id);
		if (at === -1) {
			const bubble: Extract<DsiEntry, { kind: 'assistant-message' }> = {
				kind: 'assistant-message',
				id: tail.id,
				seq: tail.seq,
				time: tail.time,
				text: tail.text,
				streaming: true,
				...(tail.reasoning !== '' ? { reasoning: tail.reasoning, reasoningStreaming: true } : {})
			};
			entries = [...entries, bubble];
			return;
		}
		const existing = entries[at]!;
		if (existing.kind !== 'assistant-message' || !existing.streaming) return; // finalized wins
		entries[at] = {
			...existing,
			time: tail.time,
			text: tail.text,
			...(tail.reasoning !== '' ? { reasoning: tail.reasoning, reasoningStreaming: true } : {})
		};
	}

	/** Drop the owned live bubble when it never finalized (abandoned /
	 *  retried attempt): the partial text disappears with its attempt. */
	function clearLiveTail(): void {
		if (liveTailId === null) return;
		const id = liveTailId;
		liveTailId = null;
		const at = entries.findIndex((e) => e.id === id);
		if (at === -1) return;
		const existing = entries[at]!;
		if (existing.kind === 'assistant-message' && existing.streaming) {
			entries = entries.filter((e) => e.id !== id);
		}
	}

	/** Merge deltas from one poll (idempotent, chunk-merging). The collapse
	 *  pass re-runs here because a header can arrive in a delta whose list
	 *  already holds an identical row across the batch boundary. */
	function appendMany(incoming: DsiEntry[]): void {
		if (incoming.length === 0) return;
		entries = collapseSystemPromptEntries(mergeEntries(entries, incoming));
	}

	/**
	 * POC-2 W3 — load-older: prepend a ledger page fetched via
	 * history?beforeSeq=firstSeq. Dedupe by id (the same entry can already be
	 * on screen when a page overlaps the cold-load tail) and by seq so a page
	 * can never duplicate live state; unknown-page entries are ignored.
	 * Returns true when at least one NEW entry landed (drives the UI's
	 * no-more-pages signal when false + hasMore=false).
	 */
	function prependOlder(page: DsiEntry[]): boolean {
		if (page.length === 0) return false;
		const known = new Set(entries.map((e) => e.id));
		const knownSeq = new Set(entries.map((e) => e.seq));
		const fresh = page.filter((e) => !known.has(e.id) && !knownSeq.has(e.seq));
		if (fresh.length === 0) return false;
		// The collapse pass spans the page boundary: the older page's trailing
		// header dedupes against the newer rows the list already holds.
		entries = collapseSystemPromptEntries([...fresh, ...entries]);
		return true;
	}

	/** Apply a PollResponse's status fields. */
	function applyStatus(nextRunning: boolean, nextLastSeq?: number): void {
		running = nextRunning;
		if (typeof nextLastSeq === 'number' && nextLastSeq > lastSeq) lastSeq = nextLastSeq;
	}

	// ── ADR-0007: permission methods ─────────────────────────────────────

	/** The live imageLimits projection (0.1.2: control/follow baseline via
	 *  the events poll; null until the server ships one). The composer's
	 *  pre-flight prefers this over the cold-load prop — the 0.1.2 cold page
	 *  carries no projections block. */
	let imageLimits = $state<DsiImageLimits | null>(null);

	/** The host's CURRENT todo list (the `todos` projection — the agent's
	 *  standing plan, cleared by the next turn/start). Undefined until the
	 *  server first delivers the key; null = the host says no plan. */
	let todos = $state<TodoItem[] | null | undefined>(undefined);

	/** The host's plan-mode state (the `plan` projection): active in force
	 *  + pending /plan selection. Null = not delivered (indicator hidden). */
	let planMode = $state<DsiPlanProjection | null>(null);

	/** The session's CURRENT goal (the `goal` projection — the Goal Bar's
	 *  read state, ADR 2026-09-08). Undefined until the server first
	 *  delivers the key; null = the host says no goal (pre-create or the
	 *  clear tombstone). */
	let goal = $state<GoalResultGoal | null | undefined>(undefined);

	/** The host's whole-log ledger stats (sessionStats + tokenUsage
	 *  projections — the stats bar's 'full-ledger' source). Null until the
	 *  server first delivers the pair (older host / projections not
	 *  composed); the panel keeps its partial fold then. */
	let ledgerStats = $state<DsiLedgerStats | null>(null);

	/** The session's presented-file inventory (ADR-0027f D1): raw-lane
	 * deliveries, cold-seeded/resync-replaced wholesale, delta-appended by
	 * callId (idempotent — at-least-once polls never duplicate). Empty =
	 * no presents yet (the anchor button's render gate). */
	let deliverables = $state<PresentedDelivery[]>([]);

	/**
	 * Cold/resync seed (authoritative replace, the entries semantics): the
	 * projections baseline (null = the host ships none) and the window's
	 * raw knob events fold into a fresh triple. Called once per panel
	 * cold load and once per full=1 ledger resync.
	 */
	function seedPermission(permission: DsiPermission | null | undefined, knobEvents?: readonly DshRawEvent[]): void {
		basePermission = permission ?? null;
		knobs = EMPTY_KNOBS;
		for (const event of knobEvents ?? []) knobs = applyKnobEvent(knobs, event);
	}

	/** Fold poll-delta knob events into the accumulated triple (idempotent
	 *  by last-value semantics — a retransmitted knob event rewrites the
	 *  same knob and resolves identically). */
	function applyKnobEvents(events: readonly DshRawEvent[]): void {
		if (events.length === 0) return;
		for (const event of events) knobs = applyKnobEvent(knobs, event);
	}

	/**
	 * The chip's read state, or null to hide. Current: the locally folded
	 * triple wins while it resolves (it is at least as new as the
	 * baseline); otherwise the host baseline stands. Options: the host's
	 * list when it shipped one (deployment truth, R6), else the local
	 * table — used only when knob events exist without a projections
	 * block.
	 */
	const permission = $derived.by<DsiPermission | null>(() => {
		const resolved = resolvePermission(knobs);
		const current = resolved ?? basePermission?.current ?? null;
		if (current === null) return null;
		const options: DsiPresetOption[] = basePermission?.options ?? localPermission().options;
		return { current, options };
	});

	/**
	 * Optimistic user bubble: appears the moment Send is pressed (BC-3 receipt
	 * UX). When the real user/message event arrives, entries with the same
	 * text are dropped so the ledger's copy is the survivor.
	 *
	 * R-3 (Wave 2): returns the entry's `local:` id so a rejected submit can
	 * drop EXACTLY its bubble (dropOptimistic(id)) — text keying degenerates
	 * on attachments-only sends, where every bubble shares text ''.
	 *
	 * @param text - submitted text, verbatim (may be '' for images-only).
	 * @param imageCount - number of images riding this submit (0 omits the field).
	 * @returns the optimistic entry's local id.
	 */
	function addOptimisticUserEntry(text: string, imageCount = 0): string {
		const optimistic: OptimisticEntry = {
			kind: 'user-message',
			id: `local:${crypto.randomUUID()}`,
			seq: Number.MAX_SAFE_INTEGER - 1,
			time: Date.now(), // local bubble exists NOW; the durable twin's wire time replaces it on dedupe
			text,
			local: true,
			...(imageCount > 0 ? { imageCount } : {})
		};
		entries = mergeEntries(entries, [optimistic]);
		return optimistic.id;
	}

	/** Remove ONE optimistic bubble by its local id (submit rejected — it was
	 *  never accepted). Id-keyed so sibling bubbles sharing text survive (R-3). */
	function dropOptimistic(id: string): void {
		entries = entries.filter(
			(e) => !(e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true && e.id === id)
		);
	}

	/**
	 * Replace optimistic bubbles with their durable twins IN PLACE (the local
	 * entry marks the correct chronological position); durable copies consumed
	 * as replacements are not re-appended. Locals without a twin yet survive.
	 */
	function dedupeOptimistic(): void {
		// Two-pass (Wave 4.2 fix): FIRST reserve one durable twin per local
		// bubble (in order), THEN emit every entry — a durable consumed as a
		// replacement is skipped in the emission pass. The old single-pass order
		// emitted the durable first and re-emitted it as the local's replacement,
		// double-rendering one message (found by the 4.2 resync tests).
		const locals = entries.filter(
			(e): e is OptimisticEntry =>
				e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		if (locals.length === 0) return;
		// R-3 completion (Wave 3 task 3.1): the twin key is (text, imageCount)
		// — an image-carrying optimistic bubble must never consume a text-only
		// durable twin sharing its text (and attachments-only twins sharing
		// text '' must not steal each other).
		const twinKey = (text: string, count: number): string => `${text}\u0000${count}`;
		const durableByKey = new Map<string, DsiEntry[]>();
		for (const e of entries) {
			if (e.kind === 'user-message' && !('local' in e)) {
				const key = twinKey(e.text, e.imageRefs?.length ?? 0);
				const list = durableByKey.get(key) ?? [];
				list.push(e);
				durableByKey.set(key, list);
			}
		}
		const reservedDurables = new Set<DsiEntry>();
		const replacement = new Map<DsiEntry, DsiEntry>(); // local → durable twin
		for (const local of locals) {
			const durable = (durableByKey.get(twinKey(local.text, local.imageCount ?? 0)) ?? []).find(
				(d) => !reservedDurables.has(d)
			);
			if (durable) {
				reservedDurables.add(durable);
				replacement.set(local, durable);
			}
		}
		const out: DsiEntry[] = [];
		for (const e of entries) {
			const isLocal = e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true;
			if (isLocal) {
				out.push(replacement.get(e) ?? e); // twin in place, else keep waiting
				continue;
			}
			if (reservedDurables.has(e)) continue; // consumed as a replacement above
			out.push(e);
		}
		entries = out;
	}

	/** Poll deltas arrive with fresh status; dedupe against optimistic copies. */
	function applyPoll(poll: {
		entries: DsiEntry[];
		lastSeq: number;
		running: boolean;
		pendingAnswers?: PendingAnswer[];
		settledAnswers?: AnsweredSettlement[];
		/** ADR-0007: raw knob events from this delta (usually empty). */
		knobEvents?: DshRawEvent[];
		/** 0.1.2: the live permissions projection (control/follow baseline) —
		 *  the delta's chip baseline, present only when the server has one.
		 *  The cold page carries no projections block on this wire, so this
		 *  seed is the chip's authoritative options source. */
		permission?: DsiPermission | null;
		/** 0.1.2: the live imageLimits projection — the composer pre-flight's
		 *  admission numbers, same freshness argument as permission. */
		imageLimits?: DsiImageLimits | null;
		/** 0.1.2: the live todos projection — the agent's current plan.
		 *  undefined = key not delivered (keep current); null = no plan. */
		todos?: TodoItem[] | null;
		/** 0.1.2: the live plan-mode projection. undefined = not delivered
		 *  (keep current); a value (even inactive) is the host's state. */
		plan?: DsiPlanProjection | null;
		/** The live goal projection (the Goal Bar's read state). undefined =
		 *  key not delivered (keep current); null = the host has no goal. */
		goal?: GoalResultGoal | null;
		/** 0.1.3-alpha.1: the in-flight attempt's live tail. undefined =
		 *  key not delivered (keep state); null = nothing in flight (clears
		 *  the owned streaming bubble if still unfinalized). */
		liveStream?: DsiLiveStreamTail | null;
		/** Whole-log ledger stats (statsBar 'full-ledger'). undefined = key
		 *  not delivered (keep current); null = the host pair is absent —
		 *  clears so the panel degrades to its partial fold. */
		ledgerStats?: DsiLedgerStats | null;
		/** ADR-0027f D1: this delta's raw-lane deliverables events (the
		 *  entries lane drops the silent type). undefined = none in this
		 *  delta (keep current); appends are callId-idempotent. */
		deliverables?: PresentedDelivery[];
	}): void {
		appendMany(poll.entries);
		applyStatus(poll.running, poll.lastSeq);
		dedupeOptimistic();
		// The tail folds AFTER the durable entries: a finalize in the same
		// batch wins over the still-served tail (its end frame is imminent).
		applyLiveStream(poll.liveStream);
		applyAnswers(poll.pendingAnswers, poll.settledAnswers);
		if (poll.permission !== undefined) seedPermission(poll.permission, poll.knobEvents);
		else if (poll.knobEvents) applyKnobEvents(poll.knobEvents);
		if (poll.imageLimits !== undefined) imageLimits = poll.imageLimits;
		if (poll.todos !== undefined) todos = poll.todos;
		if (poll.plan !== undefined) planMode = poll.plan;
		if (poll.goal !== undefined) goal = poll.goal;
		if (poll.ledgerStats !== undefined) ledgerStats = poll.ledgerStats;
		// ADR-0027f D1: the delta's raw-lane deliveries append idempotently.
		if (poll.deliverables !== undefined) applyDeliverables(poll.deliverables);
	}

	/**
	 * Fold raw-lane deliveries in (ADR-0027f D1): append by callId — an
	 * already-known callId is a re-delivered poll delta, skipped whole.
	 */
	function applyDeliverables(delta: readonly PresentedDelivery[]): void {
		if (delta.length === 0) return;
		const known = new Set(deliverables.map((d) => d.callId));
		const fresh = delta.filter((d) => !known.has(d.callId));
		if (fresh.length === 0) return;
		deliverables = [...deliverables, ...fresh];
	}

	/**
	 * Seed the inventory (cold load + resync — authoritative replace, the
	 * ledger's append-only truth re-read whole; ADR-0027f D1).
	 */
	function seedDeliverables(next: readonly PresentedDelivery[]): void {
		deliverables = [...next];
	}

	/**
	 * Seed the live imageLimits projection (resync path — the delta seed
	 * lives in applyPoll). Null clears (the host ships no limits).
	 */
	function seedImageLimits(limits: DsiImageLimits | null): void {
		imageLimits = limits;
	}

	/**
	 * Seed the live todos projection (resync path — the delta seed lives
	 * in applyPoll). Null clears (the host says no current plan).
	 */
	function seedTodos(next: TodoItem[] | null): void {
		todos = next;
	}

	/**
	 * Seed the live plan projection (resync path — the delta seed lives
	 * in applyPoll). Null clears (plan-mode not composed / not delivered).
	 */
	function seedPlanMode(next: DsiPlanProjection | null): void {
		planMode = next;
	}

	/**
	 * Seed the live goal projection (resync path — the delta seed lives
	 * in applyPoll). Null clears (the host says no current goal).
	 */
	function seedGoal(next: GoalResultGoal | null): void {
		goal = next;
	}

	/** Seed the whole-log ledger stats (resync path). Null clears (no
	 *  host pair — the panel degrades to its partial fold). */
	function seedLedgerStats(next: DsiLedgerStats | null): void {
		ledgerStats = next;
	}

	/** Apply a confirmed host truth out-of-band (the goals/* RemoteResult's
	 *  fresh GoalView): the chip's ref and phase flip immediately instead of
	 *  waiting for the next poll, so a quick second action carries the NEW
	 *  CAS revision instead of honestly losing with the stale one. */
	function applyGoal(next: GoalResultGoal): void {
		goal = next;
	}

	/**
	 * Wave 4.2 — ledger resync after a detected gap (mux drop).
	 * The buffer lost events; the ledger page is authoritative (BC-4), so the
	 * whole list is REPLACED from it. Optimistic user bubbles whose durable
	 * twins are already in the ledger are consumed by the replace itself
	 * (same id/text merge rules); twins that have NOT landed yet survive so
	 * an in-flight submit is never visually reverted. The resync response
	 * carries answerer state like every poll (BC-E) — applied through the
	 * SAME replace-by-rpcId rules as the delta path, so a page stuck
	 * resyncing still renders pending/settled cards.
	 */
	function resyncFromLedgerEntries(
		next: DsiEntry[],
		lastSeq: number,
		running: boolean,
		permissionSeed?: { permission?: DsiPermission | null; knobEvents?: DshRawEvent[] },
		answers?: { pendingAnswers?: PendingAnswer[]; settledAnswers?: AnsweredSettlement[] },
		deliverablesSeed?: readonly PresentedDelivery[]
	): void {
		// Keep still-unmatched optimistic bubbles across the replace: an
		// in-flight submit must never visually revert during a resync.
		const pendingOptimistic = entries.filter(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		replaceAll(next);
		if (pendingOptimistic.length > 0) entries = mergeEntries(entries, pendingOptimistic);
		applyStatus(running, lastSeq);
		dedupeOptimistic(); // consume twins that DID land in the ledger
		// ADR-0007: the ledger tail is authoritative for the access mode too
		// (the tail page carries the projections block; the resync caller
		// passes both seed members when the response had them).
		if (permissionSeed !== undefined) {
			seedPermission(permissionSeed.permission, permissionSeed.knobEvents);
		}
		// ADR-0027f D1: the ledger tail is authoritative for the inventory
		// too — replace wholesale (the resync caller passes the raw lane).
		if (deliverablesSeed !== undefined) seedDeliverables(deliverablesSeed);
		applyAnswers(answers?.pendingAnswers, answers?.settledAnswers);
	}

	// ── POC-3 W2 (task 2.3): respond carrier client-side ────────────────

	/** Acquire the per-rpcId in-flight lock (false = already locked). */
	function lockAnswer(rpcId: string): boolean {
		const view = answers[rpcId];
		if (!view || view.phase !== 'waiting') return false;
		answers[rpcId] = { ...view, phase: 'in-flight' };
		return true;
	}

	/** Release the lock (transport failure): card returns to answerable. */
	function releaseAnswer(rpcId: string): void {
		const view = answers[rpcId];
		if (view && view.phase === 'in-flight') answers[rpcId] = { ...view, phase: 'waiting' };
	}

	/** Receipt said accepted:false (BC-B) — settle as answered elsewhere. */
	function markAnswerElsewhere(rpcId: string, reason?: string): void {
		const view = answers[rpcId];
		if (view && !isTerminal(view.phase)) {
			answers[rpcId] = { ...view, phase: 'answered-elsewhere', outcome: reason ?? 'not-pending' };
		}
	}

	/** Receipt said accepted:true — OUR claim won (W4 spec 20: the resolved
	 * broadcast can be missed when the mux is down mid-answer; the receipt is
	 * the host's confirmation — settle now, not on a broadcast that may never
	 * arrive). The outcome label comes from what WE sent (the broadcast would
	 * have said the same). The poll settlement remains idempotent-confirming. */
	function markAnswerAccepted(rpcId: string, outcome?: string): void {
		const view = answers[rpcId];
		if (view && view.phase === 'in-flight') {
			answers[rpcId] = { ...view, phase: 'settled', ...(outcome !== undefined ? { outcome } : {}) };
		}
	}

	/** rpcIds whose settlements this client consumed (poll ack parameter). */
	function ackedAnswerIds(): string[] {
		return [...ackedSettlements];
	}

	function setError(message: string | null, code?: string, reason?: string): void {
		error =
			message === null
				? null
				: {
						message,
						...(code !== undefined ? { code } : {}),
						...(reason !== undefined ? { reason } : {})
					};
	}

	// ── POC-3 W2 (task 2.3): render rule — one chip per call ─────────────
	/**
	 * Paired-result suppression: a standalone tool-result whose callId
	 * paired into a tool-call entry renders NOTHING (the call chip already
	 * carries status/duration/result; POC-2 rendered both = the G5 double
	 * chip). Orphan results (no call in the list) still render — honest.
	 * A $derived view over `entries`: the ledger truth stays untouched in
	 * `entries` (BC-E) — this is a RENDER rule, not a merge rule.
	 */
	const renderEntries = $derived.by(() => {
		const callIds = new Set(
			entries.filter((e): e is Extract<DsiEntry, { kind: 'tool-call' }> => e.kind === 'tool-call').map((e) => e.callId)
		);
		return entries.filter((e) => !(e.kind === 'tool-result' && callIds.has(e.callId)));
	});

	const store = {
		get sessionId() {
			return sessionId;
		},
		get entries() {
			return entries;
		},
		/** Render list: paired standalone results suppressed (one chip per call). */
		get renderEntries() {
			return renderEntries;
		},
		/** Answerer cards (pending + settled views, receivedAt order). */
		get answerList() {
			return answerViews();
		},
		/** Access-mode read state (ADR-0007); null hides the chip. */
		get permission() {
			return permission;
		},
		/** Live imageLimits projection (0.1.2); null until the server ships one. */
		get imageLimits() {
			return imageLimits;
		},
		/** The host's current todo list (todos projection); undefined until
		 *  the server first delivers the key, null = no current plan. */
		get todos() {
			return todos;
		},
		/** The host's plan-mode state (plan projection); null = not delivered. */
		get planMode() {
			return planMode;
		},
		/** The session's current goal (goal projection); undefined until the
		 *  server first delivers the key, null = no current goal. */
		get goal() {
			return goal;
		},
		/** Whole-log ledger stats (sessionStats + tokenUsage projections);
		 *  null until the server first delivers the pair. */
		get ledgerStats() {
			return ledgerStats;
		},
		/** The session's presented-file inventory (ADR-0027f); empty =
		 *  no presents (the DeliverablesButton gate). */
		get deliverables() {
			return deliverables;
		},
		seedImageLimits,
		seedDeliverables,
		seedTodos,
		seedPlanMode,
		seedGoal,
		seedLedgerStats,
		applyGoal,
		seedPermission,
		applyKnobEvents,
		applyAnswers,
		applyLiveStream,
		lockAnswer,
		releaseAnswer,
		markAnswerElsewhere,
		markAnswerAccepted,
		ackedAnswerIds,
		get running() {
			return running;
		},
		get lastSeq() {
			return lastSeq;
		},
		get isStreaming() {
			return running;
		},
		get error() {
			return error;
		},
		replaceAll,
		appendMany,
		prependOlder,
		resyncFromLedgerEntries,
		applyStatus,
		applyPoll,
		addOptimisticUserEntry,
		dedupeOptimistic,
		dropOptimistic,
		setError
	};
	liveStores.set(sessionId, store);
	return store;
}

// ── Live store registry (Loadinjected, 2026-09-07) ─────────────────────
// The injected-doc panel reads the SAME live transcript its source
// conversation panel polls — the floor's cold snapshot lags (it fills at
// mount; header re-epochs and re-injections land later via the polls, so
// a doc panel reading only the snapshot showed a missing record for a
// payload the shelf itself had offered). Registered at creation, keyed by
// session id; a closed source's store stays as the frozen logged record.
// Not reactive itself: the registered stores' $state entries are what
// track inside consumers' derivations.
const liveStores = new Map<string, ConversationStore>();

/** The live conversation entries for a session, when a panel's store is
 *  mounted; null = no live copy (callers fall back to their snapshot). */
export function liveConversationEntries(sessionId: string): readonly DsiEntry[] | null {
	return liveStores.get(sessionId)?.entries ?? null;
}

export type ConversationStore = ReturnType<typeof createConversationStore>;

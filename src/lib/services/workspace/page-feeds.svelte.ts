/**
 * Page feeds — the workspace route's cross-panel registries and the
 * floor's two lifecycle feeds (ADR-0018 D2/D4 wave 2; spec "Component
 * Standard Enforcement" 2.2).
 *
 * SINGLETON by design — these registries describe THE floor, not a
 * component instance:
 * - `coldCache`: runtime dual-fetch results per sessionId.
 * - `coldInFlight`: sessions with a cold fetch running (loader guard).
 * - `deadSessions`: sessions the host no longer knows (honest error
 *   card, commitment 7).
 * - `edgeCache`: parent edges known at ADD time but not yet on the wire
 *   (the fork child fills the one-to-two ticks before its spine row).
 *
 * Per D2 the service exposes immutable-style mutators (spread writes),
 * never raw reassignment from the route — the route keeps zero local
 * copies so singleton and view can never diverge.
 */
import { SvelteSet } from 'svelte/reactivity';
import { pruneSync } from '$lib/services/chat/prompt-sync.svelte';
import { bornAt, refreshScheduleLedger } from '$lib/services/schedule-ledger.svelte';
import { spineFeed, subscribeSpineFeed } from '$lib/services/conversation/spine-feed.svelte';
import type { DsiEntry } from '$lib/types';

/** Cold-load shape the panels consume (server seed + dual fetch). */
export interface ColdLoad {
	title: string | null;
	workspace: string | null;
	agentPreset: string | null;
	entries: DsiEntry[];
	lastSeq: number;
	running: boolean;
	hasMore: boolean;
	pendingAnswers: import('$lib/types').PendingAnswer[];
	settledAnswers: import('$lib/types').AnsweredSettlement[];
	/** ADR-0007: the access mode rides the dual fetch. */
	permission: import('$lib/services/conversation/permission-state').DsiPermission | null;
	/** Host admission numbers (imageLimits projection; null → defaults). */
	imageLimits: import('$lib/services/conversation/image-limits').DsiImageLimits | null;
	knobEvents: import('$lib/services/conversation/dsh-events').DshRawEvent[];
	/** ADR-0027f D1: the presented-file inventory (raw lane over full=1). */
	deliverables: import('$lib/services/conversation/deliverables').PresentedDelivery[];
}

class PageFeeds {
	coldCache = $state<Record<string, ColdLoad | undefined>>({});
	coldInFlight = $state(new SvelteSet<string>());
	deadSessions = $state<Record<string, string>>({});
	edgeCache = $state<Record<string, string>>({});
	/** ADR-0059 D1: a ledger birth heals a dead entry ONCE - the guard
	 *  keeps a second ledger tick (or a re-recorded card) from looping. */
	private autoHealDone = new Set<string>();

	/** Seed-arrival prime: the seed panel mounts with full cold props on
	 *  paint one (SSR parity for the seed path). Load-time constant. */
	primeSeed(sessionId: string, cold: ColdLoad): void {
		this.coldCache = { ...this.coldCache, [sessionId]: cold };
	}

	/** Record an ADD-time parent edge (the route's doAdd fork path). */
	rememberEdge(childSessionId: string, parentSessionId: string): void {
		this.edgeCache = { ...this.edgeCache, [childSessionId]: parentSessionId };
	}

	/** One dual fetch, registries kept honest (in-flight guard, dead
	 *  session card, loader clear in `finally`). The fetcher is injected:
	 *  the wire call stays the route's (`fetchCold` reads the host
	 *  config); the bookkeeping lives here. */
	async runCold(sessionId: string, fetchCold: (id: string) => Promise<ColdLoad | null>): Promise<void> {
		if (this.coldCache[sessionId] !== undefined || this.coldInFlight.has(sessionId)) return;
		this.coldInFlight = new SvelteSet(this.coldInFlight).add(sessionId);
		try {
			const cold = await fetchCold(sessionId);
			if (cold !== null) {
				this.coldCache = { ...this.coldCache, [sessionId]: cold };
			} else {
				// Honest state (commitment 7): the host no longer knows this
				// session — an error card with close, never a stuck loader or
				// a page crash. Sibling panels are unaffected (per-panel state).
				this.deadSessions = {
					...this.deadSessions,
					[sessionId]: `Session ${sessionId} not found on the DSH host. It may have been reaped.`
				};
			}
		} finally {
			const next = new SvelteSet(this.coldInFlight);
			next.delete(sessionId);
			this.coldInFlight = next;
		}
	}

	/** ADR-0059 D2: the dead card's manual retry. Clears the honest-404
	 *  entry and re-runs the cold load; the still-dead result re-records
	 *  the card (honest). Respects the same guards as runCold: a cached
	 *  load just drops the card; an in-flight cold is not re-entered —
	 *  the card stays until that flight settles and re-records. */
	async retryDead(sessionId: string, fetchCold: (id: string) => Promise<ColdLoad | null>): Promise<void> {
		if (this.coldCache[sessionId] !== undefined) {
			const { [sessionId]: _drop, ...rest } = this.deadSessions;
			this.deadSessions = rest;
			return;
		}
		if (this.coldInFlight.has(sessionId)) return;
		const { [sessionId]: _clear, ...rest } = this.deadSessions;
		this.deadSessions = rest;
		await this.runCold(sessionId, fetchCold);
	}

	/** The floor's two lifecycle feeds (call during component init —
	 *  `$effect` needs an owner):
	 *  - Prompt Sync hygiene (ADR "The Prompt Sync" D1/D6): a session
	 *    that left the floor holds no check and no snapshot; count 0
	 *    clears the broadcast. Conversation sessions only (D6).
	 *  - Spine feed lifecycle (W8): ref-counted single timer started on
	 *    mount, stopped on destroy; the a2a window rides the floor's
	 *    conversation senders (first sender per tick, never per panel).
	 *  Returns the spine subscription's cleanup. */
	installFeeds(
		getConversationSessionIds: () => string[],
		/** ADR-0059 D1: when provided, dead entries whose session id gains a
		 *  schedule-ledger birth fact (lastDelivery landed) are cleared and
		 *  the cold load re-runs once - the born-late panel self-heals with
		 *  no reload and no clicks. The ledger fetch stays the shared
		 *  single-flight read (no new wire traffic). */
		fetchCold?: (id: string) => Promise<ColdLoad | null>
	): () => void {
		$effect(() => {
			pruneSync(new Set(getConversationSessionIds()));
		});
		$effect(() => {
			return subscribeSpineFeed(getConversationSessionIds);
		});
		if (fetchCold) {
			// One shared ledger prime at install (single-flight — the sidebar
			// mount path already fires it; this only guarantees a first tick).
			void refreshScheduleLedger();
			// The pulse (Born-Late Panel T4 fix, live-verified 2026-11-11): the
			// Shelf's own 30s poll uses its OWN fetch and never touches the
			// shared join, so without a pulse the born map never refreshes while
			// a dead panel sits open and D1 starves. The pulse rides the SAME
			// shared single-flight read, arms ONLY while a dead entry exists,
			// and only fires when the page is visible — zero steady-state wire
			// traffic for healthy floors, none while hidden.
			$effect(() => {
				const hasDead = Object.keys(this.deadSessions).length > 0;
				if (!hasDead) return;
				const timer = setInterval(() => {
					if (document.visibilityState === 'visible') void refreshScheduleLedger();
				}, 30_000);
				return () => clearInterval(timer);
			});
			$effect(() => {
				for (const id of Object.keys(this.deadSessions)) {
					const born = bornAt(id); // reactive read: re-runs on ledger ticks
					if (born === null || this.autoHealDone.has(id)) continue;
					this.autoHealDone.add(id);
					void this.retryDead(id, fetchCold);
				}
			});
		}
		return () => {};
	}
}
export const pageFeeds = new PageFeeds();

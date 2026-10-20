/**
 * Paging — load-older / load-all state machine (moved WHOLE from
 * ConversationPanel.svelte, ADR-0022 R2 W3; ADR-0019 move-whole: every
 * line keeps its semantics, comments ride).
 *
 * POC-2 W3: load-older paging (ledger truth, BC-4) — hasMore drives the
 * sentinel: hidden once the ledger head is reached. hasOlder starts as
 * a property of the COLD LOAD's ledger page; later pages refresh it
 * inside loadOlder.
 */
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import type { DsiEntry } from '$lib/types';

type Store = ReturnType<typeof createConversationStore>;

export class Paging {
	hasOlder = $state(false);
	loadingOlder = $state(false);
	olderError = $state<string | null>(null);
	/** First seq currently on screen — the page anchor for the next fetch. */
	firstSeq = $state(-1);

	// In-flight join (2026-08-26 shift-drain): loadOlder is reachable
	// from THREE triggers — the sentinel's observer, the manual button,
	// and the drain loop. The old boolean guard made concurrent callers
	// silently no-op: a drain that started while the sentinel's page was
	// mid-flight would see hasOlder still true, await nothing, and end
	// "done" with pages left. Joining the shared promise instead makes
	// every caller observe the SAME completion.
	private olderInFlight: Promise<void> | null = null;

	private readonly deps: { store: Store; get sessionId(): string };

	constructor(deps: { store: Store; get sessionId(): string }, hasMore: boolean | undefined) {
		this.deps = deps;
		// Intentional initial capture: hasMore is a property of the COLD
		// LOAD's ledger page; later pages refresh it inside loadOlder.
		this.hasOlder = hasMore === true;
		this.firstSeq = this.entriesFirstSeq();
	}

	private entriesFirstSeq(): number {
		return this.deps.store.entries.length > 0 ? this.deps.store.entries[0].seq : -1;
	}

	async loadOlder(): Promise<void> {
		if (this.olderInFlight) return this.olderInFlight;
		const run = (async () => {
			if (!this.hasOlder || this.firstSeq <= 0) return;
			this.loadingOlder = true;
			this.olderError = null;
			try {
				const url = `/api/dsh/session/${encodeURIComponent(this.deps.sessionId)}/history?beforeSeq=${this.firstSeq}`;
				const res = await fetch(url);
				const body = (await res.json()) as {
					ok: boolean;
					entries?: DsiEntry[];
					hasMore?: boolean;
					error?: { code: string; message: string };
				};
				if (!res.ok || !body.ok) {
					// Failure keeps the list intact — the user can scroll again to retry.
					this.olderError = body.error?.message ?? `load older failed (${res.status})`;
					return;
				}
				const added = this.deps.store.prependOlder(body.entries ?? []);
				this.hasOlder = body.hasMore === true && added;
				this.firstSeq = this.entriesFirstSeq();
			} catch (err) {
					this.olderError = err instanceof Error ? err.message : String(err);
			} finally {
				this.loadingOlder = false;
			}
		})();
		this.olderInFlight = run;
		try {
			await run;
		} finally {
			this.olderInFlight = null;
		}
	}

	/** Shift+click far-edge jump (2026-08-26): drain EVERY remaining older
	 *  page before the jump lands. Without it a plain "Back to top" reaches
	 *  only the top of the loaded window — the sentinel auto-loads one page,
	 *  the prepend anchor keeps the viewport put, and a long conversation
	 *  costs one click per page. The drain ends on ledger truth (hasMore
	 *  false, a duplicate page, or the head); the progress check is the
	 *  belt-and-braces that can never loop on a standing answer, and the
	 *  cap surfaces a lying server as an honest error, never a spinner. */
	private readonly LOAD_ALL_MAX_PAGES = 200;

	async loadAllOlder(): Promise<void> {
		for (let i = 0; i < this.LOAD_ALL_MAX_PAGES; i += 1) {
			if (!this.hasOlder || this.olderError !== null || this.firstSeq <= 0) return;
			const before = this.firstSeq;
			await this.loadOlder();
			if (!this.hasOlder || this.olderError !== null) return;
			if (this.firstSeq === before) return;
		}
		this.olderError = `stopped after ${this.LOAD_ALL_MAX_PAGES} pages — the ledger kept reporting more`;
	}
}

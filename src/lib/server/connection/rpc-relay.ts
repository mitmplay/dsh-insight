/**
 * connection/rpc-relay — the RPC relay + answer registry (ADR-0022 W4,
 * ADR-0019 move-whole): the POC-3 pending-answer/settlement registries and
 * their replay reap, the catalog-invalidation listener registry, the
 * subagent parent-address hints, and every unary RPC forward (all bytes via
 * dsh-rpc helpers; the transport POST itself stays in the shell's rpc()).
 */
import {
	DSH_ARGS,
	DSH_METHODS,
	REMOTE_EVENT_RESULT_ENDPOINT,
	DshRpcError,
} from '$lib/server/dsh-rpc';
import { JobFollowRelay, type FollowSink } from '$lib/server/jobs/follow-relay';
import type {
	DshAttachmentValue,
	DshCommandReceipt,
	DshCommandRow,
	DshPromptContent,
	DshSkillList,
	DshWorkspaceDirectoryListing,
	DshWorkspaceFileBytes,
	DshWorkspaceFileText,
	RespondReceipt,
} from '$lib/server/dsh-rpc';
import type {
	DshConnection,
	DshHistoryPage,
	DshWorkspaceCreateResult,
	DshSessionEvent,
	DshSessionEventLike,
	RawSessionProjections,
	RawSessionRow,
	RenameResult,
} from '$lib/server/dsh-connection';
import type {
	DsiDirectoryEntry,
	DsiDirectoryListing,
	DsiJobKillResult,
	DsiJobView,
	DsiModelDirectory,
	DsiModelSelection,
} from '$lib/types';
import { readDshPresetEnglishConfig } from '$lib/server/insight-config';
import { normalizeModelDirectory, normalizeModelSelection, normalizePreset, normalizeSessionRow, expandRecords } from './normalize';
import type { DshPreset, ListResult, RawPresetRow } from './normalize';
/**
 * POC-3 W1 — an answerable frame awaiting a human (registry value).
 *
 * Transient CONTROL state, never a ledger entry (BC-E): requested frames are
 * replayed by the host on mux open; audit events stay in the ledger. The
 * rpcId is the wire-stable correlation for the respond carrier.
 */
export interface PendingAnswerFrame {
	rpcId: string;
	sessionId: string;
	kind: 'approval' | 'question';
	/** approval/requested carries {approvalId, toolName, callId?, reason?}; question/requested carries {questions:[…]} (verbatim wire payloads). */
	body: Record<string, unknown>;
	/** Monotonic arrival time (ms) — ordering for the UI, not wire truth. */
	receivedAt: number;
	/**
	 * DSI mux generation whose $events delivery last (re)registered this
	 * entry. The host replays every still-pending waterfall into each new
	 * generation, so an entry no newer generation confirms is finished —
	 * reaped when the generation's ready frame lands (see
	 * reapUnconfirmedPending).
	 */
	deliveredGen: number;
}

/** A settlement outcome for one rpcId (approval or question). */
export interface AnswerSettlement {
	rpcId: string;
	sessionId: string;
	kind: 'approval' | 'question';
	/** approval: 'allowed-once'|'rejected'|'cancelled'|… · question: 'answered'|'cancelled'. */
	outcome: string;
	settledAt: number;
}

/**
 * Catalog-invalidation listener (Slash Menu W1, task 1.3): the connection
 * fires these from the two $events emit arms + the socket-reset path —
 * 'all' when any session's vocabulary moved (commands/change, mux reset),
 * one sessionId when a preset switch retargeted it (agent-preset/selected).
 */
export type CatalogInvalidationListener = (scope: string | 'all') => void;

/**
 * Job roster listener (Job Badge Wave 1, ADR-0026 D2): fired by the mux push
 * path whenever the host's job.list stream frames a per-session whole-set
 * replacement. The roster store subscribes per watched sessionId; the
 * sidebar badge and the conversation JobsButton share what it delivers.
 */
export type JobRosterListener = (sessionId: string, jobs: readonly DsiJobView[]) => void;

/**
 * Parent-address facts for one subagent-origin session, folded from its
 * session.list row: the host requires spawned sessions to be addressed with
 * the subagent form (parentSessionId, childSessionId, mode) and rejects the
 * plain session form with 'agent-busy'. 'mode' must equal the child
 * descriptor's lifecycle mode exactly.
 */
interface SubagentAddressHint {
	parentSessionId: string;
	mode: 'one-shot' | 'continuable';
}

export class RpcRelay {
	private answerReapTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly answerReapGraceMs: number;
	private readonly staleGenerationRetryMs: number;
	constructor(
		private readonly conn: DshConnection,
		private readonly ringCapacity: () => number,
		opts: { answerReapGraceMs: number; staleGenerationRetryMs: number }
	) {
		this.answerReapGraceMs = opts.answerReapGraceMs;
		this.staleGenerationRetryMs = opts.staleGenerationRetryMs;
	}
	/**
	 * POC-3 W1 — answerable frames arrive as ServerRequest pushes with a
	 * stable rpcId. Mux-open REPLAYS still-pending requested frames with the
	 * same rpcId (api-proxy.ts replay loop), so the registry must be
	 * idempotent by rpcId (BC-C): a replay overwrites, never duplicates.
	 */
	private pendingAnswers = new Map<string, PendingAnswerFrame>();
	/** Settlement ring: last outcome per rpcId, delivered-then-pruned. */
	private settledAnswers = new Map<string, AnswerSettlement>();
	/** Catalog-invalidation registry (Slash Menu W1) — listeners see every arm. */
	private catalogInvalidated: Set<CatalogInvalidationListener> = new Set();
	/** Job roster registry (Job Badge Wave 1) — per-frame fan-out to watchers. */
	private jobRosterListeners: Set<JobRosterListener> = new Set();
	/**
	 * The Roster Mirror (ADR 2026-10-17, The Roster Mirror — D1): the newest
	 * job/list stream frame per session. Authority stays the host registry;
	 * this is the derived copy GET /api/dsh/jobs serves. Pending (no frame
	 * yet) is honest darkness, never a synthesized empty set.
	 */
	private jobRosterCache = new Map<string, { jobs: DsiJobView[] }>();
	/** Poll-liveness per watched session — the HTTP-native watch (D2): the
	 *  browser's 2s poll is the heartbeat; silence past the grace reaps. */
	private jobRosterTouch = new Map<string, number>();
	/** First stream failure per session logged once (D3 loudness budget). */
	private jobRosterFailureLogged = new Set<string>();
	/** The roster reaper interval (armed on first touch, disarmed at zero). */
	private jobRosterReapTimer: ReturnType<typeof setInterval> | undefined;
	/** Open/close transports wired once by DshConnection (mux bridge). */
	jobRosterTransport: { open: (sessionId: string) => void; close: (sessionId: string) => void } | null = null;
	/** Grace before an unpolled session's stream closes (tests shrink it). */
	jobRosterGraceMs = 10_000;
	/** Sessions whose stream is believed open — one open per watch period. */
	private jobRosterOpened = new Set<string>();
	/**
	 * Parent-address hints for subagent-origin sessions (SubagentAddressHint),
	 * folded from session.list rows by rawListSessions.
	 */
	subagentHints = new Map<string, SubagentAddressHint>();
	/** Session-ids whose hint absence was already probed with a list pass
	 *  (one probe per session lifetime — ordinary sessions never re-probe). */
	hintProbed = new Set<string>();
	/**
	 * Fork-child display titles healed off the wire (2026-09-14, host gap
	 * DSI-side): the host's session.list serves NO projections column for a
	 * cold seeded (fork child) row — session-controller list.ts
	 * projectionsFor short-circuits isSeeded headers because the projection
	 * cache is keyed by the inherited cut a listed header does not carry.
	 * The real title (what the panel shows once the session attaches) lives
	 * in the child's ledger: a child that ran its own turns carries a NEW
	 * session/title event near the tail, so ONE bounded tail-page read per
	 * untitled fork row recovers it. The result caches for the process
	 * lifetime (a retitle lands through the normal rename/live paths, which
	 * serve the title directly). The parent row's title is the FALLBACK for
	 * children the tail page shows never retitled — the inherited title IS
	 * the parent's at fork time; stale only when the parent was renamed
	 * after the fork. Absent hints and absent parents leave the row
	 * honestly untitled.
	 */
	private forkTitleHints = new Map<string, string>();
	private forkTitleInFlight = new Set<string>();

	/** Subscribe to catalog invalidations ($events arms + socket reset). */
	onCatalogInvalidated(listener: CatalogInvalidationListener): () => void {
		this.catalogInvalidated.add(listener);
		return () => this.catalogInvalidated.delete(listener);
		}

	fireCatalogInvalidated(scope: string | 'all'): void {
		for (const listener of this.catalogInvalidated) listener(scope);
	}

	/** approval/requested | question/requested → registry (idempotent by rpcId). */
	registerPending(frame: Record<string, unknown>, rpcId?: string): void {
		const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : '';
		if (!sessionId) {
			// Orphan frame (no session context) — log and ignore; never crash the poll path.
			this.conn.log('dsh-connection: answerable frame without sessionId — ignored', frame?.type);
			return;
		}
		if (typeof rpcId !== 'string' || rpcId.length === 0) {
			this.conn.log('dsh-connection: answerable frame without rpcId — ignored', frame?.type);
			return;
		}
		const kind = frame.type === 'approval/requested' ? 'approval' : 'question';
		// Idempotent: mux-open replay re-delivers the SAME rpcId — set (replace)
		// never duplicates; receivedAt refreshes on replay (host says: still pending).
		this.pendingAnswers.set(rpcId, {
			rpcId,
			sessionId,
			kind,
			body: frame as Record<string, unknown>,
			receivedAt: Date.now(),
			deliveredGen: this.conn.downlinks.generation
		});
		this.conn.log(`dsh-connection: pending ${kind} registered (${rpcId}) for ${sessionId}`);
	}

	/**
	 * Withdraw one pending answer (0.1.2 $events settle/cancel): remove the
	 * registry entry and record the outcome in the settlement ring. Unknown
	 * ids settle nothing (answered before we subscribed — honest no-op).
	 */
	withdrawPending(eventId: string, outcome?: string): void {
		const pending = this.pendingAnswers.get(eventId);
		if (pending === undefined) {
			this.conn.log(`dsh-connection: settlement with no matching pending (${eventId}) — ignored`);
			return;
		}
		this.pendingAnswers.delete(eventId);
		this.settledAnswers.set(eventId, {
			rpcId: eventId,
			sessionId: pending.sessionId,
			kind: pending.kind,
			outcome: outcome ?? 'cancelled',
			settledAt: Date.now()
		});
		this.conn.log(`dsh-connection: ${pending.kind} settled (${eventId}) outcome=${outcome ?? 'cancelled'}`);
	}

	/**
	 * Schedule the still-pending replay reap for this generation (ready
	 * frame just arrived). The host replays every still-pending waterfall
	 * into the new generation, but the ready frame can hit the wire before
	 * the replayed frames drain, so the check runs after a short grace —
	 * entries an older generation registered and the replay did NOT
	 * re-confirm finished while we were disconnected (answered, cancelled,
	 * or aborted); keeping them pending resurrects zombie answer cards the
	 * user can answer forever with no effect.
	 */
	armAnswerReap(): void {
		clearTimeout(this.answerReapTimer);
		this.answerReapTimer = setTimeout(() => this.reapUnconfirmedPending(), this.answerReapGraceMs);
	}

	/** Withdraw every pending answer not re-delivered by the current generation. */
	private reapUnconfirmedPending(): void {
		for (const [eventId, pending] of [...this.pendingAnswers]) {
			if (pending.deliveredGen >= this.conn.downlinks.generation) continue;
			this.conn.log(
				`dsh-connection: reap unconfirmed pending (${eventId}) from generation ${pending.deliveredGen} — not in generation ${this.conn.downlinks.generation} replay`
			);
			this.withdrawPending(eventId);
		}
	}

	/**
	 * After OUR answer was accepted the question is done — withdraw the
	 * registry entry with the outcome we sent instead of waiting for the
	 * host's settle broadcast, which races generation rebuilds and can be
	 * lost entirely (the answered card would resurrect on the next page
	 * load from a stale pendingAnswers).
	 */
	private forgetAnswered(rpcId: string, value: unknown): void {
		this.withdrawPending(rpcId, typeof value === 'string' ? value : 'answered');
	}

	/** approval/resolved | question/resolved → pending removed, settlement recorded. */
	registerSettlement(frame: Record<string, unknown>): void {
		const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : '';
		if (!sessionId) {
			this.conn.log('dsh-connection: settlement frame without sessionId — ignored', frame?.type);
			return;
		}
		// approval/resolved keys by approvalId; question/resolved by questionRpcId —
		// both resolve back to the pending entry's rpcId via the registry.
		const kind = frame.type === 'approval/resolved' ? 'approval' : 'question';
		const outcome = typeof frame.outcome === 'string' ? frame.outcome : 'unknown';
		let rpcId: string | undefined;
		if (kind === 'approval' && typeof frame.approvalId === 'string') {
			rpcId = [...this.pendingAnswers.values()].find(
				(p) => p.sessionId === sessionId && p.body.approvalId === frame.approvalId
			)?.rpcId;
		} else if (kind === 'question' && typeof frame.questionRpcId === 'string') {
			// question/resolved names the ORIGINAL request's rpcId (api-proxy claimQuestion).
			rpcId = frame.questionRpcId;
		}
		if (rpcId) {
			this.pendingAnswers.delete(rpcId);
			this.settledAnswers.set(rpcId, {
				rpcId,
				sessionId,
				kind,
				outcome,
				settledAt: Date.now()
			});
			this.conn.log(`dsh-connection: ${kind} settled (${rpcId}) outcome=${outcome}`);
		} else {
			// Settlement for an unknown/foreign request (e.g. answered before we
			// subscribed, or another UI raced) — nothing pending to withdraw.
			this.conn.log(`dsh-connection: settlement with no matching pending (${frame?.type}) — ignored`);
		}
	}

	/** Pending answers for a session (for the PollResponse extension). */
	pendingFor(sessionId: string): PendingAnswerFrame[] {
		return [...this.pendingAnswers.values()].filter((p) => p.sessionId === sessionId);
	}

	/** Recent settlements for a session (ring: delivered-then-pruned). */
	settlementsFor(sessionId: string): AnswerSettlement[] {
		return [...this.settledAnswers.values()].filter((s) => s.sessionId === sessionId);
	}

	/** Delivery hook: drop settlements the client has already seen (ring prune). */
	pruneSettlements(sessionId: string, seenRpcIds: string[]): void {
		for (const id of seenRpcIds) {
			const s = this.settledAnswers.get(id);
			if (s && s.sessionId === sessionId) this.settledAnswers.delete(id);
		}
	}

	async listSessions(): Promise<ListResult> {
		const items = (await this.rawListSessions()).map(normalizeSessionRow);
		const titleById = new Map(items.map((s) => [s.sessionId, s.title] as const));
		for (const row of items) {
			if (row.title !== null) continue;
			if (row.parentSessionId === null || row.origin === 'subagent') continue;
			const hint = this.forkTitleHints.get(row.sessionId);
			if (hint !== undefined) {
				row.title = hint;
				continue;
			}
			if (!this.forkTitleInFlight.has(row.sessionId)) {
				this.forkTitleInFlight.add(row.sessionId);
				void this.healForkTitle(row.sessionId);
			}
			const parentTitle = titleById.get(row.parentSessionId);
			if (typeof parentTitle === 'string' && parentTitle.length > 0) row.title = parentTitle;
		}
		return { items };
	}

	/**
	 * The child's REAL title via its follow snapshot (2026-09-14): opening
	 * the session/follow stream makes the host read the child's FULL ledger
	 * and answer a snapshot whose projections block carries the folded
	 * title — exactly what the panel shows once the session attaches. This
	 * deliberately replaces an earlier session/page walk: paginate's window
	 * is min(throughSeq+1, beforeSeq) and throughSeq -1 names NO seq, so
	 * every page combination for a cold child whose cursor is unknown comes
	 * back empty — the page RPC simply cannot serve this read without a
	 * known through seq. Subscribing is heavier than one unary call but
	 * bounded (ring capacity per child) and idempotent with every other
	 * follow consumer. Fail-soft: any failure leaves the row on the parent
	 * fallback.
	 */
	private async healForkTitle(sessionId: string): Promise<void> {
		try {
			const block = await this.conn.downlinks.waitForProjections(sessionId);
			const title = block?.values?.['title'];
			if (typeof title === 'string' && title.length > 0) this.forkTitleHints.set(sessionId, title);
		} catch (error) {
			this.conn.log('dsh-connection: fork-title follow-baseline read failed for ' + sessionId, error);
		} finally {
			this.forkTitleInFlight.delete(sessionId);
		}
	}

	/**
	 * The workspace-RPC OWNER for a session (2026-09-10): the host keys
	 * workspaceFiles by the OWNING agent session and refuses sub-agent ids
	 * (session/not-found / agent-busy — a sub-agent session is not an RPC
	 * address). A sub-agent's workspace IS its root ancestor's, so walk the
	 * parentSessionId chain (session.list) to the root; a root session
	 * resolves to itself. Cycles guard themselves.
	 */
	async workspaceOwnerSessionId(sessionId: string): Promise<string> {
		const { items } = await this.listSessions();
		const parentOf = new Map(
			items.map((s) => [s.sessionId, (s as { parentSessionId?: string | null }).parentSessionId ?? null])
		);
		let cursor = sessionId;
		const seen = new Set<string>();
		while (!seen.has(cursor)) {
			seen.add(cursor);
			const parent = parentOf.get(cursor);
			if (!parent || parent === cursor) break;
			cursor = parent;
		}
		return cursor;
	}

	/** Raw session/list rows (0.1.2) — projections.asOfSeq drives page calls. */
	async rawListSessions(): Promise<RawSessionRow[]> {
		const raw = (await this.conn.rpc(DSH_METHODS.list, DSH_ARGS.list())) as { items?: RawSessionRow[] };
		const rows = Array.isArray(raw?.items) ? raw.items : [];
		for (const row of rows) this.foldSubagentHint(row);
		return rows;
	}

	/**
	 * Fold one list row's subagent identity into the hint cache. Only rows
	 * the host stamps `origin:'subagent'` with a readable parent and a
	 * descriptor lifecycle mode land here; a half-readable row keeps no hint
	 * so the host's own rejection (surfaced honestly downstream) names the
	 * truth instead of DSI guessing a mode.
	 */
	private foldSubagentHint(row: RawSessionRow): void {
		if (row.origin !== 'subagent') return;
		if (typeof row.parentSessionId !== 'string' || row.parentSessionId === '') return;
		const identity = row.projections?.values?.['subagent'];
		const mode =
			identity !== null && typeof identity === 'object'
				? (identity as { mode?: unknown }).mode
				: undefined;
		if (mode !== 'one-shot' && mode !== 'continuable') return;
		this.subagentHints.set(row.sessionId, { parentSessionId: row.parentSessionId, mode });
	}

	/**
	 * The session/page + session/follow address for one session id: the
	 * parent-addressed subagent form when a hint is folded, else the plain
	 * session form. Subagent child ids are bare UUIDs (the spawner mints
	 * `SessionId(randomUUID())`) — the id's SHAPE is never a discriminator;
	 * only the host row's origin is.
	 */
	addressFor(sessionId: string): Record<string, unknown> {
		const hint = this.subagentHints.get(sessionId);
		if (hint === undefined) return { kind: 'session', sessionId };
		return {
			kind: 'subagent',
			parentSessionId: hint.parentSessionId,
			childSessionId: sessionId,
			mode: hint.mode
		};
	}

	/**
	 * The tail-page through-cursor (0.1.2 session/page `throughSeq`). The
	 * list projection's watermark (asOfSeq) is the LOWEST served-projection
	 * row seq (session-projection-cache cachedSnapshot) and FREEZES while no
	 * projection updates — mid-turn it sat at the last projection-relevant
	 * event while the follow stream ran dozens of seqs ahead, so a page cut
	 * there ended below the live truth, rewound the client's mark, and
	 * pinned every later poll into a gap→resync loop. The follow buffer's
	 * cursor IS the host's stream truth (seeded by the host's own snapshot
	 * cursor, advanced only by host events), so a subscribed session pages
	 * through it; the watermark stays the fallback for sessions without a
	 * buffer (never subscribed — the pre-2026-09 behavior).
	 *
	 * A session the list does not name at all, and a listed row whose served
	 * projection carries no cursor, both page with `throughSeq: -1` — the
	 * 0.1.3 wire's unconstrained tail-page form (validated ≥ −1; the page is
	 * bounded by its own cursor, never by ours). The HOST still owns every
	 * refusal: a missing session rejects session/not-found before the cursor
	 * is read (the cold load's 404 branch), never a client-invented error.
	 *
	 * 0.1.3-alpha.1: cold fork children serve `asOfSeq: -1` (the host's cold
	 * blank-probe left with the v2 list projection) — a negative watermark is
	 * "no served cursor", not "below the ledger head".
	 */
	private async pageCursorFor(sessionId: string): Promise<number> {
		const live = this.conn.sessions.bufferFor(sessionId).lastSeq;
		if (live >= 0) return live;
		const row = (await this.rawListSessions()).find((r) => r.sessionId === sessionId);
		const throughSeq = row?.projections?.asOfSeq;
		if (typeof throughSeq === 'number' && throughSeq >= 0) return throughSeq;
		return -1;
	}

	/**
	 * session.history successor (0.1.2): the tail page via `session/page`.
	 * throughSeq comes from pageCursorFor: the follow buffer's cursor when
	 * the session has one, else the session/list projections (asOfSeq) of
	 * the same session, else −1 — the 0.1.3 unconstrained tail-page form.
	 */
	async history(sessionId: string): Promise<DshHistoryPage> {
		const throughSeq = await this.pageCursorFor(sessionId);
		return this.pageAsHistory(
			await this.conn.rpc(
				DSH_METHODS.page,
				DSH_ARGS.page({ address: this.addressFor(sessionId), throughSeq })
			)
		);
	}

	/** Workspace registry adoption (2026-08-23, DSH parity): the Add
	 *  workspace button's host call. Raw view passthrough — DSI renders
	 *  only title/path; ordering and session membership stay host-owned. */
	async createWorkspace(path: string): Promise<DshWorkspaceCreateResult> {
		return (await this.conn.rpc(
			DSH_METHODS.workspaceCreate,
			DSH_ARGS.workspaceCreate({ path })
		)) as DshWorkspaceCreateResult;
	}

	/** Workspace rename (Chip Menu ADR D3): {request:{workspaceId,title}}
	 *  → the updated Workspace view. Refusals throw DshRpcError
	 *  (workspace/not-found, workspace/name-conflict). No cache mutation —
	 *  the workspace/follow upsert frame owns the registry (ADR D6). */
	async renameWorkspace(workspaceId: string, title: string): Promise<DshWorkspaceCreateResult> {
		return (await this.conn.rpc(
			DSH_METHODS.workspaceRename,
			DSH_ARGS.workspaceRename(workspaceId, title)
		)) as DshWorkspaceCreateResult;
	}

	/** Workspace delete (Chip Menu ADR D3): {request:{workspaceId}} → the
	 *  removed id. The host removes ONLY the registry row (sessions survive,
	 *  ungrouped); the workspace/follow remove frame owns the registry
	 *  (ADR D6) — no local mutation here. */
	async deleteWorkspace(workspaceId: string): Promise<{ workspaceId: string }> {
		return (await this.conn.rpc(
			DSH_METHODS.workspaceDelete,
			DSH_ARGS.workspaceDelete(workspaceId)
		)) as { workspaceId: string };
	}

	/**
	 * workspaceFiles/read — one page of a UTF-8 text file inside the
	 * session's workspace (Workspace Explorer W2 task 2.1). Flat args
	 * {workspaceFileScopeId, path, range} per the descriptor — NO request
	 * wrapper (scope wire renamed from agentId, host 2026-09-09).
	 * Host refusals (not-found, outside-workspace, too-large, not-text,
	 * not-regular-file) reject as DshRpcError; the route maps the codes.
	 *
	 * @param sessionId - owning session; the host confines the read to its
	 *                    workspace root by containment, never prefix match.
	 * @param path - workspace path, absolute or root-relative.
	 * @param range - line window; omitted fields take the host's page defaults.
	 */
	async readWorkspaceFile(
		sessionId: string,
		path: string,
		range?: { offset?: number; limit?: number }
	): Promise<DshWorkspaceFileText> {
		return (await this.conn.rpc(
			DSH_METHODS.workspaceFileRead,
			DSH_ARGS.workspaceFileRead(sessionId, path, range)
		)) as DshWorkspaceFileText;
	}

	/**
	 * workspaceFiles/readBytes — one byte window of a workspace file, raw
	 * bytes (base64 receipt), no text decoding and no binary refusal
	 * (2026-09-10: binary previews such as images read through this; read
	 * refuses them workspace-file/not-text).
	 *
	 * @param sessionId - owning session; the host confines the read to its
	 *                    workspace root by containment.
	 * @param path - workspace path, absolute or root-relative.
	 * @param range - byte window {offset, length}; omitted fields take the
	 *                    host's window defaults.
	 */
	async readWorkspaceFileBytes(
		sessionId: string,
		path: string,
		range?: { offset?: number; length?: number }
	): Promise<DshWorkspaceFileBytes> {
		return (await this.conn.rpc(
			DSH_METHODS.workspaceFileReadBytes,
			DSH_ARGS.workspaceFileReadBytes(sessionId, path, range)
		)) as DshWorkspaceFileBytes;
	}

	/**
	 * workspaceFiles/list — one directory level inside the session's
	 * workspace (Workspace Explorer bugfix 2026-09-09: the picker's
	 * directoryPicker/list is native-only on real hosts — the LIVE tree
	 * lists through this session-authorized namespace instead). Flat args
	 * {workspaceFileScopeId, path}; path is workspace-relative, '' = the root.
	 */
	async listWorkspaceDirectory(sessionId: string, path: string): Promise<DshWorkspaceDirectoryListing> {
		return (await this.conn.rpc(
			DSH_METHODS.workspaceFileList,
			DSH_ARGS.workspaceFileList(sessionId, path)
		)) as DshWorkspaceDirectoryListing;
	}

	/**
	 * host.listDirectory — one browsed directory level for the Add-workspace
	 * folder picker (DSH parity: the directory-picker browse capability).
	 * Absent path lists the host home directory. Conservative normalize:
	 * garbage rows drop out, never throw, never invent data.
	 */
	async listDirectory(path?: string): Promise<DsiDirectoryListing> {
		const raw = (await this.conn.rpc(DSH_METHODS.listDirectory, DSH_ARGS.listDirectory(path))) as {
			path?: unknown;
			home?: unknown;
			crumbs?: unknown;
			entries?: unknown;
			truncated?: unknown;
		};
		const entry = (v: unknown): DsiDirectoryEntry | null => {
			if (v === null || typeof v !== 'object') return null;
			const e = v as { name?: unknown; path?: unknown; hidden?: unknown };
			if (typeof e.name !== 'string' || typeof e.path !== 'string') return null;
			return { name: e.name, path: e.path, hidden: e.hidden === true };
		};
		const rows = (v: unknown): DsiDirectoryEntry[] =>
			Array.isArray(v)
				? v.flatMap((x) => {
						const e = entry(x);
						return e ? [e] : [];
					})
				: [];
		return {
			path: typeof raw?.path === 'string' ? raw.path : '',
			home: typeof raw?.home === 'string' ? raw.home : '',
			crumbs: rows(raw?.crumbs),
			entries: rows(raw?.entries),
			truncated: raw?.truncated === true
		};
	}

	/**
	 * host.pickDirectory — the NATIVE interaction: the host opens one OS
	 * chooser on its own display and resolves the picked absolute path
	 * (null = operator cancelled). The signal follows the caller — a
	 * disconnected browser closes the host's dialog mid-choice
	 * (api-proxy pickDirectory's carrier contract).
	 */
	/**
	 * Wave 3 (task 3.2) — session.attachment: the session-authorized durable
	 * image read. Returns the ref plus canonical base64 data; host refusals
	 * (unknown id, foreign session) reject as DshRpcError → 502 upstream.
	 *
	 * @param sessionId - owning session (authorization scope).
	 * @param attachmentId - durable content-addressed id from an ImageBlock.
	 */
	async readAttachment(sessionId: string, attachmentId: string): Promise<DshAttachmentValue> {
		return (await this.conn.rpc(
			DSH_METHODS.attachment,
			DSH_ARGS.attachment({ sessionId, attachmentId })
		)) as DshAttachmentValue;
	}

	async pickDirectory(signal?: AbortSignal): Promise<{ path: string | null }> {
		// The wire value IS the picked absolute path (bare string), or null on
		// operator cancel (DirectoryPickerController.pick) — NOT an object
		// carrying it. Reading `.path` off the string answered null for every
		// successful pick, so the panel closed as if the operator had cancelled
		// (2026-09-11 bug: native Add-workspace flow went silently nowhere).
		const raw = (await this.conn.rpc(DSH_METHODS.pickDirectory, DSH_ARGS.pickDirectory(), signal)) as unknown;
		return { path: typeof raw === 'string' && raw.length > 0 ? raw : null };
	}

	/**
	 * POC-2 W3 — session.history PAGE ending at beforeSeq−1 (ledger truth, BC-4).
	 * Live-probed semantics (PRD §1.2): the page covers events with seq <
	 * beforeSeq; hasMore=false at the ledger head. Drives load-older paging —
	 * the ring buffer is freshness-only and never consulted here.
	 */
	async historyPage(sessionId: string, beforeSeq: number): Promise<DshHistoryPage> {
		const throughSeq = await this.pageCursorFor(sessionId);
		return this.pageAsHistory(
			await this.conn.rpc(
				DSH_METHODS.page,
				DSH_ARGS.page({ address: this.addressFor(sessionId), throughSeq, beforeSeq })
			)
		);
	}

	/** Adapt a 0.1.2 SessionPage {records,hasMore} to the DshHistoryPage shape. */
	private pageAsHistory(raw: unknown): DshHistoryPage {
		const page = raw as {
			records?: unknown[];
			hasMore?: boolean;
			projections?: RawSessionProjections;
		};
		const records = Array.isArray(page?.records) ? page.records : [];
		const events = expandRecords(records as Array<{ type: string; event?: DshSessionEventLike }>);
		// 2026-09-16 chip-hidden bug fix: the TAIL page's projections block
		// (the permissions/imageLimits/goal baselines, DSH's own client seeds
		// from the same block) rode the wire but was dropped here — every
		// projection seeded from the cold load read undefined. Raw passthrough:
		// the ingesters (permission-state et al) own the validation.
		return {
			events: events.map((event) => ({ event })),
			hasMore: page?.hasMore === true,
			...(page?.projections !== undefined ? { projections: page.projections } : {})
		};
	}

	/**
	 * POC-2 W3 — session.create {cwd?, agentPreset?} → {sessionId, …}.
	 * Live-probed round-trip 2026-08-21 (probe7 → real session id).
	 */
	async createSession(
		cwd?: string,
		agentPreset?: string
	): Promise<{ sessionId: string; agentPreset?: string }> {
		return (await this.conn.rpc(
			DSH_METHODS.create,
			DSH_ARGS.create({ ...(cwd === undefined ? {} : { cwd }), ...(agentPreset === undefined ? {} : { agentPreset }) })
		)) as {
			sessionId: string;
			agentPreset?: string;
		};
	}

	/**
	 * session/fork {request:{sessionId,atSeq?}} → {sessionId} — the fork child
	 * (The Fork Button ADR, 2026-09-01). An undefined atSeq is OMITTED from the
	 * args, never sent as null: the host then cuts at the source's last
	 * completed turn (host-enforced; see DSH_METHODS.fork for the pinned
	 * contract and refusals).
	 */
	async forkSession(sessionId: string, atSeq?: number): Promise<{ sessionId: string }> {
		return (await this.conn.rpc(
			DSH_METHODS.fork,
			DSH_ARGS.fork({
				sessionId,
				...(atSeq === undefined ? {} : { atSeq })
			})
		)) as { sessionId: string };
	}

	/**
	 * POC-2 W3 — agentPreset.list → {presets:[…]} (live-probed 2026-08-21,
	 * rpc-map.ts line 54). Presets are the picker's only source of truth.
	 * The shipped-preset English overlay honors ~/.dsi/settings.yaml
	 * `dsh.presetEnglish` (default true; read live per call — no cache, so
	 * an operator edit applies on the next fetch without a restart).
	 */
	async listPresets(): Promise<{ presets: DshPreset[] }> {
		const overlayEnglish = readDshPresetEnglishConfig().presetEnglish;
		const raw = (await this.conn.rpc(DSH_METHODS.presets, DSH_ARGS.presets())) as { presets?: unknown };
		const presets = Array.isArray(raw?.presets) ? raw.presets : [];
		return { presets: presets.map((row) => normalizePreset(row as RawPresetRow, overlayEnglish)) };
	}

	/**
	 * session.prompt — returns after the receipt only (BC-3 boundary lives
	 * upstream). Wave 2: a string payload still maps to exactly one text
	 * part (byte-identical for every pre-existing caller); a content array
	 * passes through verbatim — the route owns validation and ordering
	 * (buildPromptContent, images first, text last).
	 */
	async prompt(
		sessionId: string,
		payload: string | readonly DshPromptContent[],
		mode: 'queue' | 'steer' = 'queue'
	): Promise<{ accepted: boolean }> {
		const content = typeof payload === 'string' ? [{ type: 'text' as const, text: payload }] : payload;
		// 0.1.2: requestId is client-minted (SessionRequestId) and persisted on
		// the accepted user message; rpcId factory doubles as its source.
		return (await this.conn.rpc(
			DSH_METHODS.prompt,
			DSH_ARGS.prompt({
				requestId: this.conn.rpcIdFactory(),
				sessionId,
				mode,
				content,
				clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			})
		)) as { accepted: boolean };
	}

	/**
	 * commands/execute (2026-08-25 fix) — the NATIVE slash-command surface the
	 * host's own web GUI uses (Typert Gateway remote; session.prompt has no
	 * slash interception — the 2026-08-25 RCA). Executes one line on the
	 * session's agent; the host durably logs command/run + command/done (and
	 * the permission command appends its knob events — the poll fold's
	 * confirmation). Returns null on an admission miss (the line named no
	 * registered command): ok:true, the command never ran — the honest
	 * receipt callers must distinguish from a success.
	 */
	async executeCommand(sessionId: string, line: string): Promise<DshCommandReceipt | null> {
		const value = (await this.conn.rpc(
			DSH_METHODS.commandExecute,
			DSH_ARGS.commandExecute(sessionId, line, [])
		)) as DshCommandReceipt | undefined;
		return value ?? null;
	}

	/**
	 * commands/list (Slash Menu W1, task 1.2) — the host's command catalog,
	 * name-sorted rows {name, description, input?{hint, images?}}. Live-pinned
	 * 2026-08-30 (see tests/unit/dsh-rpc.test.ts): agentId IS the sessionId.
	 * May resume a cold session on the host — callers fetch on first menu
	 * open, never on panel mount (ADR §3.3).
	 */
	async listCommands(sessionId: string): Promise<DshCommandRow[]> {
		return (await this.conn.rpc(DSH_METHODS.commandsList, DSH_ARGS.commandsList(sessionId))) as DshCommandRow[];
	}

	/**
	 * skills/list (Slash Menu W1, task 1.2) — the session's user-invocable
	 * skill catalog {skills:[{name, description, whenToUse?, modelInvocable}]}.
	 * Live-pinned 2026-08-30. Never activates a cold session — the menu may
	 * read it freely on first open.
	 */
	async listSkills(sessionId: string): Promise<DshSkillList> {
		return (await this.conn.rpc(DSH_METHODS.skillsList, DSH_ARGS.skillsList(sessionId))) as DshSkillList;
	}

	/** session.cancel */
	async cancel(sessionId: string): Promise<{ accepted: boolean }> {
		return (await this.conn.rpc(DSH_METHODS.cancel, DSH_ARGS.cancel({ sessionId }))) as { accepted: boolean };
	}

	// ── Jobs (ADR-0026 D2/D3, Job Badge Wave 1) ──────────────────────────

	/**
	 * Subscribe to per-session job roster pushes (mux frame fan-out). Returns
	 * the unsubscribe — the roster store's unwatch MUST call it, or the
	 * listener outlives its row (ADR give-up: streams are refcounted).
	 */
	onJobRoster(listener: JobRosterListener): () => void {
		this.jobRosterListeners.add(listener);
		return () => this.jobRosterListeners.delete(listener);
	}

	/**
	 * Deliver one whole-set roster frame to listeners. Called by the mux push
	 * path (dsh-connection frame switch); a frame REPLACES the session's set —
	 * consumers overwrite, never merge (host JobListFrame contract).
	 */
	dispatchJobRoster(sessionId: string, jobs: readonly DsiJobView[]): void {
		for (const listener of this.jobRosterListeners) listener(sessionId, jobs);
	}

	// ── Jobs — the Follow Relay (ADR-0035 D4) ────────────────────────────

	/** Lazy singleton: one relay over the downlink job/follow transport. */
	private jobFollowRelay: JobFollowRelay | null = null;

	private ensureJobFollowRelay(): JobFollowRelay {
		if (this.jobFollowRelay === null) {
			const downlinks = this.conn.downlinks;
			this.jobFollowRelay = new JobFollowRelay({
				open: (owner, jobId) => downlinks.openJobFollowStream(owner, jobId),
				close: (owner, jobId) => downlinks.closeJobFollowStream(owner, jobId)
			});
		}
		return this.jobFollowRelay;
	}

	/** Subscribe one browser sink to a job's follow stream (SSE route). */
	subscribeJobFollow(owner: string, jobId: string, sink: FollowSink): () => void {
		return this.ensureJobFollowRelay().subscribe(owner, jobId, sink);
	}

	/** The owners with at least one live follow (mux generation reopen). */
	jobFollowOwners(): string[] {
		return this.jobFollowRelay === null ? [] : this.jobFollowRelay.owners();
	}

	/** The job ids one owner follows live (mux generation reopen). */
	jobFollowJobsOf(owner: string): string[] {
		return this.jobFollowRelay === null ? [] : this.jobFollowRelay.jobsOf(owner);
	}

	/** Mux demux path: one jobfollow item to the relay's sinks. */
	onJobFollowItem(owner: string, jobId: string, value: unknown): void {
		this.jobFollowRelay?.onFrame(owner, jobId, value);
	}

	/** Mux demux path: one jobfollow stream error to the relay's sinks. */
	onJobFollowStreamError(owner: string, jobId: string, code?: string, message?: string): void {
		this.jobFollowRelay?.onError(owner, jobId, code, message);
	}

	// ── Jobs — the Roster Mirror (ADR 2026-10-17 D1–D3) ──────────────────

	/** Wire the open/close transports (called once by DshConnection). */
	wireJobRosterTransport(transport: {
		open: (sessionId: string) => void;
		close: (sessionId: string) => void;
	}): void {
		this.jobRosterTransport = transport;
	}

	/**
	 * One browser poll tick — the HTTP-native watch (D2): touch liveness and
	 * make sure the session's job/list stream is open. The browser store's
	 * refcounted watch lifecycle expresses itself here as a 2s heartbeat;
	 * silence past the grace window is the unwatch.
	 */
	touchJobRoster(sessionId: string): void {
		this.jobRosterTouch.set(sessionId, Date.now());
		if (!this.jobRosterOpened.has(sessionId)) {
			this.jobRosterOpened.add(sessionId);
			this.jobRosterTransport?.open(sessionId);
		}
		this.armJobRosterReaper();
	}

	/** Arm the reaper lazily; it disarms itself when no session is watched. */
	private armJobRosterReaper(): void {
		if (this.jobRosterReapTimer !== undefined) return;
		this.jobRosterReapTimer = setInterval(
			() => this.reapJobRosters(),
			Math.max(1_000, Math.floor(this.jobRosterGraceMs / 2))
		);
		this.jobRosterReapTimer.unref?.();
	}

	/** Close streams (and drop their caches) for sessions not polled within the grace. */
	reapJobRosters(now = Date.now()): void {
		for (const [sessionId, last] of this.jobRosterTouch) {
			if (now - last <= this.jobRosterGraceMs) continue;
			this.jobRosterTouch.delete(sessionId);
			this.jobRosterCache.delete(sessionId);
			this.jobRosterFailureLogged.delete(sessionId);
			this.jobRosterOpened.delete(sessionId);
			this.jobRosterTransport?.close(sessionId);
		}
		if (this.jobRosterTouch.size === 0 && this.jobRosterReapTimer !== undefined) {
			clearInterval(this.jobRosterReapTimer);
			this.jobRosterReapTimer = undefined;
		}
	}

	/**
	 * One job/list stream item — a whole-set frame (the host frames on open,
	 * then per coalesced commit burst; typert.host.js contract). Replaces the
	 * session's mirror and fans out to the roster listeners.
	 */
	onJobRosterItem(sessionId: string, value: unknown): void {
		if (sessionId === '') return;
		const raw = value as { jobs?: unknown } | unknown[] | null;
		const jobs = Array.isArray(raw)
			? (raw as DsiJobView[])
			: Array.isArray((raw as { jobs?: unknown } | null)?.jobs)
				? ((raw as { jobs: DsiJobView[] }).jobs)
				: null;
		if (jobs === null) return;
		this.jobRosterCache.set(sessionId, { jobs });
		this.dispatchJobRoster(sessionId, jobs);
	}

	/** Stream-level failure — logged once per session per watch (D3). */
	onJobRosterStreamError(sessionId: string, code: string | undefined, message: string | undefined): void {
		// Self-heal: the next poll touch reopens the dead stream.
		this.jobRosterOpened.delete(sessionId);
		if (sessionId === '' || this.jobRosterFailureLogged.has(sessionId)) return;
		this.jobRosterFailureLogged.add(sessionId);
		this.conn.log('dsh-connection: job/list stream failed', sessionId, code, message);
	}

	/**
	 * The mirror's answer for one session: the cached frame, or an honest
	 * pending (D3) — unknown is not empty. Replaces the retired unary
	 * job/list call (RCA 2026-10-17: the host refuses unary on a stream-only
	 * method).
	 */
	jobRosterSnapshot(sessionId: string): { jobs: DsiJobView[]; pending: boolean } {
		const cached = this.jobRosterCache.get(sessionId);
		return cached ? { jobs: cached.jobs, pending: false } : { jobs: [], pending: true };
	}

	/**
	 * job.kill passthrough — the human's ONLY direct job verb (ADR fact 6:
	 * starting is always the owner Agent's tool call). The fence stays
	 * server-side: DSI sends the caller's sessionId verbatim and surfaces a
	 * refusal (belongs to another session) instead of masking it.
	 */
	async jobKill(sessionId: string, jobId: string): Promise<DsiJobKillResult> {
		return (await this.conn.rpc(
			DSH_METHODS.jobKill,
			DSH_ARGS.jobKill(sessionId, jobId)
		)) as DsiJobKillResult;
	}

	/**
	 * POC-3 W3 (3.1) — session.rename {sessionId, title}.
	 *
	 * Appends a session/title event with the `user` source — pins the title
	 * against automatic regeneration (sessions.ts rename doc). The host
	 * normalizes; a title that normalizes to empty fails `title-invalid` (an
	 * RpcError → 502 upstream). Session-backed subagents reject `agent-busy`.
	 */
	async renameSession(sessionId: string, title: string): Promise<RenameResult> {
		return (await this.conn.rpc(DSH_METHODS.rename, DSH_ARGS.rename({ sessionId, title }))) as RenameResult;
	}

	/**
	 * POC-3 W3 (3.2) — session.models {sessionId} → the model directory.
	 *
	 * Provider lookups run independently on the host (sessions.ts): `groups`
	 * are successfully-loaded catalogs, `failures` are provider-local
	 * diagnostics — successful groups remain usable. Garbage-safe normalize
	 * below never throws (task 3.2-T: garbage catalog → empty, not an error).
	 */
	async listModels(_sessionId: string): Promise<DsiModelDirectory> {
		void _sessionId;
		// 0.1.2: session.models → session/modelCatalog (host-generation,
		// no per-session argument).
		const raw = (await this.conn.rpc(DSH_METHODS.modelCatalog, DSH_ARGS.modelCatalog())) as unknown;
		return normalizeModelDirectory(raw);
	}

	/**
	 * POC-3 W3 (3.2) — session.selectModel {sessionId, provider, model,
	 * reasoningEffort?} → {selected: ModelSelection}. Catalog membership is
	 * advisory on the host — an exact-route selection still validates the
	 * effort. Subagents reject `session/agent-busy` (RpcError → 502 upstream).
	 */
	async selectModel(
		sessionId: string,
		provider: string,
		model: string,
		reasoningEffort?: string
	): Promise<DsiModelSelection | null> {
		const raw = (await this.conn.rpc(
			DSH_METHODS.selectModel,
			DSH_ARGS.selectModel({
				sessionId,
				provider,
				model,
				...(reasoningEffort !== undefined ? { reasoningEffort } : {})
			})
		)) as { selected?: unknown };
		// Garbage-safe even on the receipt: a malformed selection normalizes
		// to null — the route passes it through honestly, never invents data.
		return normalizeModelSelection(raw?.selected);
	}

	/**
	 * POC-3 W1 — answer a pending approval/question via the dedicated
	 * client-response carrier (POST /api/respond). NOT a unary method: no
	 * DSH_METHODS entry, no rpcId minted here — the rpcId is the REQUEST's
	 * stable id (registry key), echoed in the envelope. Receipt is a union,
	 * not ok/error: {accepted:false, reason} is a SUCCESSFUL exchange (BC-B
	 * upstream maps it to 200 + settle-elsewhere). Transport failure still
	 * throws (route maps to 503 — card stays answerable, lock released).
	 */
	/**
	 * POC-3 W1 → 0.1.2: an answer is a `$events/result` unary RPC
	 * {clientId, eventId, outcome} returning to the SAME generation whose
	 * $events stream delivered the waterfall (rpcId = the eventId DSI
	 * registered the card under). The outcome's `value` is the waterfall
	 * listener's RETURN VALUE, and the host consumes it verbatim — a
	 * question's value must BE the AskUserQuestionAnswer `{answers:[…]}`
	 * (the live host crashes the tool on any other shape, losing the
	 * answer); an approval's value is the outcome string. The panel's
	 * legacy `{sessionId, answer:{answers}}` wrapper is unwrapped here so
	 * the wire carries the host's contract, not the panel's convenience.
	 */
	async respond(rpcId: string, payload: Record<string, unknown>): Promise<RespondReceipt> {
		if (this.conn.downlinks.eventClientId === null) {
			throw new Error('dsh-connection: no $events generation to answer through yet');
		}
		// Legacy payloads carried {sessionId, outcome|answers}; the panel
		// sends questions as {sessionId, answer:{answers}}. All three arms
		// normalize to what the host's answerer waterfall must resolve with.
		const { sessionId, ...rest } = payload;
		void sessionId;
		const value =
			rest.outcome !== undefined
				? rest.outcome
				: rest.answer !== undefined
					? rest.answer
					: rest.answers !== undefined
						? { answers: rest.answers }
						: rest;
		try {
			await this.sendEventResult(rpcId, value);
			this.forgetAnswered(rpcId, value);
		} catch (err) {
			// 0.1.2-alpha.2+ wire truth: a LOST RACE is an idempotent no-op —
			// the gateway answers ok:true and swallows a result for an event
			// that already settled (or a delivery that is no longer ours), so
			// this arm cannot fire on current hosts. It stays for hosts that
			// still refuse through the answer door; the "answered elsewhere"
			// verdict now arrives as the settlement broadcast, not a receipt.
			if (err instanceof DshRpcError && err.code === 'not-pending') {
				return { accepted: false, reason: 'not-pending' };
			}
			// The gateway rejects answers naming a generation that already
			// ended (the mux rebuilt since the question was delivered — the
			// first click after such a rebuild always failed this way).
			// Self-heal: rebuild NOW and retry once; the host replays
			// still-pending waterfalls into the new generation, so the same
			// eventId stays answerable there. (0.1.2-alpha.2 renamed the
			// gateway's assembly failures from `internal` to `gateway/internal`
			// — the message text is unchanged.)
			if (
				err instanceof DshRpcError
				&& err.code === 'gateway/internal'
				&& err.message.includes('no active event stream')
			) {
				const previous = this.conn.downlinks.eventClientId;
				if (previous !== null && (await this.refreshEventGeneration(previous))) {
					await this.sendEventResult(rpcId, value);
					this.forgetAnswered(rpcId, value);
					return { accepted: true };
				}
			}
			throw err;
		}
		return { accepted: true };
	}

	/**
	 * Authenticated GET of one Host path (Edited-Files Card transport,
	 * 2026-09-25 — the changes.summary route's arm; Transport Probe note).
	 * Same cookie ladder as rpc(): mint-or-reuse, ONE 401 re-mint retry,
	 * then the response object as-is — the caller owns status mapping.
	 */
	async fetchHostPath(path: string, signal?: AbortSignal): Promise<Response> {
		const attempt = async (): Promise<Response> => {
			const cookie = await this.conn.auth.ensureCookie();
			return this.conn.fetchFn(`${this.conn.baseUrl}${path}`, {
				method: 'GET',
				headers: cookie === null ? {} : { cookie },
				...(signal !== undefined ? { signal } : {})
			});
		};
		let response = await attempt();
		if (response.status === 401) {
			this.conn.auth.invalidate();
			response = await attempt();
		}
		return response;
	}

	/** One $events/result answer under the CURRENT generation's clientId. */
	private sendEventResult(rpcId: string, value: unknown): Promise<void> {
		return this.conn.rpc(
			REMOTE_EVENT_RESULT_ENDPOINT,
			{
				clientId: this.conn.downlinks.eventClientId,
				eventId: rpcId,
				outcome: { kind: 'result', value }
			} as unknown as Record<string, unknown>
		).then(() => undefined);
	}

	/**
	 * Rebuild the mux generation immediately (bypassing the reconnect
	 * ladder) and wait until a NEW $events ready frame lands or the deadline
	 * expires. Returns true only when a fresh clientId was observed — the
	 * caller may retry an answer against it.
	 */
	private async refreshEventGeneration(previousClientId: string): Promise<boolean> {
		this.conn.log('dsh-connection: $events generation stale — rebuilding for the answer retry');
		this.conn.downlinks.cancelReconnect();
		this.conn.downlinks.teardownSockets();
		this.conn.downlinks.ensureDownlinks();
		const deadline = Date.now() + this.staleGenerationRetryMs;
		while (!this.conn.disposed && this.conn.downlinks.eventClientId === previousClientId && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return this.conn.downlinks.eventClientId !== previousClientId && this.conn.downlinks.eventClientId !== null;
	}

	/**
	 * Resync: replace the ring buffer with the ledger's tail page (BC-4).
	 * Returns the fresh entries so callers can hand them to the store.
	 */
	async resyncFromLedger(sessionId: string): Promise<DshSessionEvent[]> {
		const page = await this.history(sessionId);
		const events = (page.events ?? []).map((h) => h.event);
		const buf = this.conn.sessions.bufferFor(sessionId);
		buf.entries = [...events].slice(-this.ringCapacity());
		buf.lastSeq = events.length > 0 ? events[events.length - 1].seq : -1;
		// After a ledger replace the buffer is contiguous from its first entry
		// again (the ledger page is the truth; no hole below the tail).
		buf.coverageFloor = buf.entries[0]?.seq ?? buf.lastSeq;
		return buf.entries;
	}

	/** Teardown hook: transient registries never leak entries. */
	dispose(): void {
		clearTimeout(this.answerReapTimer);
		this.pendingAnswers.clear();
		this.settledAnswers.clear();
	}
}
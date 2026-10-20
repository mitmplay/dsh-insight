/**
 * dsh-connection — the transport singleton (BC-5) owning every wire byte to
 * the DSH Host (BC-6: it speaks only through dsh-rpc helpers and the two
 * downlink WebSocket paths).
 *
 * State model (PRD §3.5):
 *   mux  frames (session/subscribed, session/event) → per-session ring buffer
 *   host frames (host/session-status)               → per-session running map
 *   running map re-baselines from session.list at every generation open
 *   (2026-08-26): the host pushes status only on TRANSITIONS and sends no
 *   initial snapshot, so a downlink rebuilt mid-turn would otherwise never
 *   learn the session was already running.
 *   ring buffer = freshness only; the ledger (session.history) is the truth —
 *   cold loads and every resync re-read the ledger (BC-4).
 *
 * Generation semantics (guide Part 1): the two downlinks form one generation;
 * if either dies, both are rebuilt after backoff.
 */

import { dshBaseUrl } from '$lib/config';
import { readDshAuthConfig, readDshPresetEnglishConfig, readServerConfig } from './insight-config';
import type { DshAttachmentValue, DshCommandReceipt, DshCommandRow, DshHistoryEntry, DshPromptContent, DshSkillList, DshWorkspaceDirectoryListing, DshWorkspaceFileBytes, DshWorkspaceFileText } from './dsh-rpc';
import {
	DSH_ARGS,
	DSH_METHODS,
	DSH_REMOTE_MUX_WS_PATH,
	REMOTE_EVENT_RESULT_ENDPOINT,
	REMOTE_EVENT_STREAM_ENDPOINT,
	REMOTE_EVENT_STREAM_PAYLOAD,
	DshAuth,
	DshRpcError,
	encodeRespond,
	parseResponse,
	parseRespondReceipt,
	respondUrl,
	rpcUrl,
	type RespondReceipt
} from './dsh-rpc';

/** Ring buffer capacity per session (entries kept for delta polls).
 *  Config-tunable (2026-08-25): ~/.dsi/settings.yaml `server.ringCapacity`
 *  overrides at runtime — this constant is the FALLBACK default (and the
 *  unit-test value; ringCapacity() reads the live config per trim). */
export const RING_CAPACITY = 500;

/** Live capacity from ~/.dsi/settings.yaml (no cache — runtime edits
 *  apply, same contract as every other config section). */
function ringCapacity(): number {
	return readServerConfig().ringCapacity;
}

// ADR-0022 W4 (move-whole): the pending-answer/settlement registries and the
// catalog-invalidation listener registry live in connection/rpc-relay.ts.
export type { PendingAnswerFrame, AnswerSettlement, CatalogInvalidationListener } from './connection/rpc-relay';
import type { PendingAnswerFrame, AnswerSettlement, CatalogInvalidationListener } from './connection/rpc-relay';

export interface DshSessionEvent {
	type: string;
	seq: number;
	time: number;
	data?: Record<string, unknown>;
	/** Optional presentation view riding next to the event (render intent —
	 * bash declares {card:'terminal', title:command}; presentation.ts).
	 * Survives the ring buffer verbatim; dsh-events.callSummary reads
	 * view.view.title. Ledger-sourced pages already carried it (DshRawEvent). */
	view?: unknown;
}

/**
 * The host's live assistant-stream frames (0.1.3-alpha.1 follow channel,
 * `assistantStream: true`): browser wire form of one process-local model
 * attempt, interleaved with durable event entries on the same follow stream
 * in observation order. Frames carry NO seq — they are presentation state
 * and bypass the durable cursor bookkeeping. The raw `chunk` payload is one
 * StreamChunk as JSON (text-delta / reasoning-delta / tool-call-delta /
 * block-start / block-end / usage / finish).
 */
export type SessionAssistantStreamFrameLike = {
	type: 'start';
	attemptId: string;
	revision: number;
	startedAfterSeq: number;
	turn: number;
	step: number;
} | {
	type: 'chunk';
	attemptId: string;
	revision: number;
	/** Dense position — the host drops its own accumulator on any gap. */
	index: number;
	time: number;
	chunk: Record<string, unknown>;
} | {
	type: 'end';
	attemptId: string;
	revision: number;
	index: number;
	outcome:
		| { kind: 'committed'; eventType: 'assistant/message' | 'assistant/attempt'; seq: number }
		| { kind: 'abandoned' };
};

/** Follow-opening snapshot baseline (SessionAssistantStreamBaseline). */
export interface SessionAssistantStreamBaselineLike {
	revision: number;
	activeAttempt?: {
		attemptId: string;
		startedAfterSeq: number;
		turn: number;
		step: number;
		/** Dense position expected for the next live chunk frame. */
		nextIndex: number;
		/** Compact detached stream (AssistantStreamRecord[]) accumulated so far. */
		stream: Array<Record<string, unknown>>;
	};
}


/** Injectable transports — tests pass fakes; production uses globals. */
export interface DshConnectionOptions {
	baseUrl?: string;
	fetchFn?: typeof fetch;
	wsFactory?: (url: string, headers?: Record<string, string>) => WebSocketLike;
	/** Auth carrier override (tests); production mints from config's launch token. */
	auth?: DshAuth;
	rpcIdFactory?: () => string;
	backoffScheduleMs?: number[];
	/**
	 * Grace between a $events generation's ready frame and the
	 * still-pending replay reap (tests shrink it; production uses the
	 * wire-derived default — the replay follows ready within one stream
	 * drain, so the slack only absorbs scheduling jitter).
	 */
	answerReapGraceMs?: number;
	/**
	 * How long a stale-generation answer retry waits for the rebuilt
	 * generation's ready frame (tests shrink it; production default covers
	 * a local mux rebuild plus replay).
	 */
	staleGenerationRetryMs?: number;
	log?: (...args: unknown[]) => void;
}

/** Minimal WebSocket surface the connection consumes. */
export interface WebSocketLike {
	addEventListener(ev: 'open', fn: () => void): void;
	addEventListener(ev: 'message', fn: (e: { data: unknown }) => void): void;
	addEventListener(ev: 'error', fn: () => void): void;
	addEventListener(ev: 'close', fn: () => void): void;
	/** Send one logical-stream client message (0.1.2 remote.mux). */
	send?(data: string): void;
	close(): void;
}


let singleton: DshConnection | undefined;

/** The process-wide transport (BC-5). Creates lazily on first use. */
export function getDshConnection(opts: DshConnectionOptions = {}): DshConnection {
	singleton ??= new DshConnection({
		...opts,
		// Gated auth/transport trace (mint/retry paths are silent otherwise);
		// DSI_DSH_DEBUG=1 on the floor boot turns it on.
		log: opts.log ?? (process.env.DSI_DSH_DEBUG === '1' ? console.error : undefined)
	});
	return singleton;
}

/** Test hook: drop the singleton so the next get starts a fresh one. */
export function resetDshConnectionForTests(): void {
	singleton?.dispose();
	singleton = undefined;
}

export class DshConnection {
	readonly baseUrl: string;
	readonly fetchFn: typeof fetch;
	readonly wsFactory: (url: string, headers?: Record<string, string>) => WebSocketLike;
	readonly auth: DshAuth;
	rpcIdFactory: () => string;
	readonly backoff: number[];
	readonly log: (...args: unknown[]) => void;


	/**
	 * ADR-0022 W2 (move-whole): the session state machines — ring buffers,
	 * running map + seed races, live assistant-stream tails — live in
	 * connection/session-state.ts; the shell delegates.
	 */
	readonly sessions: SessionStateStore;
	/** ADR-0022 W3 (move-whole): the downlink generation lifecycle + frame
	 *  demux live in connection/downlinks.ts; the shell delegates. */
	readonly downlinks: DownlinkManager;
	/** ADR-0022 W4 (move-whole): the RPC relay + answer registry live in
	 *  connection/rpc-relay.ts; the shell delegates. */
	readonly relay: RpcRelay;
	disposed = false;

	constructor(opts: DshConnectionOptions = {}) {
		this.baseUrl = opts.baseUrl ?? dshBaseUrl();
		this.fetchFn = opts.fetchFn ?? fetch;
		this.wsFactory = opts.wsFactory
			?? ((url: string, headers?: Record<string, string>) =>
				new WebSocket(url, (headers === undefined ? undefined : { headers }) as never));
		this.auth = opts.auth ?? new DshAuth({ baseUrl: this.baseUrl, log: opts.log });
		this.rpcIdFactory =
			opts.rpcIdFactory ?? (() => crypto.randomUUID());
		this.backoff = opts.backoffScheduleMs ?? [1000, 2000, 5000, 10000, 30000];
		// Wire-derived default (not a deployment tunable): the host queues a
		// new generation's still-pending replay around its ready frame, so a
		// short drain of slack covers the ordering; only tests shrink it.
		const answerReapGraceMs = opts.answerReapGraceMs ?? 3000;
		const staleGenerationRetryMs = opts.staleGenerationRetryMs ?? 5000;
		this.log = opts.log ?? (() => {});
		this.sessions = new SessionStateStore({
			log: this.log,
			ringCapacity,
			listSessions: () => this.listSessions(),
			generation: () => this.downlinks.generation,
			disposed: () => this.disposed
		});
		this.downlinks = new DownlinkManager(this);
		this.relay = new RpcRelay(this, ringCapacity, { answerReapGraceMs, staleGenerationRetryMs });
		// The Roster Mirror's mux bridge (ADR 2026-10-17 D1/D2): the mirror
		// owns policy; the downlink manager owns the socket.
		this.relay.wireJobRosterTransport({
			open: (sessionId) => this.downlinks.openJobRosterStream(sessionId),
			close: (sessionId) => this.downlinks.closeJobRosterStream(sessionId)
		});
	}

	// ── Generation lifecycle (W3: connection/downlinks.ts owns the machine;
	//    thin delegates keep the public surface frozen) ───────────────────

	/** Open the stream generation (idempotent) — see DownlinkManager. */
	ensureDownlinks(): void {
		this.downlinks.ensureDownlinks();
	}

	/** Subscribe one session (0.1.2) — see DownlinkManager. */
	subscribe(sessionId: string): void {
		this.downlinks.subscribe(sessionId);
	}

	/** Per-session projection value (W2) — see DownlinkManager. */
	projectionValue(sessionId: string, key: string): unknown {
		return this.downlinks.projectionValue(sessionId, key);
	}

	/** The whole stored block for one session (null when absent). */
	projectionBlock(sessionId: string): RawSessionProjections | null {
		return this.downlinks.projectionBlock(sessionId);
	}

	/** Bounded wait for the session's FIRST projection baseline. */
	async waitForProjections(sessionId: string, timeoutMs = 2_500): Promise<RawSessionProjections | null> {
		return this.downlinks.waitForProjections(sessionId, timeoutMs);
	}

	/** The workspace registry — the AUTHORITY for DSI's workspace pills/chips. */
	async listWorkspaces(): Promise<{ items: DsiWorkspaceSummary[] }> {
		return this.downlinks.listWorkspaces();
	}











	// ── Frame dispatch ───────────────────────────────────────────────────






	private onMuxFrame(payload: unknown, rpcId?: string): void {
		// A delivered mux frame proves the generation is alive: the next drop
		// starts over at the first backoff rung.
		this.downlinks.reconnectAttempt = 0;
		const frame = payload as {
			type: string;
			sessionId?: string;
			lastSeq?: number;
			event?: DshSessionEvent;
		};
		switch (frame?.type) {
			case 'session/subscribed':
				if (typeof frame.sessionId === 'string') {
					this.sessions.seedBaseline(frame.sessionId, frame.lastSeq ?? -1);
				}
				return;
			case 'session/event':
				if (frame.sessionId && frame.event) {
					this.sessions.appendEvent(frame.sessionId, frame.event);
				}
				return;
			case 'approval/requested':
			case 'question/requested':
				this.relay.registerPending(frame, rpcId);
				return;
			case 'approval/resolved':
			case 'question/resolved':
				this.relay.registerSettlement(frame);
				return;
			default:
				// Job roster frames (Job Badge Wave 1, ADR-0026): the host's
				// job.list stream pushes whole-set frames — forward any job
				// frame carrying a jobs array to the relay's listener registry
				// (forward-compatible with the exact wire type name).
				if (
					typeof frame?.type === 'string' &&
					frame.type.startsWith('job/') &&
					Array.isArray((frame as { jobs?: unknown }).jobs)
				) {
					this.relay.dispatchJobRoster(
						String(frame.sessionId ?? ''),
						(frame as unknown as { jobs: never }).jobs
					);
					return;
				}
				// queue/jobs/projection/… — not ring-buffer state; ignored here
				this.log('dsh-connection: mux frame ignored', frame?.type);
		}
	}



	// ── Ring buffer ──────────────────────────────────────────────────────





	// ── Live assistant-stream tail (0.1.3-alpha.1) ───────────────────────




	// ── Public read API (used by api-dsh routes; W2 state machines live in
	// connection/session-state.ts — thin delegates keep the surface frozen) ─

	/** The session's live tail for the events poll, or null when no attempt
	 *  is in flight (0.1.3-alpha.1 live assistant-stream tail). */
	liveAssistantStream(sessionId: string): DsiLiveStreamTail | null {
		return this.sessions.liveAssistantStream(sessionId);
	}

	/** Delta slice: events with seq > n, plus current lastSeq/running. Wave 4.2:
	 *  the gap flag is true when the caller's since mark fell into a hole the
	 *  buffer no longer covers (mux drop) — the response carries the resync flag. */
	eventsSince(
		sessionId: string,
		n: number
	): { events: DshSessionEvent[]; lastSeq: number; running: boolean; gap: boolean } {
		return this.sessions.eventsSince(sessionId, n);
	}

	/** True when the session has a live baseline (subscribed at least once). */
	hasBaseline(sessionId: string): boolean {
		return this.sessions.hasBaseline(sessionId);
	}

	isRunning(sessionId: string): boolean {
		return this.sessions.isRunning(sessionId);
	}











	// ── Pending-answer registry (POC-3 W1 — BC-C idempotent by rpcId) ────










	// ── RPC forwards (all bytes via dsh-rpc helpers) ─────────────────────








































	// ── Transport plumbing ───────────────────────────────────────────────

	async rpc(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		// 0.1.2: payload is the args envelope {args:{…}} (assertExactArguments).
		const body = JSON.stringify({ type: 'client-request', rpcId: this.rpcIdFactory(), method, payload: { args: payload } });
		const attempt = async (): Promise<Response> => {
			const cookie = await this.auth.ensureCookie();
			return this.fetchFn(rpcUrl(this.baseUrl, method), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(cookie === null ? {} : { cookie })
				},
				body,
				...(signal !== undefined ? { signal } : {})
			});
		};
		let response = await attempt();
		if (response.status === 401) {
			// Fresh host process minted a new launch token requirement — one
			// re-mint with the CURRENT config token, one retry, then fail honest.
			this.auth.invalidate();
			const { authToken } = readDshAuthConfig();
			void authToken;
			response = await attempt();
		}
		if (!response.ok) {
			throw new Error(`dsh-connection: transport failure for ${method}: HTTP ${response.status}`);
		}
		const rpcId = (JSON.parse(body) as { rpcId: string }).rpcId;
		return parseResponse(await response.text(), rpcId);
	}

	// ── RPC relay + answer registry (W4: connection/rpc-relay.ts owns the
	//    machines; thin delegates keep the public surface frozen) ─────────

	/** Subscribe to catalog invalidations ($events arms + socket reset). */
	onCatalogInvalidated(listener: CatalogInvalidationListener): () => void {
		return this.relay.onCatalogInvalidated(listener);
	}

	/** Pending answers for a session (PollResponse extension). */
	pendingFor(sessionId: string): PendingAnswerFrame[] {
		return this.relay.pendingFor(sessionId);
	}

	/** Recent settlements for a session (ring: delivered-then-pruned). */
	settlementsFor(sessionId: string): AnswerSettlement[] {
		return this.relay.settlementsFor(sessionId);
	}

	/** Delivery hook: drop settlements the client has already seen. */
	pruneSettlements(sessionId: string, seenRpcIds: string[]): void {
		this.relay.pruneSettlements(sessionId, seenRpcIds);
	}

	/** Normalized session/list with fork-title healing. */
	async listSessions(): Promise<ListResult> {
		return this.relay.listSessions();
	}

	/** The workspace-RPC OWNER for a session (parent-chain walk). */
	async workspaceOwnerSessionId(sessionId: string): Promise<string> {
		return this.relay.workspaceOwnerSessionId(sessionId);
	}

	/** The session/page + session/follow address for one session id. */
	addressFor(sessionId: string): Record<string, unknown> {
		return this.relay.addressFor(sessionId);
	}

	/** session.history successor (0.1.2 session/page tail). */
	async history(sessionId: string): Promise<DshHistoryPage> {
		return this.relay.history(sessionId);
	}

	/** Workspace registry adoption (Add-workspace button's host call). */
	async createWorkspace(path: string): Promise<DshWorkspaceCreateResult> {
		return this.relay.createWorkspace(path);
	}

	/** Workspace rename (Chip Menu ADR D3). */
	async renameWorkspace(workspaceId: string, title: string): Promise<DshWorkspaceCreateResult> {
		return this.relay.renameWorkspace(workspaceId, title);
	}

	/** Workspace delete (Chip Menu ADR D3). */
	async deleteWorkspace(workspaceId: string): Promise<{ workspaceId: string }> {
		return this.relay.deleteWorkspace(workspaceId);
	}

	/**
	 * Goal Bar (2026-09-08, ADR amendment): one goal mutation through the
	 * host's Goal Remotes — goals/pause | goals/resume | goals/clear |
	 * goals/edit with the CAS ref {id, revision} (a stale revision loses
	 * host-side). goals/edit additionally carries the changed-fields
	 * request {objective?, maxGoalRounds?} (Goal Editor, 2026-09-09). The
	 * raw RemoteResult passes through; the route maps refusals.
	 * Kept self-contained in the shell: tests pin it via
	 * DshConnection.prototype.goalVerb.call(fakeRpcThis, …).
	 */
	async goalVerb(
		verb: 'pause' | 'resume' | 'clear' | 'edit',
		sessionId: string,
		ref: { id: string; revision: number },
		request?: { objective?: string; maxGoalRounds?: number }
	): Promise<unknown> {
		return this.rpc(
			`goals/${verb}`,
			request === undefined ? { agentId: sessionId, ref } : { agentId: sessionId, ref, request }
		);
	}

	/** workspaceFiles/read — one page of a UTF-8 text file. */
	async readWorkspaceFile(
		sessionId: string,
		path: string,
		range?: { offset?: number; limit?: number }
	): Promise<DshWorkspaceFileText> {
		return this.relay.readWorkspaceFile(sessionId, path, range);
	}

	/** workspaceFiles/readBytes — one byte window, raw bytes. */
	async readWorkspaceFileBytes(
		sessionId: string,
		path: string,
		range?: { offset?: number; length?: number }
	): Promise<DshWorkspaceFileBytes> {
		return this.relay.readWorkspaceFileBytes(sessionId, path, range);
	}

	/** workspaceFiles/list — one directory level. */
	async listWorkspaceDirectory(sessionId: string, path: string): Promise<DshWorkspaceDirectoryListing> {
		return this.relay.listWorkspaceDirectory(sessionId, path);
	}

	/** host.listDirectory — the folder picker browse. */
	async listDirectory(path?: string): Promise<DsiDirectoryListing> {
		return this.relay.listDirectory(path);
	}

	/** session.attachment — session-authorized durable image read. */
	async readAttachment(sessionId: string, attachmentId: string): Promise<DshAttachmentValue> {
		return this.relay.readAttachment(sessionId, attachmentId);
	}

	/** host.pickDirectory — the NATIVE directory chooser. */
	async pickDirectory(signal?: AbortSignal): Promise<{ path: string | null }> {
		return this.relay.pickDirectory(signal);
	}

	/** session.history PAGE ending at beforeSeq−1 (ledger truth, BC-4). */
	async historyPage(sessionId: string, beforeSeq: number): Promise<DshHistoryPage> {
		return this.relay.historyPage(sessionId, beforeSeq);
	}

	/** session.create {cwd?, agentPreset?}. */
	async createSession(
		cwd?: string,
		agentPreset?: string
	): Promise<{ sessionId: string; agentPreset?: string }> {
		return this.relay.createSession(cwd, agentPreset);
	}

	/** session/fork — the fork child. */
	async forkSession(sessionId: string, atSeq?: number): Promise<{ sessionId: string }> {
		return this.relay.forkSession(sessionId, atSeq);
	}

	/** agentPreset.list — the picker's only source of truth. */
	async listPresets(): Promise<{ presets: DshPreset[] }> {
		return this.relay.listPresets();
	}

	/** session.prompt — returns after the receipt only (BC-3). */
	async prompt(
		sessionId: string,
		payload: string | readonly DshPromptContent[],
		mode: 'queue' | 'steer' = 'queue'
	): Promise<{ accepted: boolean }> {
		return this.relay.prompt(sessionId, payload, mode);
	}

	/** commands/execute — the NATIVE slash-command surface. */
	async executeCommand(sessionId: string, line: string): Promise<DshCommandReceipt | null> {
		return this.relay.executeCommand(sessionId, line);
	}

	/** commands/list — the host's command catalog. */
	async listCommands(sessionId: string): Promise<DshCommandRow[]> {
		return this.relay.listCommands(sessionId);
	}

	/** skills/list — the session's user-invocable skill catalog. */
	async listSkills(sessionId: string): Promise<DshSkillList> {
		return this.relay.listSkills(sessionId);
	}

	/** session.cancel */
	async cancel(sessionId: string): Promise<{ accepted: boolean }> {
		return this.relay.cancel(sessionId);
	}

	/** session.rename {sessionId, title}. */
	async renameSession(sessionId: string, title: string): Promise<RenameResult> {
		return this.relay.renameSession(sessionId, title);
	}

	/** session.models → the model directory. */
	async listModels(_sessionId: string): Promise<DsiModelDirectory> {
		return this.relay.listModels(_sessionId);
	}

	/** session.selectModel → {selected: ModelSelection}. */
	async selectModel(
		sessionId: string,
		provider: string,
		model: string,
		reasoningEffort?: string
	): Promise<DsiModelSelection | null> {
		return this.relay.selectModel(sessionId, provider, model, reasoningEffort);
	}

	/** Answer a pending approval/question via $events/result. */
	async respond(rpcId: string, payload: Record<string, unknown>): Promise<RespondReceipt> {
		return this.relay.respond(rpcId, payload);
	}

	/** Authenticated GET of one Host path (cookie ladder). */
	async fetchHostPath(path: string, signal?: AbortSignal): Promise<Response> {
		return this.relay.fetchHostPath(path, signal);
	}

	/** Resync: replace the ring buffer with the ledger's tail page (BC-4). */
	async resyncFromLedger(sessionId: string): Promise<DshSessionEvent[]> {
		return this.relay.resyncFromLedger(sessionId);
	}

	dispose(): void {
		this.disposed = true;
		this.downlinks.teardownSockets();
		this.relay.dispose();
		this.sessions.dispose();
	}
}


// ── Normalization helpers (session.list rows → DsiSessionSummary) ──────


// ── POC-3 W3 (3.2) — model directory (SessionModels, garbage-safe) ─────────
// Client-facing shapes live in the shared layer ($lib/types — BC-2: the
// selector component must not import a server module); imported here for the
// forwards/normalize and re-exported for the routes' consumers.
import type { DsiModelSelection, DsiModelDirectory, DsiWorkspaceSummary, DsiDirectoryListing, DsiDirectoryEntry, DsiLiveStreamTail } from '$lib/types';
export type { DsiModelSelection, DsiModelGroup, DsiModelDirectory } from '$lib/types';
// ADR-0022 W1 (move-whole): normalizers + stream helpers live in connection/normalize.ts.
export type { DshSessionEventLike, RenameResult, RawSessionRow, ListResult, DsiSessionSummaryPlus, DshPreset } from './connection/normalize';
export { normalizeSessionRow, normalizeModelDirectory, normalizePreset } from './connection/normalize';
import { followStreamId, expandEntry, expandRecords, compactRecordTailTime, normalizeSessionRow, normalizeModelDirectory, normalizeModelSelection, normalizePreset } from './connection/normalize';
import type { DshSessionEventLike, RenameResult, RawSessionRow, ListResult, DsiSessionSummaryPlus, DshPreset, RawPresetRow } from './connection/normalize';
import { SessionStateStore } from './connection/session-state';
import { DownlinkManager } from './connection/downlinks';
import { RpcRelay } from './connection/rpc-relay';
export type { SessionBuffer } from './connection/session-state';


/** session.history response value (sessions.schema.ts historyPage). */
export interface DshHistoryPage {
	events: DshHistoryEntry[];
	hasMore: boolean;
	/** TAIL-page-only projections block (sessions.ts history: only the tail
	 * page carries it). Present when the deployment mounts the projection
	 * registry — the title for the header lives here (POC-3 W3 rename seed). */
	projections?: RawSessionProjections;
}

/** SessionProjectionsBlock (sessions.ts) — values keyed by projection key. */
export interface RawSessionProjections {
	asOfSeq?: number;
	values?: Record<string, unknown>;
}

/** workspace.create response view (api/workspace.schema.ts shape). */
export interface DshWorkspaceView {
	workspaceId: string;
	path: string;
	title: string;
	sessionIds: string[];
	createdAt: string;
	updatedAt: string;
}

export interface DshWorkspaceCreateResult {
	workspace: DshWorkspaceView;
	created: boolean;
}



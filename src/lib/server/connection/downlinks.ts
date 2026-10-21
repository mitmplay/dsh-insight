/**
 * connection/downlinks — the downlink generation lifecycle + frame demux
 * (ADR-0022 W3, ADR-0019 move-whole): the ONE cookie-authenticated remote.mux
 * carrier, its logical streams (session/follow, $events, workspace/follow,
 * session/control), generation rebuild + backoff, the 0.1.2 frame demux,
 * and the per-session projection / workspace-registry caches.
 */
import {
	DSH_REMOTE_MUX_WS_PATH,
	REMOTE_EVENT_STREAM_ENDPOINT,
	REMOTE_EVENT_STREAM_PAYLOAD,
} from '$lib/server/dsh-rpc';
import type { DshAuth } from '$lib/server/dsh-rpc';
import type {
	DshSessionEvent,
	SessionAssistantStreamBaselineLike,
	SessionAssistantStreamFrameLike,
	RawSessionProjections,
	DshSessionEventLike,
	WebSocketLike,
	DshConnection,
} from '$lib/server/dsh-connection';
import type { DsiWorkspaceSummary } from '$lib/types';
import { followStreamId, expandEntry, expandRecords } from './normalize';

export class DownlinkManager {
	constructor(private readonly conn: DshConnection) {}
	private wsMux: WebSocketLike | undefined;
	generation = 0;
	/** Logical streams by streamId → owning socket (0.1.2 remote.mux). */
	private streamSockets = new Map<string, WebSocketLike>();
	/** Generation-scoped counter keeping stream ids unique across rebuilds. */
	private streamSeq = 0;
	/** $events generation clientId (RemoteEventReadyFrame; binds $events/result). */
	eventClientId: string | null = null;
	/** True once the carrier's OPEN event fired (sends are legal). */
	private opened = false;
	/** Per-session projection baselines (follow snapshot + control frames; W2). */
	private projections = new Map<string, RawSessionProjections>();
	/** Workspace registry cache from workspace/follow (W2; authority = host). */
	private workspaces: DsiWorkspaceSummary[] = [];
	/** Waiters resolved by the first workspace/follow baseline (one-shot). */
	private workspaceBaselineWaiters = new Set<PromiseWithResolvers<void>>();
	/** Subscribes parked while the carrier is CONNECTING (flushed on open). */
	private pendingSubscribes = new Set<string>();
	/**
	 * The Roster Mirror's mux bridge (ADR 2026-10-17 D1/D2): sessions with a
	 * job/list logical stream this generation, sessions the server-side watch
	 * holds, and sessions parked while the carrier connects.
	 */
	private jobRosterStreams = new Set<string>();
	private jobRosterWatched = new Set<string>();
	/** ADR-0035 — live job.follow logical streams by relay key (owner|jobId). */
	private jobFollowStreams = new Set<string>();
	private pendingJobRoster = new Set<string>();
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	/** Wave 4.2 — consecutive failed generations; drives the backoff ladder. */
	reconnectAttempt = 0;

	/**
	 * Open the stream generation (idempotent): ONE cookie-authenticated
	 * remote.mux socket (0.1.2 — events.mux/events.host are gone), with every
	 * subscribed session's `session/follow` reopened as a logical stream plus
	 * the $events forwarded-event stream (approvals/questions).
	 */
	ensureDownlinks(): void {
		if (this.conn.disposed || this.wsMux) return;
		++this.generation;
		this.conn.log(`dsh-connection: opening remote.mux generation ${this.generation}`);
		// Socket construction is synchronous (the cookie header attaches from
		// the auth carrier at construction; no token configured → undefined,
		// unauthenticated hosts never fence). A later 401/close re-mints.
		this.wsMux = this.openDownlink((socket) => this.onMuxOpen(socket));
		void this.conn.sessions.seedRunning();
	}

	private openDownlink(attach: (socket: WebSocketLike) => void): WebSocketLike {
		const url = this.conn.baseUrl.replace(/^http/, 'ws') + DSH_REMOTE_MUX_WS_PATH;
		const headers = this.conn.auth.cookieHeader();
		const socket = this.conn.wsFactory(url, headers === undefined ? undefined : { cookie: headers });
		void this.conn.auth.ensureCookie().catch(() => null);
		socket.addEventListener('message', (e) => {
			try {
				// remote.mux carries RAW RemoteStreamServerMessage frames
				// ({item,end,error,streamId}) — no server-request envelope.
				this.onStreamFrame(JSON.parse(String(e.data)));
			} catch (err) {
				this.conn.log('dsh-connection: dropping malformed frame', err);
			}
		});
		socket.addEventListener('open', () => {
			this.opened = true;
			attach(socket);
		});
		socket.addEventListener('close', () => this.onDownlinkClosed());
		socket.addEventListener('error', () => this.onDownlinkClosed());
		return socket;
	}

	/** mux open: (re)open every subscribed session's follow stream + $events. */
	private onMuxOpen(socket: WebSocketLike): void {
		this.streamSeq += 1;
		this.pendingSubscribes.clear();
		// openFollowWithProbe picks each session's current address: a folded
		// subagent hint rides the rebuild; plain sessions keep the plain form.
		for (const sessionId of this.conn.sessions.bufferKeys()) this.openFollowWithProbe(socket, sessionId);
		this.openEventStream(socket);
		this.openStateStream(socket, `workspaces-${String(this.streamSeq)}`, 'workspace/follow');
		this.openStateStream(socket, `control-${String(this.streamSeq)}`, 'session/control');
		for (const sessionId of this.jobRosterWatched) this.openJobRosterStream(sessionId);
		for (const owner of this.conn.relay.jobFollowOwners()) this.openJobFollowStreamsOf(owner);
		this.pendingJobRoster.clear();
	}

	/** Open one state stream (workspace/follow | session/control) with empty args. */
	private openStateStream(socket: WebSocketLike, streamId: string, endpoint: string): void {
		this.sendStreamOpen(socket, streamId, endpoint, { args: {} });
	}

	private openFollowStream(socket: WebSocketLike, sessionId: string): void {
		this.sendStreamOpen(socket, followStreamId(sessionId, this.streamSeq), 'session/follow', {
			args: {
				request: {
					address: this.conn.relay.addressFor(sessionId),
					maxMessages: 200,
					// 0.1.3-alpha.1: opt into the host's live assistant-stream
					// channel — ledger v2 removed the durable assistant/chunk
					// events, so without the opt-in a streaming turn shows
					// nothing until the durable assistant/message lands.
					assistantStream: true
				}
			}
		});
	}

	/**
	 * Open (or ensure) the job/list logical stream for one watched session
	 * (ADR 2026-10-17 D1/D2). Parked while the carrier connects; reopened per
	 * generation for every watched session; 'end'/'error' drops the tracking
	 * entry so the next poll touch reopens and self-heals.
	 */
	openJobRosterStream(sessionId: string): void {
		this.ensureDownlinks();
		this.jobRosterWatched.add(sessionId);
		const socket = this.wsMux;
		if (socket === undefined || this.opened === false) {
			this.pendingJobRoster.add(sessionId);
			return;
		}
		if (this.jobRosterStreams.has(sessionId)) return;
		this.sendStreamOpen(
			socket,
			`jobs-${sessionId}-${String(this.streamSeq)}`,
			'job/list',
			{ args: { request: { sessionId } } }
		);
		this.jobRosterStreams.add(sessionId);
	}

	/** The reaper's close: stop tracking and tell the carrier (best-effort;
	 *  a carrier without stream-close semantics just gets ignored items). */
	closeJobRosterStream(sessionId: string): void {
		this.jobRosterWatched.delete(sessionId);
		this.pendingJobRoster.delete(sessionId);
		this.jobRosterStreams.delete(sessionId);
		for (const key of [...this.streamSockets.keys()]) {
			if (!key.startsWith(`jobs-${sessionId}-`)) continue;
			this.streamSockets.delete(key);
			try {
				this.wsMux?.send?.(JSON.stringify({ type: 'close', streamId: key }));
			} catch {
				// best-effort — an unwatched session's items are ignored below
			}
		}
	}

	/**
	 * ADR-0035 — open (or ensure) the job/follow logical stream for one
	 * (owner, jobId). Idempotent per generation; parked when the carrier is
	 * still CONNECTING (the next onMuxOpen reopens tracked follows).
	 */
	openJobFollowStream(owner: string, jobId: string): void {
		this.ensureDownlinks();
		const socket = this.wsMux;
		const key = owner + '|' + jobId;
		if (socket === undefined || this.opened === false) return; // next generation reopens via openJobFollowStream retry
		if (this.jobFollowStreams.has(key)) return;
		this.sendStreamOpen(
			socket,
			`jobfollow-${owner}.${jobId}.${String(this.streamSeq)}`, // '.' — ids carry dashes
			'job/follow',
			{ args: { request: owner ? { sessionId: owner, jobId } : { jobId } } }
		);
		this.jobFollowStreams.add(key);
	}

	/** ADR-0035 — the last-unwatch close (follow-relay calls this). */
	closeJobFollowStream(owner: string, jobId: string): void {
		const key = owner + '|' + jobId;
		this.jobFollowStreams.delete(key);
		for (const streamId of [...this.streamSockets.keys()]) {
			if (!streamId.startsWith(`jobfollow-${owner}.${jobId}.`)) continue;
			this.streamSockets.delete(streamId);
			try {
				this.wsMux?.send?.(JSON.stringify({ type: 'close', streamId }));
			} catch {
				// best-effort — the carrier rebuild reopens only tracked follows
			}
		}
	}

	/** Extract the sessionId from a jobs-<sessionId>-<seq> stream id. */
	private jobRosterSessionIdOf(streamId: string): string | null {
		const rest = streamId.slice('jobs-'.length);
		const cut = rest.lastIndexOf('-');
		return cut > 0 ? rest.slice(0, cut) : null;
	}

	/** Reopen every tracked job follow owned by one owner (generation). */
	private openJobFollowStreamsOf(owner: string): void {
		for (const jobId of this.conn.relay.jobFollowJobsOf(owner)) this.openJobFollowStream(owner, jobId);
	}

	/** jobfollow item: relay to the follow-relay's sinks. */
	private onJobFollowItem(streamId: string, value: Record<string, unknown>): void {
		// jobfollow-<owner>.<jobId>.<seq> — '.' separates; ids carry dashes
		const parts = streamId.slice('jobfollow-'.length).split('.');
		if (parts.length >= 3) this.conn.relay.onJobFollowItem(parts[0], parts[1], value);
	}

	private openEventStream(socket: WebSocketLike): void {
		this.sendStreamOpen(
			socket,
			`events-${String(this.streamSeq)}`,
			REMOTE_EVENT_STREAM_ENDPOINT,
			REMOTE_EVENT_STREAM_PAYLOAD
		);
	}

	private sendStreamOpen(socket: WebSocketLike, streamId: string, endpoint: string, payload: unknown): void {
		const send = (msg: string) => socket.send?.(msg);
		this.streamSockets.set(streamId, socket);
		send(JSON.stringify({ type: 'open', streamId, endpoint, payload }));
	}

	/** Either socket dying rebuilds the whole generation (guide Part 1). */
	private onDownlinkClosed(): void {
		if (this.conn.disposed) return;
		if (!this.wsMux) return;
		this.conn.log('dsh-connection: remote.mux died — rebuilding generation');
		// Slash Menu W1 (task 1.3): a mux reset may have missed catalog
		// frames — drop every cached catalog alongside the rebuild (the
		// existing reset path; PRD §5 invalidation table).
		this.conn.relay.fireCatalogInvalidated('all');
		this.teardownSockets();
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.conn.disposed) return;
		// Ladder ascends on consecutive failed generations (Wave 4.2): each
		// teardown climbs one rung (capped); a delivered mux frame resets it.
		// A repeated schedule within one teardown keeps the already-climbed rung.
		const rung = Math.min(this.reconnectAttempt, this.conn.backoff.length - 1);
		const delay = this.conn.backoff[rung];
		if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => {
			if (this.conn.disposed) return;
			this.reconnectAttempt += 1; // next drop (if this generation fails) waits longer
			this.ensureDownlinks();
		}, delay);
	}

	teardownSockets(): void {
		// Detach BEFORE closing: a refused/failed undici WebSocket dispatches
		// `close` synchronously inside close() (and again on every re-entrant
		// close()), re-entering onDownlinkClosed. Fields already undefined →
		// the guard returns instead of recursing (2026-08-29 startup crash).
		const sockets = [this.wsMux];
		this.wsMux = undefined;
		this.opened = false;
		this.streamSockets.clear();
		this.jobRosterStreams.clear();
		this.pendingJobRoster.clear();
		this.projections.clear();
		this.workspaces = [];
		for (const waiter of this.workspaceBaselineWaiters) waiter.resolve();
		this.workspaceBaselineWaiters.clear();
		if (this.reconnectTimer !== undefined) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		for (const socket of sockets) socket?.close();
	}

	/**
	 * 0.1.2 remote.mux demux: `{item,end,error,streamId}` frames. Follow
	 * streams deliver a `snapshot` opening (seeds the baseline) then event
	 * entries (ring buffer appends); the $events stream delivers forwarded
	 * Cordis events (approval/question waterfalls → answerer registry).
	 */
	private onStreamFrame(payload: unknown): void {
		const frame = payload as {
			type: 'item' | 'end' | 'error';
			streamId?: string;
			value?: unknown;
			error?: { code?: string; message?: string };
		};
		if (typeof frame?.streamId !== 'string') return;
		if (frame.type === 'item' && frame.value !== undefined) {
			this.reconnectAttempt = 0;
			const value = frame.value as Record<string, unknown>;
			if (frame.streamId.startsWith('follow-')) {
				this.onFollowItem(frame.streamId, value);
			} else if (frame.streamId.startsWith('events-')) {
				this.onEventItem(value);
			} else if (frame.streamId.startsWith('workspaces-')) {
				this.onWorkspaceItem(value);
			} else if (frame.streamId.startsWith('control-')) {
				this.onControlItem(value);
			} else if (frame.streamId.startsWith('jobfollow-')) {
				this.onJobFollowItem(frame.streamId, value);
			} else if (frame.streamId.startsWith('jobs-')) {
				const sessionId = this.jobRosterSessionIdOf(frame.streamId);
				if (sessionId !== null) this.conn.relay.onJobRosterItem(sessionId, value);
			}
			return;
		}
		if (frame.type === 'error') {
			if (frame.streamId.startsWith('jobfollow-')) {
				const parts = frame.streamId.slice('jobfollow-'.length).split('.');
				if (parts.length >= 3) {
					this.conn.relay.onJobFollowStreamError(parts[0], parts[1], frame.error?.code, frame.error?.message);
					this.jobFollowStreams.delete(parts[0] + '|' + parts[1]);
				}
			} else if (frame.streamId.startsWith('jobs-')) {
				const sessionId = this.jobRosterSessionIdOf(frame.streamId);
				if (sessionId !== null) {
					this.conn.relay.onJobRosterStreamError(sessionId, frame.error?.code, frame.error?.message);
					this.jobRosterStreams.delete(sessionId);
				}
			} else {
				this.conn.log(
					`dsh-connection: stream ${frame.streamId} failed`,
					frame.error?.code,
					frame.error?.message
				);
			}
		}
		this.streamSockets.delete(frame.streamId);
	}

	/** session/follow item: snapshot seeds the baseline; events append; the
	 *  opted-in assistant-stream frames update the live tail (seq-less —
	 *  they never touch the durable cursor bookkeeping below). */
	private onFollowItem(streamId: string, value: Record<string, unknown>): void {
		if (value.type === 'snapshot') {
			const sessionId = this.sessionIdOfStream(streamId);
			if (sessionId === null) return;
			const snapshot = value as unknown as {
				cursor: number;
				records: Array<{ type: string; event?: DshSessionEventLike }>;
				projections?: RawSessionProjections;
				assistantStream?: SessionAssistantStreamBaselineLike;
			};
			// Records first (empty buffer accepts every seq), then the cursor
			// seeds lastSeq ABOVE the last appended seq — the cursor is the
			// follow's authoritative position and is always ≥ the last event
			// seq on v2 hosts.
			const events = expandRecords(snapshot.records ?? []);
			for (const event of events) this.conn.sessions.appendEvent(sessionId, event);
			this.conn.sessions.seedSnapshotCursor(sessionId, snapshot.cursor);
			if (snapshot.projections !== null && typeof snapshot.projections === 'object') {
				this.projections.set(sessionId, snapshot.projections as RawSessionProjections);
			}
			this.conn.sessions.seedLiveTailFromBaseline(sessionId, snapshot.assistantStream);
			return;
		}
		if (value.type === 'assistant-stream') {
			const sessionId = this.sessionIdOfStream(streamId);
			const frame = value.frame as SessionAssistantStreamFrameLike | undefined;
			if (sessionId !== null && frame !== undefined) {
				this.conn.sessions.onAssistantStreamFrame(sessionId, frame);
			}
			return;
		}
		if (value.type === 'event') {
			const sessionId = this.sessionIdOfStream(streamId);
			const entry = value as { event?: DshSessionEventLike };
			if (sessionId !== null && entry.event !== undefined) {
				for (const event of expandEntry(entry.event)) this.conn.sessions.appendEvent(sessionId, event);
			}
		}
	}

	/** $events item: forwarded Cordis event frames (waterfall = answerable). */
	private onEventItem(value: Record<string, unknown>): void {
		if (value.type === 'ready') {
			// clientId binds every later $events/result answer to this
			// generation (stream-protocol RemoteEventReadyFrame).
			if (typeof value.clientId === 'string') this.eventClientId = value.clientId;
			this.conn.log('dsh-connection: $events stream ready');
			this.conn.relay.armAnswerReap();
			return;
		}
		if (value.type === 'waterfall') {
			// 0.1.2 answer surface (W2): approval/question waterfalls keyed by
			// eventId; agentId IS the sessionId (request carries no agent —
			// projectRemoteEventRequest strips it); answered via $events/result.
			const event = typeof value.event === 'string' ? value.event : '';
			const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
			const sessionId = typeof value.agentId === 'string' ? value.agentId : undefined;
			const request =
				value.request !== null && typeof value.request === 'object'
					? (value.request as Record<string, unknown>)
					: {};
			if (eventId === undefined) return;
			if (event === 'approval/request') {
				this.conn.relay.registerPending(
					{ type: 'approval/requested', sessionId: sessionId ?? '', ...request },
					eventId
				);
				return;
			}
			if (event === 'user-questions/request') {
				this.conn.relay.registerPending(
					{ type: 'question/requested', sessionId: sessionId ?? '', ...request },
					eventId
				);
				return;
			}
			this.conn.log('dsh-connection: forwarded waterfall ignored', event);
			return;
		}
		if (value.type === 'cancel') {
			const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
			if (eventId !== undefined) this.conn.relay.withdrawPending(eventId);
			this.conn.log('dsh-connection: forwarded waterfall cancelled');
			return;
		}
		if (value.type === 'settle') {
			// Host-side settlement (answered elsewhere / resolved): withdraw the
			// card and record the outcome in the settlement ring.
			const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
			const outcome = typeof value.outcome === 'string' ? value.outcome : 'unknown';
			if (eventId !== undefined) this.conn.relay.withdrawPending(eventId, outcome);
			return;
		}
		if (value.type === 'emit') {
			// api-session/status carries positional args [sessionId, running].
			if (value.event === 'api-session/status' && Array.isArray(value.args)) {
				const [sessionId, running] = value.args;
				if (typeof sessionId === 'string') this.conn.sessions.setRunning(sessionId, running === true);
				return;
			}
			// Slash Menu W1 (task 1.3) — the catalog invalidation arms: the
			// host's own menu refreshes on the same two frames (PRD §1 fact 6;
			// both sit in the forwarding allowlist and ALREADY arrive here —
			// previously dropped by the ignore fall-through below).
			if (value.event === 'commands/change') {
				// Any session's command vocabulary moved — drop every catalog.
				this.conn.relay.fireCatalogInvalidated('all');
				return;
			}
			if (value.event === 'agent-preset/selected' && typeof value.agentId === 'string') {
				// Preset switch retargets ONE session — drop only its catalog
				// (skills/list reads the preset's registry at request time).
				this.conn.relay.fireCatalogInvalidated(value.agentId);
				return;
			}
			this.conn.log('dsh-connection: forwarded emit ignored', value.event);
			return;
			}
	}

	/**
	 * workspace/follow item (W2): baseline replaces the cache; increments
	 * apply in order (upsert/remove/order/archived — archived sessions are
	 * hidden from DSI's surfaces the same way the 0.1.1 registry did).
	 */
	private onWorkspaceItem(value: Record<string, unknown>): void {
		if (value.type === 'baseline') {
			const baseline = (value.value ?? {}) as { items?: unknown };
			const rows = Array.isArray(baseline.items) ? baseline.items : [];
			this.workspaces = rows.flatMap((row): DsiWorkspaceSummary[] => {
				const w = row as { workspaceId?: unknown; title?: unknown; path?: unknown; sessionIds?: unknown };
				if (typeof w?.workspaceId !== 'string' || typeof w?.path !== 'string') return [];
				return [{
					workspaceId: w.workspaceId,
					title: typeof w.title === 'string' && w.title.length > 0 ? w.title : w.path,
					path: w.path,
					sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds.filter((id): id is string => typeof id === 'string') : []
				}];
			});
			for (const waiter of this.workspaceBaselineWaiters) waiter.resolve();
			this.workspaceBaselineWaiters.clear();
			this.conn.log(`dsh-connection: workspace baseline (${this.workspaces.length} rows)`);
			return;
		}
		if (value.type === 'upsert') {
			const w = value.workspace as { workspaceId?: unknown; title?: unknown; path?: unknown; sessionIds?: unknown } | undefined;
			if (typeof w?.workspaceId !== 'string' || typeof w?.path !== 'string') return;
			const row: DsiWorkspaceSummary = {
				workspaceId: w.workspaceId,
				title: typeof w.title === 'string' && w.title.length > 0 ? w.title : w.path,
				path: w.path,
				sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds.filter((id): id is string => typeof id === 'string') : []
			};
			const idx = this.workspaces.findIndex((x) => x.workspaceId === row.workspaceId);
			if (idx >= 0) this.workspaces.splice(idx, 1, row);
			else this.workspaces.push(row);
			return;
		}
		if (value.type === 'remove' && typeof value.workspaceId === 'string') {
			this.workspaces = this.workspaces.filter((x) => x.workspaceId !== value.workspaceId);
			return;
		}
		// order / archived: order is host-owned presentation; archived sessions
		// are not workspace members on this surface — the list stays as-is.
	}

	/**
	 * session/control item (W2): the baseline's per-session projections seed
	 * the store (permissions for the access chip); later projection frames
	 * update single keys. queue/job frames are not DSI state (ignored).
	 */
	private onControlItem(value: Record<string, unknown>): void {
		if (value.type === 'baseline') {
			const baseline = (value.value ?? {}) as {
				projections?: Record<string, RawSessionProjections>;
			};
			for (const [sessionId, block] of Object.entries(baseline.projections ?? {})) {
				if (block !== null && typeof block === 'object') this.projections.set(sessionId, block);
			}
			this.conn.log(`dsh-connection: control baseline (${this.projections.size} sessions)`);
			return;
		}
		if (value.type === 'projection' && typeof value.sessionId === 'string' && typeof value.key === 'string') {
			const block = this.projections.get(value.sessionId) ?? { asOfSeq: 0, values: {} };
			this.projections.set(value.sessionId, {
				asOfSeq: typeof value.seq === 'number' ? value.seq : block.asOfSeq,
				values: { ...block.values, [value.key]: value.value }
			});
		}
	}

	/** Extract the sessionId from a follow-<sessionId>-<seq> stream id. */
	private sessionIdOfStream(streamId: string): string | null {
		// follow-<sessionId>-<streamSeq>
		const rest = streamId.slice('follow-'.length);
		const cut = rest.lastIndexOf('-');
		return cut > 0 ? rest.slice(0, cut) : null;
	}

	/**
	 * Subscribe one session (0.1.2): create its buffer and open a
	 * session/follow logical stream on the live carrier (or mark it for the
	 * next generation). Idempotent; the snapshot frame seeds the baseline.
	 * A repeat call while THIS generation already holds the session's follow
	 * stream is a no-op — the api-dsh events route calls subscribe on every
	 * poll, and reopening would replace the stream (same streamId → fresh
	 * snapshot) on every tick. A stream 'end'/'error' frame drops the
	 * tracking entry so the next poll reopens and self-heals.
	 */
	subscribe(sessionId: string): void {
		this.conn.sessions.bufferFor(sessionId);
		const socket = this.wsMux;
		// CONNECTING sockets cannot send (undici throws Sent-before-connected):
		// park the id; onMuxOpen opens every subscribed buffer's stream anyway.
		if (socket === undefined) return;
		if (this.opened === false) {
			this.pendingSubscribes.add(sessionId);
			return;
		}
		if (this.streamSockets.has(followStreamId(sessionId, this.streamSeq))) return;
		this.openFollowWithProbe(socket, sessionId);
	}

	/**
	 * Open the follow stream with the best-known address NOW (sync, the
	 * historical contract), then — when this turns out to be a subagent child
	 * nobody has folded yet — probe and REOPEN with the parent address (the
	 * mux replaces a stream id; the fresh snapshot reseeds the baseline).
	 */
	private openFollowWithProbe(socket: WebSocketLike, sessionId: string): void {
		this.openFollowStream(socket, sessionId);
		if (!this.conn.relay.subagentHints.has(sessionId) && !this.conn.relay.hintProbed.has(sessionId)) {
			this.conn.relay.hintProbed.add(sessionId);
			void this.probeHintThenSubscribe(sessionId, socket);
		}
	}

	/** Resolve one session's address hint after a plain-form follow went out;
	 *  on a folded hint REOPEN the follow with the parent address (a plain
	 *  form on a subagent child is rejected by the host and the stream would
	 *  stay dead for the whole generation). Skipped when the carrier moved on
	 *  (generation rebuilt / disposed) during the list RPC — onMuxOpen
	 *  reopens every buffer with the then-current addresses. */
	private async probeHintThenSubscribe(sessionId: string, socket: WebSocketLike): Promise<void> {
		try {
			if (!this.conn.relay.subagentHints.has(sessionId)) await this.conn.relay.rawListSessions();
		} catch {
			// The probe is best-effort: the next list pass (re-baseline, any
			// page call) folds the row; until then the plain form stays out.
		}
		if (this.conn.disposed || this.wsMux !== socket || this.opened === false) return;
		if (this.conn.relay.subagentHints.has(sessionId)) this.openFollowStream(socket, sessionId);
	}

	/**
	 * Per-session projection value (W2): follow-snapshot + control-baseline
	 * + control projection frames, newest wins. permissions (access chip),
	 * modelSelection, todos, plan … — null when never seen.
	 */
	projectionValue(sessionId: string, key: string): unknown {
		return this.projections.get(sessionId)?.values?.[key];
	}

	/** The whole stored block for one session (null when absent). */
	projectionBlock(sessionId: string): RawSessionProjections | null {
		return this.projections.get(sessionId) ?? null;
	}

	/**
	 * Bounded wait for the session's FIRST projection baseline (0.1.2 cold
	 * loads seed the access mode + admission numbers from the follow/control
	 * store — session/page carries no projections block). Resolves
	 * immediately when a block exists; null after timeoutMs (an unfenced or
	 * slow host degrades to the documented defaults, never a hang).
	 */
	async waitForProjections(sessionId: string, timeoutMs = 2_500): Promise<RawSessionProjections | null> {
		this.ensureDownlinks();
		this.subscribe(sessionId);
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const block = this.projectionBlock(sessionId);
			if (block !== null) return block;
			if (Date.now() >= deadline) return null;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	/**
	 * True once the workspace/follow baseline landed. Registers the waiter
	 * even while the carrier is CONNECTING (the first RPC often races the
	 * handshake); bounded by 3s — an honest empty after that, never a hang.
	 */
	private async awaitWorkspaceBaseline(): Promise<boolean> {
		if (this.workspaces.length > 0) return true;
		this.ensureDownlinks();
		if (this.wsMux === undefined) return false;
		const waiter: PromiseWithResolvers<void> = Promise.withResolvers();
		this.workspaceBaselineWaiters.add(waiter);
		await Promise.race([waiter.promise, new Promise((r) => setTimeout(r, 3000))]);
		this.workspaceBaselineWaiters.delete(waiter);
		return this.workspaces.length > 0;
	}

	/** The workspace registry (2026-08-23 registry parity) — the AUTHORITY
	 *  for DSI's workspace pills/chips: a deleted workspace disappears, and
	 *  sessions outside every registry entry render cue-less (DSH's
	 *  Ungrouped). Membership is sessionIds, not cwd matching. */
	async listWorkspaces(): Promise<{ items: DsiWorkspaceSummary[] }> {
		// W2: workspace/list is gone; the registry read side is the
		// workspace/follow stream baseline (kept live by increments).
		const ok = await this.awaitWorkspaceBaseline();
		if (!ok) {
			this.conn.log('dsh-connection: workspace baseline did not land in time — honest empty');
		}
		return { items: [...this.workspaces] };
	}
	/** Cancel a scheduled reconnect (stale-generation answer retry path, W4). */
	cancelReconnect(): void {
		if (this.reconnectTimer !== undefined) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
	}
}

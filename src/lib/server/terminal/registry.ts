/**
 * Terminal registry — the server-side session table and ownership fence
 * (spec 2026-09-24 Wave 2; ADR 2026-09-23 D7).
 *
 * DSI's terminal is operator-owned: sessions belong to the DSI server
 * process, and each attached browser tab holds one server-minted token.
 * Write/signal/close operations present the token; a wrong one is refused
 * FOREIGN_SESSION. Re-attach re-mints the token to the asking tab and
 * evicts the old one — many watchers, one writer (the one-writer invariant
 * of ADR D4 stays mechanical, not conventional).
 *
 * This module is the WIRING POINT: transport routes import the singleton;
 * nothing imports a route or a component.
 *
 * The baton facet (ADR-0079): the same mint that issues the token also
 * records WHO asked for it (operator | automation, plus a label), WHEN,
 * and the time of the last accepted write. The facet is published token-
 * free through peek()/list() (the open-watch path) and PUSHED as a
 * `baton` frame on the session's own event channel at every mint and
 * release, so the SSE routes — and the desk behind them — learn of a
 * takeover the moment it happens. It DESCRIBES the lease; the fence below
 * keeps enforcing it, unchanged.
 */
import { randomUUID } from 'node:crypto';

import { TerminalSession } from './session.js';
import type {
	BatonFacet,
	BatonHolder,
	TerminalDeskIntent,
	TerminalOutcome,
	SessionReadiness,
	TerminalSessionEvent,
	TerminalSettleReason,
	TerminalSignal,
	TerminalSpec
} from './types.js';

/** Refusal with a stable wire code (mirrors dsh-terminal's codes; the
 *  registry is where FOREIGN_SESSION and NO_SESSION are decided). */
export class TerminalRegistryRefusal extends Error {
	readonly code: 'NO_SESSION' | 'FOREIGN_SESSION';
	constructor(code: 'NO_SESSION' | 'FOREIGN_SESSION', message: string) {
		super(message);
		this.name = 'TerminalRegistryRefusal';
		this.code = code;
	}
}

/** A label a caller may CLAIM the baton under (ADR-0079 D3). `unassigned`
 *  is reserved for the release verb (D4) — it is never a claimable label. */
export type BatonClaim = Exclude<BatonHolder, 'unassigned'>;

/** Optional mint labels — an absent field means the operator default (D3). */
export interface BatonMintOptions {
	holder?: BatonClaim;
	holderId?: string | null;
}

/** The session-born event (ADR 2026-11-24 The Headless Split, D1): one
 *  fact per intent-carrying birth — what was born, where it wants to be
 *  seen, and whose the baton is. Token-free, like every facet push. */
export interface SessionBornEvent {
	sessionId: string;
	deskIntent: TerminalDeskIntent;
	baton: BatonFacet;
}

interface RegistryEntry {
	session: TerminalSession;
	token: string;
	spec: TerminalSpec;
	/** The baton facet (ADR-0079 D1/D6) — the registry is its only writer. */
	holder: BatonHolder;
	holderId: string | null;
	since: number;
	lastWriteAt: number | null;
	pinned: boolean;
	/** The desk intent carried at birth (ADR 2026-11-24 D2); null = headless. */
	deskIntent: TerminalDeskIntent | null;
}

/** The close ladder's proven result, promoted to the wire vocabulary. */
export interface RegistryCloseResult {
	quiescent: boolean;
	lingeringPids?: number[];
}

export class TerminalRegistry {
	private readonly entries = new Map<string, RegistryEntry>();
	/** The session-born listeners (ADR 2026-11-24 D1) — the SSE hub is the
	 *  only production subscriber; the registry is the only emitter. */
	private readonly bornListeners = new Set<(event: SessionBornEvent) => void>();

	/** Spawn a session from a fully specified spec (no defaults here —
	 *  the transport resolved them from config). Returns the minted token.
	 *  The mint labels the baton (ADR-0079 D3): absent labels mean the
	 *  operator — the common opener IS the desk tab. */
	create(
		spec: TerminalSpec,
		options?: { promptDetect?: (tail: string) => boolean; deskIntent?: TerminalDeskIntent } & BatonMintOptions
	): { session: TerminalSession; token: string } {
		const session = new TerminalSession(spec, { promptDetect: options?.promptDetect });
		const deskIntent = options?.deskIntent === 'new-tab' || options?.deskIntent === 'split-down' ? options.deskIntent : null;
		const entry: RegistryEntry = {
			session,
			token: '',
			spec,
			holder: 'operator',
			holderId: null,
			since: Date.now(),
			lastWriteAt: null,
			pinned: false,
			deskIntent
		};
		this.entries.set(session.id, entry);
		const token = this.mint(entry, options?.holder, options?.holderId);
		// D1/D2: only an intent-carrying birth announces itself — a headless
		// mint behaves byte-for-byte as before (no event, no desk ping).
		if (deskIntent !== null) this.emitBorn(entry);
		return { session, token };
	}

	/** One mint = one baton fact (ADR-0079 D1/D3/D7): a fresh token, the
	 *  holder label (operator unless a driver says otherwise), the time,
	 *  and one pushed baton frame on the session's own channel. */
	private mint(entry: RegistryEntry, holder?: BatonClaim, holderId?: string | null): string {
		entry.token = randomUUID();
		entry.holder = holder === 'automation' ? 'automation' : 'operator';
		entry.holderId = typeof holderId === 'string' && holderId.length > 0 ? holderId : null;
		entry.since = Date.now();
		this.emitBaton(entry);
		return entry.token;
	}

	/** D7: the facet change rides the session's event channel — the SSE
	 *  routes already pump it, so the desk learns of a takeover with no
	 *  keystroke and no polling. The frame carries no token. */
	private emitBaton(entry: RegistryEntry): void {
		entry.session.emit('event', {
			type: 'baton',
			holder: entry.holder,
			holderId: entry.holderId,
			since: entry.since
		} satisfies TerminalSessionEvent);
	}

	/** Subscribe to session-born (ADR 2026-11-24 D1). @returns the
	 *  unsubscribe — the hub route drops it when the client cancels. */
	onSessionBorn(listener: (event: SessionBornEvent) => void): () => void {
		this.bornListeners.add(listener);
		return () => {
			this.bornListeners.delete(listener);
		};
	}

	/** One intent-carrying birth = one born event to every current
	 *  listener. Headless births emit nothing (D2's consent shape). */
	private emitBorn(entry: RegistryEntry): void {
		const event: SessionBornEvent = {
			sessionId: entry.session.id,
			deskIntent: entry.deskIntent as TerminalDeskIntent,
			baton: this.facet(entry)
		};
		for (const listener of this.bornListeners) {
			try {
				listener(event);
			} catch {
				// a dead subscriber never breaks the birth
			}
		}
	}

	/** D5: the facet is DERIVED at read time and stored nowhere. Conservative
	 *  by decision — an operator-held terminal is never ready for automation,
	 *  however long it stays idle (the idle clause is a named, rejected
	 *  alternative, not an omission). */
	private facet(entry: RegistryEntry): BatonFacet {
		const exited = entry.session.isExited();
		return {
			holder: entry.holder,
			holderId: entry.holderId,
			since: entry.since,
			lastWriteAt: entry.lastWriteAt,
			pinned: entry.pinned,
			readyForAutomation: !exited && !entry.pinned && entry.holder !== 'operator'
		};
	}

	/** Resolve the ENTRY for a tokened operation — the fence.
	 *  @throws TerminalRegistryRefusal NO_SESSION / FOREIGN_SESSION */
	private authorizedEntry(sessionId: string, token: string): RegistryEntry {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		if (entry.token !== token) throw new TerminalRegistryRefusal('FOREIGN_SESSION', 'this tab does not own the terminal');
		return entry;
	}

	/** Resolve a session for a tokened operation — the fence.
	 *  @throws TerminalRegistryRefusal NO_SESSION / FOREIGN_SESSION */
	private authorized(sessionId: string, token: string): TerminalSession {
		return this.authorizedEntry(sessionId, token).session;
	}

	/** Read-only view without a token: watching is open, writing is not.
	 *  Carries the baton facet (ADR-0079 D2) — the token-free ownership
	 *  query the empty-write probe never was. */
	peek(sessionId: string): { id: string; exited: boolean; baton: BatonFacet } {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		return { id: entry.session.id, exited: entry.session.isExited(), baton: this.facet(entry) };
	}

	/** Re-attach: re-mint the token to the asking tab; the old token dies.
	 *  The optional labels record WHO took it (ADR-0079 D3) — the desk's
	 *  own `{}` posts land here as the operator takeover they are. */
	reattach(sessionId: string, holder?: BatonClaim, holderId?: string | null): { token: string; fromByte: number } {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		return { token: this.mint(entry, holder, holderId), fromByte: entry.session.streamBytes() };
	}

	/** Release (ADR-0079 D4): the holder hands the baton to NOBODY. Fence-
	 *  checked like every tokened verb; the token is re-minted to a value
	 *  nobody receives, the facet says `unassigned`, and one baton frame
	 *  goes out. The next writer — operator or agent — pays exactly one
	 *  refused write and heals into ownership (the priced heal tax). */
	release(sessionId: string, token: string): BatonFacet {
		const entry = this.authorizedEntry(sessionId, token);
		entry.token = randomUUID(); // discarded on purpose — nobody receives it
		entry.holder = 'unassigned';
		entry.holderId = null;
		entry.since = Date.now();
		this.emitBaton(entry);
		return this.facet(entry);
	}

	/** Tokened operations — each throws through the fence. */
	send(sessionId: string, token: string, data: string, timeoutMs: number): Promise<TerminalSettleReason> {
		return this.authorized(sessionId, token).send(data, timeoutMs);
	}

	/** Interactive typing — the write never locks and never drops. An
	 *  accepted write stamps the facet's lastWriteAt (ADR-0079 D1). */
	write(sessionId: string, token: string, data: string): void {
		const entry = this.authorizedEntry(sessionId, token);
		entry.session.write(data);
		entry.lastWriteAt = Date.now();
	}

	/** Resize the PTY to the client's fitted dims (Terminal Desk ADR
	 *  amendment 2026-11-03 — the DSH handle's `resize` fact, mirrored). */
	resize(sessionId: string, token: string, cols: number, rows: number): void {
		this.authorized(sessionId, token).resize(cols, rows);
	}

	signal(sessionId: string, token: string, signal: TerminalSignal): number {
		return this.authorized(sessionId, token).signalForeground(signal);
	}

	async close(sessionId: string, token: string): Promise<RegistryCloseResult> {
		const session = this.authorized(sessionId, token);
		const result = await session.close();
		return result.quiescent ? { quiescent: true } : { quiescent: false, lingeringPids: result.lingeringPids };
	}

	/** Destroy: run the close ladder, then PRUNE the entry (ADR amendment
	 *  2026-11-07, D2 extension). The desk's clear chord is the caller —
	 *  an exited session prunes without re-killing (close is idempotent
	 *  on a settled session); the fence applies like every tokened verb. */
	async destroy(sessionId: string, token: string): Promise<RegistryCloseResult & { pruned: boolean }> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		if (entry.token !== token) throw new TerminalRegistryRefusal('FOREIGN_SESSION', 'this tab does not own the terminal');
		const result = await entry.session.close();
		this.entries.delete(sessionId);
		return result.quiescent
			? { quiescent: true, pruned: true }
			: { quiescent: false, lingeringPids: result.lingeringPids, pruned: true };
	}

	readFrom(sessionId: string, fromByte: number): ReturnType<TerminalSession['readFrom']> {
		// Reads are the watcher path — no token, per D7's open-watch posture.
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		return entry.session.readFrom(fromByte);
	}

	events(sessionId: string): TerminalSession | undefined {
		return this.entries.get(sessionId)?.session;
	}

	exitOutcome(sessionId: string): TerminalOutcome | null {
		return this.entries.get(sessionId)?.session.exitOutcome() ?? null;
	}

	/** Every live session id (the operator's list — one owner, no scoping),
	 *  each with its baton facet (ADR-0079 D2) and its readiness facet
	 *  (ADR-0080 D1, additive): one token-free call answers "who holds
	 *  each baton, may automation take it, and is the shell settled?" */
	list(): Array<{ id: string; exited: boolean; baton: BatonFacet; readiness: SessionReadiness; deskIntent?: TerminalDeskIntent }> {
		return [...this.entries.values()].map((e) => ({ id: e.session.id, exited: e.session.isExited(), baton: this.facet(e), readiness: e.session.readiness(), deskIntent: e.deskIntent ?? undefined }));
	}

	/** Close every session and await quiescence (server shutdown path). */
	async dispose(): Promise<void> {
		const closings = [...this.entries.values()].map((e) => e.session.close().catch(() => undefined));
		await Promise.all(closings);
		this.entries.clear();
	}
}

/** The wiring singleton — routes import this, nothing else constructs. */
export const terminalRegistry = new TerminalRegistry();

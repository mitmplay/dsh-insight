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
 */
import { randomUUID } from 'node:crypto';

import { TerminalSession } from './session.js';
import type { TerminalOutcome, TerminalSettleReason, TerminalSignal, TerminalSpec } from './types.js';

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

interface RegistryEntry {
	session: TerminalSession;
	token: string;
	spec: TerminalSpec;
}

/** The close ladder's proven result, promoted to the wire vocabulary. */
export interface RegistryCloseResult {
	quiescent: boolean;
	lingeringPids?: number[];
}

export class TerminalRegistry {
	private readonly entries = new Map<string, RegistryEntry>();

	/** Spawn a session from a fully specified spec (no defaults here —
	 *  the transport resolved them from config). Returns the minted token. */
	create(spec: TerminalSpec, options?: { promptDetect?: (tail: string) => boolean }): { session: TerminalSession; token: string } {
		const session = new TerminalSession(spec, { promptDetect: options?.promptDetect });
		const token = randomUUID();
		this.entries.set(session.id, { session, token, spec });
		return { session, token };
	}

	/** Resolve a session for a tokened operation — the fence.
	 *  @throws TerminalRegistryRefusal NO_SESSION / FOREIGN_SESSION */
	private authorized(sessionId: string, token: string): TerminalSession {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		if (entry.token !== token) throw new TerminalRegistryRefusal('FOREIGN_SESSION', 'this tab does not own the terminal');
		return entry.session;
	}

	/** Read-only view without a token: watching is open, writing is not. */
	peek(sessionId: string): { id: string; exited: boolean } {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		return { id: entry.session.id, exited: entry.session.isExited() };
	}

	/** Re-attach: re-mint the token to the asking tab; the old token dies. */
	reattach(sessionId: string): { token: string; fromByte: number } {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		entry.token = randomUUID();
		return { token: entry.token, fromByte: entry.session.streamBytes() };
	}

	/** Tokened operations — each throws through the fence. */
	send(sessionId: string, token: string, data: string, timeoutMs: number): Promise<TerminalSettleReason> {
		return this.authorized(sessionId, token).send(data, timeoutMs);
	}

	/** Interactive typing — the write never locks and never drops. */
	write(sessionId: string, token: string, data: string): void {
		this.authorized(sessionId, token).write(data);
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

	/** Every live session id (the operator's list — one owner, no scoping). */
	list(): Array<{ id: string; exited: boolean }> {
		return [...this.entries.values()].map((e) => ({ id: e.session.id, exited: e.session.isExited() }));
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

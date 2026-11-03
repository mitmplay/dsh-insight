/**
 * TerminalSession — one live PTY session and its owned process tree
 * (spec 2026-09-24 Wave 2; ADR 2026-09-23 D4/D5/D8).
 *
 * Contracts honored here:
 * - D4: one send in flight; a second refuses SEND_ACTIVE. Sends settle with
 *   exactly stdin_read / inferred_idle / timeout / session_exit — silence
 *   alone is inferred_idle, never completion; stdin_read requires positive
 *   prompt evidence at the tail.
 * - D5: close is a quiescence ladder over the whole session — TERM to the
 *   foreground group, graceMs, KILL to survivors, reap; idempotent; rejects
 *   LINGERING_PIDS rather than claiming a success it cannot prove.
 * - D8: bounded retained tail with spill recovery; offsets are whole-stream
 *   byte coordinates and reads never consume one another.
 *
 * Foreground-group note (W2): the PTY child is a session leader, so the
 * negative-pid kill targets its process group — the foreground group for
 * the sessions DSI opens. A child that creates its own group is reached by
 * the ps-based survivor sweep in the close ladder.
 */
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { open, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as nodePty from 'node-pty';

import { scrubbedChildEnv } from './scrub.js';
import type {
	TerminalOutcome,
	TerminalOutputRead,
	TerminalSessionEvent,
	TerminalSettleReason,
	TerminalSignal,
	TerminalSpec
} from './types.js';

/** Positive prompt evidence: the tail's last line ends with a bare shell
 *  prompt ($ # % >). Overridable per session — the detector is an instance
 *  field, never a hidden global. */
const DEFAULT_PROMPT_DETECT = /(?:^|\r?\n)[$%>#] \r?\n?$/;

/** Reason a close ladder terminated the way it did (internal). */
interface CloseResult {
	quiescent: boolean;
	lingeringPids?: number[];
}

/** Send refusal helper — D4's SEND_ACTIVE is a refusal code, not a settle
 *  reason; sessions surface it as a thrown refusal the registry maps to the
 *  wire. Internal sends use this typed error. */
export class TerminalSendRefusal extends Error {
	readonly code: 'SEND_ACTIVE';
	constructor() {
		super('a send is already in flight for this session');
		this.name = 'TerminalSendRefusal';
		this.code = 'SEND_ACTIVE';
	}
}

let nextSessionId = 1;

export class TerminalSession extends EventEmitter {
	/** Opaque session id (registry scope). */
	readonly id: string;
	readonly pid: number;
	/** The session leader's process group — the foreground group DSI signals. */
	readonly processGroupId: number;

	private readonly spec: TerminalSpec;
	private readonly pty: nodePty.IPty;
	private readonly promptDetect: (tail: string) => boolean;

	private tail = '';
	private tailStartOffset = 0;
	private totalBytes = 0;
	private spillFile = '';
	private spillHandle: import('node:fs/promises').FileHandle | null = null;
	private spillDropped = false;

	private exited = false;
	private outcome: TerminalOutcome | null = null;
	private exitWaiters: Array<(o: TerminalOutcome) => void> = [];
	private sendInFlight = false;
	private passiveSettling = false;
	private closePromise: Promise<CloseResult> | null = null;
	private closedAnnounced = false;

	constructor(
		spec: TerminalSpec,
		options?: { promptDetect?: (tail: string) => boolean; idPrefix?: string }
	) {
		super();
		this.spec = spec;
		this.id = (options?.idPrefix ?? 't') + '-' + nextSessionId++;
		this.promptDetect = options?.promptDetect ?? ((tail) => DEFAULT_PROMPT_DETECT.test(tail));
		this.pty = nodePty.spawn(spec.argv[0], spec.argv.slice(1) as string[], {
			name: spec.terminalType,
			cols: spec.cols,
			rows: spec.rows,
			cwd: spec.cwd,
			env: scrubbedChildEnv({ ...spec.env, TERM: spec.terminalType })
		});
		this.pid = this.pty.pid;
		this.processGroupId = this.pid;
		this.pty.onData((data) => this.onOutput(data));
		this.pty.onExit(({ exitCode, signal }) => this.onExit(exitCode, signal));
	}

	// ── output ring (D8) ─────────────────────────────────────────────────

	private onOutput(data: string): void {
		const bytes = Buffer.byteLength(data);
		this.totalBytes += bytes;
		this.tail += data;
		if (Buffer.byteLength(this.tail) > this.spec.tailBytes + Math.min(64 * 1024, this.spec.tailBytes)) {
			this.trimTail();
		}
		this.emit('event', { type: 'output', bytes: data, nextOffset: this.totalBytes } satisfies TerminalSessionEvent);
	}

	/** Drop the head past the cap; the dropped bytes land in the spill file. */
	private trimTail(): void {
		// Drop to ~half the cap so trims are amortized, not per-chunk.
		let cut = 0;
		while (cut < this.tail.length && Buffer.byteLength(this.tail.slice(0, cut)) < Buffer.byteLength(this.tail) - this.spec.tailBytes) {
			cut = this.tail.indexOf('\n', cut + 1);
			if (cut === -1) {
				cut = this.tail.length;
				break;
			}
		}
		if (cut <= 0) return;
		const dropped = this.tail.slice(0, cut);
		void this.spillAppend(dropped);
		this.tailStartOffset += Buffer.byteLength(dropped);
		this.tail = this.tail.slice(cut);
	}

	private async spillAppend(dropped: string): Promise<void> {
		try {
			if (!this.spillFile) {
				this.spillFile = join(tmpdir(), 'dsi-terminal-' + this.id + '.spill');
				await mkdir(tmpdir(), { recursive: true });
				await rm(this.spillFile, { force: true });
			}
			this.spillHandle ??= await open(this.spillFile, 'a');
			await this.spillHandle.writeFile(dropped);
			this.spillDropped = true;
		} catch {
			// Spill is best-effort recovery: losing it only promotes lossy reads.
			this.spillDropped = false;
			this.spillFile = '';
			this.spillHandle = null;
		}
	}

	/** Cursor-free read of the retained stream (never consumes).
	 *  @mirrors SubprocessOutputReader.readFrom */
	readFrom(fromByte: number): TerminalOutputRead {
		const end = this.totalBytes;
		const tailStart = this.tailStartOffset;
		if (fromByte < tailStart) {
			return {
				text: this.tail,
				nextOffset: end,
				lossy: true,
				spillPath: this.spillDropped ? this.spillFile : undefined
			};
		}
		const skip = Math.max(0, fromByte - tailStart);
		return { text: this.tail.slice(skip), nextOffset: end, lossy: false };
	}

	// ── lifecycle ────────────────────────────────────────────────────────

	private onExit(exitCode: number, signal: number | undefined): void {
		this.exited = true;
		this.outcome = {
			exitCode,
			signal: (signal === undefined ? null : signal) as NodeJS.Signals | null
		};
		this.emit('event', { type: 'exit', outcome: this.outcome } satisfies TerminalSessionEvent);
		for (const wake of this.exitWaiters) wake(this.outcome);
		this.exitWaiters = [];
	}

	/** Resolves when the top-level process exits. */
	private waitForExit(): Promise<TerminalOutcome> {
		if (this.outcome) return Promise.resolve(this.outcome);
		return new Promise((resolve) => this.exitWaiters.push(resolve));
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** Current retained tail (prompt detection input). */
	getTail(): string {
		return this.tail;
	}

	/** Whole-stream byte coordinate of the live tail (reattach resume point).
	 *  Named past the field — a same-named method would be shadowed by the
	 *  field initializer at runtime. */
	streamBytes(): number {
		return this.totalBytes;
	}

	/** Exit facts once the top-level process exited; null while live. */
	exitOutcome(): TerminalOutcome | null {
		return this.outcome;
	}

	isExited(): boolean {
		return this.exited;
	}

	// ── send (D4) ────────────────────────────────────────────────────────

	/**
	 * Write text to the terminal and wait for one settle fact. Exactly one
	 * send may be in flight; a second refuses SEND_ACTIVE.
	 * @param data - text delivered verbatim (append \\n to submit a line).
	 * @param timeoutMs - hard bound for the whole wait.
	 */
	async send(data: string, timeoutMs: number): Promise<TerminalSettleReason> {
		if (this.sendInFlight) throw new TerminalSendRefusal();
		if (this.exited) return 'session_exit';
		this.sendInFlight = true;
		try {
			const baseline = this.tail.length;
			this.pty.write(data);
			const deadline = Date.now() + timeoutMs;
			let sawOutput = false;
			let lastActivity = Date.now();
			const onOutput = () => {
				sawOutput = true;
				lastActivity = Date.now();
			};
			this.on('event', onOutput);
			try {
				for (;;) {
					let reason: TerminalSettleReason;
					if (this.exited) reason = 'session_exit';
					else if (this.promptDetect(this.tail.slice(baseline))) reason = 'stdin_read';
					else if (sawOutput && Date.now() - lastActivity >= this.spec.idleMs) reason = 'inferred_idle';
					else if (Date.now() >= deadline) reason = 'timeout';
					else {
						await this.sleep(25);
						continue;
					}
					this.emit('event', { type: 'settled', reason } satisfies TerminalSessionEvent);
					return reason;
				}
			} finally {
				this.off('event', onOutput);
			}
		} finally {
			this.sendInFlight = false;
		}
	}

	/**
	 * Interactive typing — plain write, never locked, never dropped (the
	 * xterm/input path). A passive settle observer runs when no awaited send
	 * is watching, so the wire still gets settle facts for the badge.
	 */
	write(data: string): void {
		if (this.exited) return;
		this.pty.write(data);
		this.startPassiveSettle();
	}

	/** Resize the PTY to the client's fitted dims (Terminal Desk ADR
	 *  amendment 2026-11-03, mirroring the DSH handle's `resize` fact 2):
	 *  the shell re-reads winsize and re-prints its right prompt inside the
	 *  viewport instead of spilling past the last column. Clamped to sane
	 *  bounds; a dead session is a no-op. */
	resize(cols: number, rows: number): void {
		if (this.exited) return;
		const c = Math.max(2, Math.min(500, Math.floor(cols)));
		const r = Math.max(2, Math.min(200, Math.floor(rows)));
		this.pty.resize(c, r);
	}

	/** One passive settle observation; concurrent writes share the watcher. */
	private startPassiveSettle(): void {
		if (this.passiveSettling || this.sendInFlight) return;
		this.passiveSettling = true;
		void (async () => {
			const deadline = Date.now() + 30_000;
			let lastActivity = Date.now();
			let sawOutput = false;
			const onOutput = () => {
				sawOutput = true;
				lastActivity = Date.now();
			};
			this.on('event', onOutput);
			try {
				const baseline = this.tail.length;
				for (;;) {
					let reason: TerminalSettleReason | null = null;
					if (this.exited) reason = 'session_exit';
					else if (this.promptDetect(this.tail.slice(baseline))) reason = 'stdin_read';
					else if (sawOutput && Date.now() - lastActivity >= this.spec.idleMs) reason = 'inferred_idle';
					else if (Date.now() >= deadline) reason = 'timeout';
					if (reason) {
						this.emit('event', { type: 'settled', reason } satisfies TerminalSessionEvent);
						return;
					}
					await this.sleep(50);
				}
			} finally {
				this.off('event', onOutput);
				this.passiveSettling = false;
			}
		})();
	}

	// ── foreground group signalling ──────────────────────────────────────

	/** Deliver one allowlisted signal to the foreground group.
	 *  @returns the exact group id that received it. */
	signalForeground(signal: TerminalSignal): number {
		if (this.exited) throw new Error('session exited');
		process.kill(-this.processGroupId, signal);
		return this.processGroupId;
	}

	// ── close ladder (D5) ────────────────────────────────────────────────

	/** pid → ppid snapshot of the live process table. */
	private processTable(): Map<number, number> {
		const out = spawnSync('ps', ['-ax', '-o', 'pid=,ppid='], { encoding: 'utf8' });
		const table = new Map<number, number>();
		if (out.status !== 0 || !out.stdout) return table;
		for (const line of out.stdout.split('\n')) {
			const m = line.trim().match(/^(\d+)\s+(\d+)$/);
			if (m) table.set(Number(m[1]), Number(m[2]));
		}
		return table;
	}

	/** All descendants of a pid (any process group) from one snapshot —
	 *  job-control shells move background children to their own group, so a
	 *  pgid filter alone would orphan them. */
	private descendantPids(root: number, table: Map<number, number>): number[] {
		const children = new Map<number, number[]>();
		for (const [pid, ppid] of table) {
			const list = children.get(ppid) ?? [];
			list.push(pid);
			children.set(ppid, list);
		}
		const found: number[] = [];
		const walk = (pid: number): void => {
			for (const child of children.get(pid) ?? []) {
				found.push(child);
				walk(child);
			}
		};
		walk(root);
		return found;
	}

	private alive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	private async killSurvivors(survivors: number[], signal: NodeJS.Signals): Promise<void> {
		for (const pid of survivors) {
			try {
				process.kill(pid, signal);
			} catch {
				// already gone — that is what we wanted
			}
		}
	}

	/**
	 * TERM the foreground group, wait graceMs, KILL the session tree, reap.
	 * Idempotent: a second call awaits the first ladder's result.
	 */
	close(): Promise<CloseResult> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = this.runCloseLadder();
		return this.closePromise;
	}

	private async runCloseLadder(): Promise<CloseResult> {
		try {
			// Snapshot BEFORE the TERM: once the shell exits, orphans reparent
			// to init and their ancestry becomes unprovable.
			const descendants = this.descendantPids(this.pid, this.processTable());
			if (!this.exited) {
				try {
					this.signalForeground('SIGTERM');
				} catch {
					// group may already be gone; the exit wait decides
				}
				const termOutcome = await Promise.race([
					this.waitForExit(),
					this.sleep(this.spec.graceMs).then(() => null)
				]);
				if (!termOutcome) {
					// KILL tier: the whole session tree
					try {
						process.kill(-this.processGroupId, 'SIGKILL');
					} catch {
						// group already gone
					}
					await this.waitForExit();
				}
			}
			// Reap: any descendant the TERM ladder did not take with it.
			let survivors = descendants.filter((pid) => this.alive(pid));
			if (survivors.length > 0) {
				await this.killSurvivors(survivors, 'SIGKILL');
				await this.sleep(100);
				survivors = survivors.filter((pid) => this.alive(pid));
			}
			if (!this.closedAnnounced) {
				this.closedAnnounced = true;
				this.emit('event', {
					type: 'closed',
					quiescent: survivors.length === 0,
					lingeringPids: survivors.length > 0 ? survivors : undefined
				} satisfies TerminalSessionEvent);
			}
			await this.dispose();
			return survivors.length > 0 ? { quiescent: false, lingeringPids: survivors } : { quiescent: true };
		} catch (err) {
			// A failed close must reject rather than claim success (D5).
			throw err instanceof Error ? err : new Error(String(err));
		}
	}

	/** Release file handles; safe to call once the ladder settled. */
	private async dispose(): Promise<void> {
		if (this.spillHandle) {
			await this.spillHandle.close().catch(() => undefined);
			this.spillHandle = null;
		}
	}
}


/**
 * Terminal contracts for DSI's operator terminal — deliberate mirrors of
 * DeepSeek Harness's subprocess terminal vocabulary (ADR 2026-09-23,
 * "The Web Terminal — DSI Mirrors the Contracts, Not the Library", D2).
 *
 * Every mirrored declaration carries an ~BT@@mirrors` tag naming the DSH
 * source it copies. `tests/unit/terminal-contract.test.ts` re-reads the
 * DSH checkout and pins these members — a drift failure means DSH moved
 * and DSI follows on purpose. `NOT_ENABLED` is the one DSI-native code
 * (the config flag gate); it is an addition, never a substitution.
 *
 * DSI runs no Cordis context: these are plain types, and the runtime that
 * honors them lives in this module directory (session.ts, registry.ts).
 */

/** Signals deliverable to the terminal's foreground process group. Kept
 *  member-identical to DSH's `SubprocessTerminalSignal` — change with it.
 *  @mirrors deepseek-harness/packages/subprocess/subprocess/src/types.ts:203 */
export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP';

/** Why one send-wait settled. Member-identical to dsh-terminal's settle
 *  reasons; `inferred_idle` (output silence) is a send-wait exit only,
 *  never proof a foreground command completed.
 *  @mirrors deepseek-harness/packages/terminal/terminal/README.md
 *           ("Sends settle with a wait reason") */
export type TerminalSettleReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit';

/** Stable machine-routable refusals. Names mirror dsh-terminal's codes;
 *  `NOT_ENABLED` is DSI-native (the `terminal.enabled` config gate).
 *  @mirrors deepseek-harness/packages/terminal/terminal/README.md
 *           ("Failures carry stable machine-routable codes") */
export type TerminalRefusalCode =
	| 'SEND_ACTIVE'
	| 'FOREIGN_SESSION'
	| 'NO_SESSION'
	| 'NOT_ENABLED'
	| 'LINGERING_PIDS';

/**
 * A fully specified terminal spawn — the seam applies NO defaults: the
 * transport's `resolve(request): Spec` step fills every field from
 * operator config before this type is constructed (ADR D3).
 * @mirrors deepseek-harness/packages/subprocess/subprocess/src/types.ts:214-233
 *          (SubprocessTerminalSpawnSpec; DSI omits the harness-internal
 *          signal and shellActivity knobs — allocation is synchronous
 *          in-process and activity observation rides the send-settle watcher)
 */
export interface TerminalSpec {
	/** Executable and arguments; argv[0] is the program. */
	argv: readonly string[];
	/** Working directory for the shell. */
	cwd: string;
	/** Explicit environment layered over the scrubbed base (see scrub.ts). */
	env?: Record<string, string> | undefined;
	/** Initial terminal row count. */
	rows: number;
	/** Initial terminal column count. */
	cols: number;
	/** Terminal emulation advertised to the child through TERM. */
	terminalType: string;
	/** TERM-to-KILL cleanup grace for the complete terminal session. */
	graceMs: number;
	/** Output-silence bound a send-wait may settle on as inferred_idle. */
	idleMs: number;
	/** DSI-native (no DSH counterpart): retained output tail cap in bytes;
	 *  the dropped head recovers from the session's spill file (ADR D8). */
	tailBytes: number;
}

/** One settled send. The reason is a fact the waiter reports; silence is
 *  never interpreted into it.
 *  @mirrors deepseek-harness/packages/subprocess/subprocess/src/types.ts:116-121 */
export interface TerminalSettle {
	reason: TerminalSettleReason;
}

/** Exit facts of the top-level terminal process — Node's close-event
 *  vocabulary.
 *  @mirrors deepseek-harness/packages/subprocess/subprocess/src/types.ts:116-121
 *           (SubprocessOutcome) */
export interface TerminalOutcome {
	/** Exit code; null when the process died from a signal. */
	exitCode: number | null;
	/** Terminating signal; null on normal exit. */
	signal: NodeJS.Signals | null;
}

/** One incremental output read from the retained tail. Offsets are
 *  whole-stream byte coordinates owned by the caller, so a late attacher
 *  and the live stream never consume one another.
 *  @mirrors deepseek-harness/packages/subprocess/subprocess/src/types.ts:123-133
 *           (SubprocessOutputRead) */
export interface TerminalOutputRead {
	/** Tail text from the requested offset (whole retained tail when lossy). */
	text: string;
	/** Whole-stream offset to resume from on the next read. */
	nextOffset: number;
	/** True when the offset slid out of the retained tail window. */
	lossy: boolean;
	/** Spill file holding the dropped head, when one exists and is intact. */
	spillPath?: string;
}

/** Who holds the write baton — a LABEL recorded at the mint, never a
 *  credential (ADR-0079 D1/D3). `operator` = the desk tab (the default:
 *  every panel mount re-attaches, so the common minter IS the operator),
 *  `automation` = a driver that labeled its reattach, `unassigned` = a
 *  released baton nobody holds (D4). DSI-native — no DSH counterpart. */
export type BatonHolder = 'operator' | 'automation' | 'unassigned';

/** The baton facet — the registry's read-only description of the lease
 *  (ADR-0079 D1/D2/D5/D6). It rides the open-watch paths (`peek`/`list`
 *  → GET /api/terminal) token-free: the facet DESCRIBES the lease, the
 *  fence keeps enforcing it. DSI-native — no DSH counterpart. */
export interface BatonFacet {
	holder: BatonHolder;
	/** The driver's label while `automation` holds; null otherwise. */
	holderId: string | null;
	/** Epoch ms of the current mint (create / reattach / release). */
	since: number;
	/** Epoch ms of the last fence-accepted write; null until one lands. */
	lastWriteAt: number | null;
	/** The operator's hard opt-out (D6) — wire-only in v1, no desk toggle. */
	pinned: boolean;
	/** D5, conservative and DERIVED at read time (stored nowhere):
	 *  `!exited && !pinned && holder !== 'operator'` — an operator-held
	 *  terminal is never ready, however long it stays idle. */
	readyForAutomation: boolean;
}

/** Where a session WANTS to be seen on the Terminal Desk (ADR 2026-11-24
 *  The Headless Split, D2) — set at birth by the mint, stored on the
 *  registry record, echoed in list() and in the session-born event. An
 *  unset intent is the headless ghost: alive, legal, never adoptable.
 *  DSI-native — no DSH counterpart. */
export type TerminalDeskIntent = 'new-tab' | 'split-down';

/** The readiness facet (ADR-0080 D1/D2) - the server's time-based settle
 *  assertion: the shell produced no output for >= idleMs. NOT a prompt
 *  claim; the half-typed line stays the agent's peek (D2). DSI-native. */
export interface SessionReadiness {
	/** True when `!exited && lastOutputAt !== null && now - lastOutputAt >= idleMs`. */
	settled: boolean;
	/** Epoch ms when settled last became true (lastOutputAt + idleMs);
	 *  null while unsettled or on a fresh open with no output yet. */
	settledSince: number | null;
	/** The last settle reason the passive observer / send recorded
	 *  (ADR-0079's badge fact, now surfaced); null while unsettled. */
	reason: TerminalSettleReason | null;
}

/** Events a live session emits. The transport's SSE route projects these
 *  one-to-one; nothing else observes a session's internals.
 *  @mirrors deepseek-harness/packages/subprocess/subprocess/src/types.ts:257-296
 *           (the handle's observable facts, re-expressed as events because
 *           DSI's consumer is a wire route, not an in-process caller).
 *           The `baton` variant is DSI-native (ADR-0079 D7): an addition,
 *           never a substitution — the registry pushes it on the session's
 *           own channel at every mint and release so the desk learns of a
 *           takeover the moment it happens. */
export type TerminalSessionEvent =
	| { type: 'output'; bytes: string; nextOffset: number }
	| { type: 'settled'; reason: TerminalSettleReason }
	| { type: 'exit'; outcome: TerminalOutcome }
	| { type: 'closed'; quiescent: boolean; lingeringPids?: number[] }
	| { type: 'baton'; holder: BatonHolder; holderId: string | null; since: number };

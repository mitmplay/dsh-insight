/**
 * Runtime mirrors of the src terminal contract types (types erase at
 * runtime, so the drift test compares these literal lists — and the
 * satisfies-assertions below fail the type-check if the lists drift
 * from src/lib/server/terminal/types.ts).
 */
import type { BatonHolder, TerminalRefusalCode, TerminalSessionEvent, TerminalSettleReason, TerminalSignal } from '$lib/server/terminal/types.js';

export const TERMINAL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'] as const satisfies readonly TerminalSignal[];

/** Baton holder vocabulary (ADR-0079 D1/D3) — DSI-native, no DSH counterpart;
 *  the `satisfies` fails the type-check if the union in types.ts moves. */
export const BATON_HOLDERS = ['operator', 'automation', 'unassigned'] as const satisfies readonly BatonHolder[];

/** Every event type a live session may emit — the four DSH-mirrored facts
 *  plus the DSI-native `baton` frame (ADR-0079 D7). */
export const TERMINAL_SESSION_EVENT_TYPES = ['output', 'settled', 'exit', 'closed', 'baton'] as const satisfies readonly TerminalSessionEvent['type'][];

/** Member names the baton frame carries on the wire (the stream routes
 *  project exactly these; the hub adds its sessionId tag). */
export const BATON_EVENT_MEMBERS = ['type', 'holder', 'holderId', 'since'] as const;

export const TERMINAL_SETTLE_REASONS = ['stdin_read', 'inferred_idle', 'timeout', 'session_exit'] as const satisfies readonly TerminalSettleReason[];

export const TERMINAL_REFUSAL_CODES = ['SEND_ACTIVE', 'FOREIGN_SESSION', 'NO_SESSION', 'NOT_ENABLED', 'LINGERING_PIDS'] as const satisfies readonly TerminalRefusalCode[];

/** Member names TerminalSpec must carry (the no-defaults seam). */
export const TERMINAL_SPEC_MEMBERS = ['argv', 'cwd', 'env', 'rows', 'cols', 'terminalType', 'graceMs', 'idleMs'] as const;

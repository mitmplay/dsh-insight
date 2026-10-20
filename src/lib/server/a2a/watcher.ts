/**
 * a2a-watcher (2026-08-25) — the two-lane delegation watcher: a cheap
 * batched LIST every fastPollMs (ONE session.list per tick for ALL
 * waiting targets), and a LEDGER read (history tail) only when a gate
 * opens — a completed new turn. Zero model calls by construction: the
 * watcher only READS spine rows and the ledger; any prompt/RPC that runs
 * a model is outside these paths (3.1-T spy-asserts the absence).
 *
 * SEQ lane (2026-08-25 bug fix): live hosts ship no `sessionStats.turns`
 * and their list projection's updatedAt/running never move on replies —
 * the LIST gate is structurally dead there (probe-verified). Rows with a
 * captured `watermark_seq` (the target ledger's newest event seq at
 * send, from the register route) are probed on a throttled second lane:
 * one history read per DISTINCT target per A2A_SEQ_PROBE_MS window; the
 * newest assistant/message past the watermark settles the row at its
 * true tier. Zero model calls still hold — history is a read.
 *
 * SPAN capture (2026-08-25 RCA #2, live a2a-30b51db8): a turn is N
 * assistant bubbles (narration before tool calls + one final digest),
 * but the delivered protocol line binds only the END — so `reply_text`
 * holding just the newest message froze everything the target narrated
 * on the way. Settle now stores the JOINED text of every assistant
 * message in the exchange's span. The span anchor is the delivered
 * prompt itself (the user message carrying `_a2a_:<id>;` — unique per
 * delegation), NOT the register-time watermark: registration can land
 * seconds after the prompt, by which time the target has already
 * narrated past it. A LATER delegation's prompt bounds the span, so
 * stacked mentions never swallow each other's replies. Classification
 * is unchanged — the end-signature tier contract (ADR §4) still rules.
 *
 * ADR: dev/architectural-decission/2026-08-26 - The a2a Signature —
 *      Correlation IDs and the Delegation Ledger.md §5 (two-lane
 *      detection contract) + The Mention Watcher ADR (detection half).
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD "Watcher sequence", tier map; Tasks 3.1/3.1-T).
 *
 * Module boundary (PRD communication map): watcher imports dsh-connection
 * only — NEVER dsh-rpc directly; the matcher is pure; the db owns writes.
 * Lifecycle: module-level singleton; registerWatch() ensures started;
 * ticker stops at zero waiting; boot sweep resumes.
 *
 * Config sync (W4 4.1): readA2aConfig() is applied ONCE at boot, before
 * the first sweep — runtime edits take effect on the next dev-server
 * restart (the no-cache reader contract). Test fakes inject timings
 * through configureWatcher; they run in files whose DSI_CONFIG_PATH is
 * pinned to a tmp void, so the boot sync never clobbers them.
 */

import { getDshConnection, type DshHistoryPage } from '$lib/server/dsh-connection.js';
import { readA2aConfig } from '$lib/server/insight-config.js';
import { entryForEvent, historyToEvents } from '$lib/services/conversation/dsh-events.js';
import { classifyReply } from './matcher.js';
import {
	insertWaiting,
	listWaiting,
	openA2aDb,
	pruneTerminalBefore,
	settleRow,
	type A2aExchangeRow,
	type A2aInsertWaiting
} from './db.js';

// ── Timing (server defaults; W4 wires these to the a2a.* config section) ──

/** LIST-lane cadence — one batched session.list per tick (default 1s). */
export const A2A_FAST_POLL_MS = 1_000;
/** Deadline for a reply before honest `timeout` (default 10 min). */
export const A2A_WATCH_TIMEOUT_MS = 600_000;
/** Terminal-row retention before boot-sweep prune (default 90 days). */
export const A2A_RETENTION_DAYS = 90;
/**
 * SEQ-lane probe cadence (2026-08-25 bug fix): when the host ships no
 * `sessionStats.turns` AND its list projection's updatedAt/running never
 * move on replies (probe-verified live), the LIST gate is structurally
 * dead — the target LEDGER's event seq is the only signal that moves.
 * One history read per DISTINCT waiting target per window; zero model
 * calls still hold (history is a read).
 */
export const A2A_SEQ_PROBE_MS = 5_000;
/**
 * SEQ-lane quiescence (2026-08-25 RCA follow-up, risk 1 — mid-turn latch):
 * the live host's `running` is inert, so the seq lane cannot ask "is the
 * target done?". Instead it watches the tail itself: a settle is allowed
 * only when the target's newest event seq has been UNCHANGED for this
 * long. A turn still writing keeps moving the tail and resets the clock —
 * the fragment-early settle (a2a-0e657adf) becomes impossible.
 */
export const A2A_QUIESCENCE_MS = 3_000;

/** The watcher's read surface on the spine — narrow by design. */
export interface WatcherSpineRow {
	sessionId: string;
	title: string | null;
	running: boolean;
	updatedAt: number;
	/** Completed-turn watermark; null when the host row lacks it. */
	turns: number | null;
}

/** Injectable DSH surface — tests pass fakes; production uses the singleton. */
export interface WatcherDshSurface {
	listSessions(): Promise<{ items: WatcherSpineRow[] }>;
	history(sessionId: string): Promise<DshHistoryPage>;
}

/** Injectable knobs (W4 config wiring; tests use the dsh fake + timings). */
export interface WatcherOptions {
	fastPollMs?: number;
	watchTimeoutMs?: number;
	retentionDays?: number;
	/** SEQ-lane probe window per target (tests shrink to 0). */
	probeWindowMs?: number;
	/** SEQ-lane tail-quiescence gate (tests shrink to 0). */
	quiescenceMs?: number;
	/** Fakes inject an explicit surface; production uses getDshConnection(). */
	dsh?: WatcherDshSurface;
}

// ── Reply extraction (LEDGER lane — the exchange's full span) ──

/** What one settle stores: the span's joined text + the wire's turn number. */
export interface ReplySpan {
	text: string;
	turn: number;
	/** The seq the span starts after (prompt anchor or watermark); -1 legacy. */
	anchorSeq: number;
}

/** Assemble one event's entry text via the shipped reader, or null. */
function entryText(h: DshHistoryPage['events'][number]): string | null {
	const entry = entryForEvent(historyToEvents([h])[0]);
	if (entry === null) return null;
	if (entry.kind !== 'assistant-message' && entry.kind !== 'user-message') return null;
	return typeof entry.text === 'string' && entry.text !== '' ? entry.text : null;
}

/**
 * Seq of the LAST user message carrying THIS exchange's signature — the
 * delivered protocol line makes every delegation's prompt uniquely
 * findable in the page (SPAN anchor #1). Null when the prompt is off the
 * tail page or the sender carried no signature.
 */
function promptAnchorSeq(page: DshHistoryPage, id: string): number | null {
	let found: number | null = null;
	for (const h of page.events) {
		if (h.event.type !== 'user/message') continue;
		const text = entryText(h);
		if (text === null) continue;
		if (text.includes(`_a2a_:${id};`)) found = h.event.seq;
	}
	return found;
}

/**
 * Seq of the first prompt of any LATER delegation (any `_a2a_:` marker)
 * after `start` — the span's upper bound, so stacked mentions on one
 * target never swallow each other's replies. Null when none follows.
 */
function nextDelegationSeq(page: DshHistoryPage, start: number): number | null {
	for (const h of page.events) {
		if (h.event.seq <= start) continue;
		if (h.event.type !== 'user/message') continue;
		const text = entryText(h);
		if (text !== null && text.includes('_a2a_:a2a-')) return h.event.seq;
	}
	return null;
}

/**
 * Newest finalized assistant bubble from a history tail page, or null —
 * the LEGACY shape (pre-span): one message, no join. Kept as the
 * no-anchor fallback so a page without resolvable anchors never
 * over-captures history from before this exchange.
 */
export function extractLatestAssistantText(page: DshHistoryPage): {
	text: string;
	turn: number;
} | null {
	for (let i = page.events.length - 1; i >= 0; i--) {
		const h = page.events[i];
		if (h.event.type !== 'assistant/message') continue;
		const text = entryText(h);
		if (text === null) continue;
		const turn = h.event.data?.turn;
		return { text, turn: typeof turn === 'number' ? turn : -1 };
	}
	return null;
}

/**
 * The exchange's full span (SPAN capture, 2026-08-25 RCA #2): every
 * non-empty assistant message after the anchor, JOINED with blank lines
 * — narration before tool calls included, empty tool-call bubbles
 * dropped, `turn` from the newest contributing message.
 *
 * Anchor precedence: (1) the delivered prompt's own signature line —
 * robust to late registration, which is exactly when a register-time
 * watermark strands early narration below it; (2) the register-time seq
 * watermark; (3) neither resolvable → legacy newest-only, never a
 * whole-page guess. When (1) applies, the next delegation's prompt
 * bounds the span (stacked mentions stay separate).
 */
export function extractReplySpan(
	page: DshHistoryPage,
	id: string,
	fallbackSeq: number | null
): ReplySpan | null {
	const prompt = promptAnchorSeq(page, id);
	const anchor = prompt ?? fallbackSeq;
	if (anchor === null) {
		const latest = extractLatestAssistantText(page);
		return latest === null ? null : { ...latest, anchorSeq: -1 };
	}
	const bound = prompt === null ? null : nextDelegationSeq(page, prompt);
	const parts: Array<{ text: string; turn: number }> = [];
	for (const h of page.events) {
		const seq = h.event.seq;
		if (seq <= anchor) continue;
		if (bound !== null && seq >= bound) break; // events are seq-ascending
		if (h.event.type !== 'assistant/message') continue;
		const text = entryText(h);
		if (text === null) continue;
		const turn = h.event.data?.turn;
		parts.push({ text, turn: typeof turn === 'number' ? turn : -1 });
	}
	if (parts.length === 0) return null;
	const last = parts[parts.length - 1];
	return { text: parts.map((p) => p.text).join('\n\n'), turn: last.turn, anchorSeq: anchor };
}

// ── Settle map (binding tier contract — Task 3.1) ──

/** exact→replied_exact · attributed→replied · none→replied_approx. */
const TIER_TO_STATE = {
	exact: 'replied_exact',
	attributed: 'replied',
	none: 'replied_approx'
} as const;

/** Degrade-lane note (PRD risk 2: host drops sessionStats.turns). */
const TURNS_UNAVAILABLE = 'turns unavailable — settled on updatedAt edge';

/** SEQ-lane degrade note — the list projection never moved (2026-08-25). */
const TURNS_UNAVAILABLE_SEQ = 'turns unavailable — settled on ledger seq watermark';

// ── The singleton (module-level state; one watcher per process) ──

let timer: ReturnType<typeof setInterval> | null = null;
let pollMs = A2A_FAST_POLL_MS;
let timeoutMs = A2A_WATCH_TIMEOUT_MS;
let retentionDays = A2A_RETENTION_DAYS;
let probeWindowMs = A2A_SEQ_PROBE_MS;
let quiescenceMs = A2A_QUIESCENCE_MS;
let dshSurface: WatcherDshSurface | undefined;
let ticking = false;
let tickCount = 0;
let listCalls = 0;
let historyCalls = 0;
let sweeps = 0;
let bootSwept = false;
/** SEQ lane throttle — target → last probe wall-clock (ms). */
let lastSeqProbe = new Map<string, number>();
/** SEQ lane quiescence — target → the tail seq first seen UNCHANGED, and when. */
let tailQuietSince = new Map<string, { seq: number; at: number }>();

/** Test seam: full reset between tests (clears the timer + counters). */
export function __resetWatcherForTests(): void {
	if (timer !== null) clearInterval(timer);
	timer = null;
	ticking = false;
	tickCount = 0;
	listCalls = 0;
	historyCalls = 0;
	sweeps = 0;
	bootSwept = false;
	dshSurface = undefined;
	pollMs = A2A_FAST_POLL_MS;
	timeoutMs = A2A_WATCH_TIMEOUT_MS;
	retentionDays = A2A_RETENTION_DAYS;
	probeWindowMs = A2A_SEQ_PROBE_MS;
	quiescenceMs = A2A_QUIESCENCE_MS;
	lastSeqProbe = new Map();
	tailQuietSince = new Map();
}

/**
 * Config wiring (W4) — validated upstream by $lib/config gates; applied
 * live: a fastPollMs change re-arms the ticker at the new cadence.
 */
export function configureWatcher(opts: WatcherOptions): void {
	if (opts.fastPollMs !== undefined) pollMs = opts.fastPollMs;
	if (opts.watchTimeoutMs !== undefined) timeoutMs = opts.watchTimeoutMs;
	if (opts.retentionDays !== undefined) retentionDays = opts.retentionDays;
	if (opts.probeWindowMs !== undefined) probeWindowMs = opts.probeWindowMs;
	if (opts.quiescenceMs !== undefined) quiescenceMs = opts.quiescenceMs;
	if (opts.dsh !== undefined) dshSurface = opts.dsh;
	// Re-arm at the new cadence if already running (0 = fast lane off —
	// the spine's own 5s poll becomes the only motion; stop our timer).
	if (timer !== null) {
		clearInterval(timer);
		timer = null;
		if (pollMs > 0) armTicker();
	}
}

/** TRUE when the ticker is alive. */
export function isTicking(): boolean {
	return timer !== null;
}

/** Observability for routes/tests — never exposes the DB path. */
export function watcherStats(): {
	ticking: boolean;
	tickCount: number;
	listCalls: number;
	historyCalls: number;
	sweeps: number;
} {
	return { ticking: timer !== null, tickCount, listCalls, historyCalls, sweeps };
}

/** Resolve the active DSH surface (injected fake or the real singleton). */
function surface(): WatcherDshSurface {
	return dshSurface ?? getDshConnection();
}

/** Arm the interval (only when there is something to watch). */
function armTicker(): void {
	if (timer !== null) return;
	if (pollMs <= 0) return; // fast lane disabled — spine cadence rules
	if (listWaiting().length === 0) return;
	timer = setInterval(() => {
		void tick();
	}, pollMs);
}

/**
 * Ensure the watcher runs: boot sweep (once) + arm the ticker if rows
 * are waiting. Idempotent — registerWatch and routes both call this.
 */
export function ensureStarted(): void {
	if (!bootSwept) {
		syncConfigFromInsight();
		sweepOnBoot();
	}
	armTicker();
}

/**
 * One-shot config sync at boot (W4 4.1): the file reader is the truth;
 * explicit configureWatcher values always win (tests, future callers).
 * Reads with NO path argument so the env seam (DSI_CONFIG_PATH) rules.
 */
function syncConfigFromInsight(): void {
	const cfg = readA2aConfig();
	if (pollMs === A2A_FAST_POLL_MS) pollMs = cfg.fastPollMs;
	if (timeoutMs === A2A_WATCH_TIMEOUT_MS) timeoutMs = cfg.watchTimeoutMs;
	if (retentionDays === A2A_RETENTION_DAYS) retentionDays = cfg.retentionDays;
}

/** Stop when nothing is left to watch (the only stop site — same module). */
function stopTickerIfIdle(): void {
	if (timer !== null && listWaiting().length === 0) {
		clearInterval(timer);
		timer = null;
	}
}

/**
 * ONE tick = ONE batched session.list for ALL waiting targets, then the
 * per-row gate; gate-open rows read the LEDGER once and settle at their
 * tier. Timeout/gone are watcher-native (checked before any history read).
 */
export async function tick(): Promise<void> {
	if (ticking) return; // one tick at a time; the next interval fires anyway
	ticking = true;
	tickCount++;
	try {
		const waiting = listWaiting();
		if (waiting.length === 0) {
			stopTickerIfIdle();
			return;
		}
		// LIST lane — ONE batched call regardless of waiting count.
		listCalls++;
		const list = await surface().listSessions();
		const spine = new Map<string, WatcherSpineRow>();
		for (const row of list.items) spine.set(row.sessionId, row);

		// Group gate-open rows by target: ONE history read settles every
		// waiting row of that target against the same tail page (stacked
		// mentions — each row's own signature decides its tier).
		const ledgers = new Map<string, { rows: A2aExchangeRow[]; target: WatcherSpineRow }>();
		// SEQ lane (2026-08-25 fix): rows whose only live watermark is the
		// ledger seq — probed on their own throttled cadence per target.
		const seqLedgers = new Map<string, { rows: A2aExchangeRow[]; target: WatcherSpineRow }>();
		const now = Date.now();
		for (const row of waiting) {
			const target = spine.get(row.toSession);
			if (target === undefined) {
				// Gone: the target left the spine entirely.
				settleRow({ id: row.id, state: 'gone', error: `target ${row.toSession} left the spine` });
				continue;
			}
			// Deadline first: never settle a dead watch as a reply.
			if (now - row.sentAt >= timeoutMs) {
				settleRow({ id: row.id, state: 'timeout', error: `no reply within ${timeoutMs}ms` });
				continue;
			}
			if (gateOpen(row, target)) {
				const group = ledgers.get(row.toSession);
				if (group === undefined) ledgers.set(row.toSession, { rows: [row], target });
				else group.rows.push(row);
				continue;
			}
			// SEQ lane eligibility: a captured seq watermark + probe window open.
			if (
				row.watermarkSeq !== null &&
				now - (lastSeqProbe.get(row.toSession) ?? 0) >= probeWindowMs
			) {
				const group = seqLedgers.get(row.toSession);
				if (group === undefined) seqLedgers.set(row.toSession, { rows: [row], target });
				else group.rows.push(row);
			}
		}
		for (const [sessionId, group] of ledgers) {
			await settleViaHistory(sessionId, group.rows, group.target);
		}
		for (const [sessionId, group] of seqLedgers) {
			lastSeqProbe.set(sessionId, now);
			await settleViaSeqWatermark(sessionId, group.rows, group.target);
		}
		stopTickerIfIdle();
	} catch {
		// Host/poll blip — keep the ticker; the next tick retries. The rows
		// stay waiting (honest); nothing is silently settled on an error.
	} finally {
		ticking = false;
	}
}

/**
 * The gate: a NEW completed turn since the watermark, and not mid-run.
 * turns null → degrade lane (updatedAt edge + running false), flagged
 * `turns_unavailable` on settle.
 */
function gateOpen(row: A2aExchangeRow, target: WatcherSpineRow): boolean {
	if (target.turns !== null) {
		return target.turns > row.watermarkTurn && target.running === false;
	}
	// Degrade: host dropped sessionStats.turns — updatedAt moved past the
	// send AND the running edge passed. Approximate by construction.
	return target.updatedAt > row.sentAt && target.running === false;
}

/**
 * LEDGER lane: one history tail read for the target → per-row tier
 * classification → single settle UPDATE each. A turn whose text carries
 * the id for ANY waiting row settles that row (page-level per-row match).
 */
async function settleViaHistory(
	sessionId: string,
	rows: A2aExchangeRow[],
	target: WatcherSpineRow
): Promise<void> {
	historyCalls++;
	let page: DshHistoryPage;
	try {
		page = await surface().history(sessionId);
	} catch {
		// History read failed — rows stay waiting; the deadline lane owns
		// them if this keeps failing (never settle on a read error).
		return;
	}
	for (const row of rows) {
		// SPAN capture: each row resolves its OWN span (its prompt's
		// signature anchors it) — stacked mentions classify independently.
		const span = extractReplySpan(page, row.id, row.watermarkSeq);
		if (span === null) {
			// Turn completed but no assistant text survived the mapping —
			// watermark-crossed with an honest note, never a confident fib.
			settleRow({
				id: row.id,
				state: 'replied_approx',
				error: 'turn completed without assistant text'
			});
			continue;
		}
		const tier = classifyReply(span.text, row.id);
		settleRow({
			id: row.id,
			state: TIER_TO_STATE[tier],
			replyText: span.text,
			replyTurn: span.turn,
			...(target.turns === null ? { error: TURNS_UNAVAILABLE } : {})
		});
	}
}

/**
 * SEQ lane (2026-08-25 fix): one history read per DISTINCT target per
 * probe window; per row, the NEWEST finalized assistant message whose
 * event seq exceeds the row's captured seq watermark is the reply.
 *
 * Quiescence gate (RCA follow-up, risk 1): the live host's `running` is
 * inert, so "is the target done?" is answered by the tail itself — settle
 * only when the target's newest event seq has been UNCHANGED for
 * quiescenceMs. A turn still writing keeps moving the tail (every probe
 * that sees a new tail records it and returns without settling); the
 * first-ever probe also just records. Silence-then-settle means the
 * FINAL message is the newest past the watermark — the fragment-early
 * settle is impossible. Rows whose reply hasn't landed stay waiting; the
 * deadline lane owns them if it never does.
 */
async function settleViaSeqWatermark(
	sessionId: string,
	rows: A2aExchangeRow[],
	target: WatcherSpineRow
): Promise<void> {
	historyCalls++;
	let page: DshHistoryPage;
	try {
		page = await surface().history(sessionId);
	} catch {
		// History read failed — retry at the next probe window; the
		// deadline lane owns persistent failure (never settle on a read error).
		return;
	}
	// Quiescence: first sight or a MOVED tail records and waits — a target
	// still writing must never be settled on a fragment.
	const tailSeq = page.events.length > 0 ? page.events[page.events.length - 1].event.seq : -1;
	const quiet = tailQuietSince.get(sessionId);
	const now = Date.now();
	if (quiet === undefined || quiet.seq !== tailSeq) {
		tailQuietSince.set(sessionId, { seq: tailSeq, at: now });
		return;
	}
	if (now - quiet.at < quiescenceMs) return; // quiet, but not long enough
	const degrade = target.turns === null ? { error: TURNS_UNAVAILABLE_SEQ } : {};
	for (const row of rows) {
		// SPAN capture: the row's whole exchange (prompt-anchored, bounded
		// by the next delegation) joined — nothing past the anchor keeps
		// the row waiting below; nothing at all keeps it waiting here.
		const span = extractReplySpan(page, row.id, row.watermarkSeq);
		if (span === null) continue;
		const tier = classifyReply(span.text, row.id);
		settleRow({
			id: row.id,
			state: TIER_TO_STATE[tier],
			replyText: span.text,
			replyTurn: span.turn,
			...degrade
		});
	}
}

/**
 * Sweep on boot (dev-server restart mid-watch): expire stale waiting rows
 * past the deadline, prune terminal rows past retention, resume the
 * ticker if waiting rows remain. Runs once per process before the first
 * tick (ensureStarted guards with bootSwept).
 */
export function sweepOnBoot(): void {
	sweeps++;
	bootSwept = true;
	const db = openA2aDb();
	const now = Date.now();
	// 1. Expire stale waiting rows — honest timeout, boot-noted.
	const stale = db
		.prepare(`SELECT id FROM a2a_exchange WHERE state = 'waiting' AND sent_at + ? <= ?`)
		.all(timeoutMs, now) as Array<{ id: string }>;
	for (const r of stale) {
		settleRow(
			{ id: r.id, state: 'timeout', error: `no reply within ${timeoutMs}ms (boot sweep)` },
			db
		);
	}
	// 2. Retention prune — terminal rows settled before the cutoff.
	pruneTerminalBefore(now - retentionDays * 24 * 60 * 60 * 1_000, db);
}

/**
 * Register a watch (INSERT waiting) and ensure the watcher runs. The
 * registration route (3.2) calls this server-side at send.
 */
export function registerWatch(row: A2aInsertWaiting): void {
	insertWaiting(row);
	ensureStarted();
}

/**
 * macro-runner — module-scope reactive feeder for the Prompt Macro
 * (ADR "The Prompt Macro" D3, 2026-08-29; sectioned 2026-08-29 — "The
 * Sectioned Row" ADR, D11/D13): one saved shelf row, compiled into
 * SECTIONS by the pure compiler and fed to the shared command-executor
 * one section at a time, receipt by receipt. The host's prompt queue
 * sequences the turns (queue mode is the wire default); the runner
 * NEVER waits on a turn and NEVER polls — the only await is a route
 * receipt (D3/D4).
 *
 * Section grammar (compileRow, macro-sections.ts — W1 1.1):
 *   mention-block → executor.executeCommand mention, args = sendText
 *                   (the joined message — inline remainder + following
 *                   non-blank lines, newline-intact)
 *   command       → executor.executeCommand, exactly as the line grammar
 *   query         → GET /api/prompts?q&mode=contains; the top hit's text
 *                   is COMPILED and its sections splice into the queue
 *                   (visited-set guards cycles; depth/section caps bound
 *                   the walk — a block counts as ONE section, D15)
 *   send-block    → ONE sendPrompt(sendText) — newlines intact, never
 *                   line-per-line (one block = one turn = one ledger entry)
 *
 * Fail-loud (D4): an empty ? search, a rejected receipt, a failed /new,
 * or a cap breach stops the run with the reason on the sheet. One run at
 * a time per runner scope; a second start is refused with a note.
 *
 * State shape (per-section records feed the run sheet, kind-driven W2 2.2):
 *   idle · feeding k/n · held · fed · stopped(abort) · failed
 *
 * Chip ownership (2026-08-29 addendum remediation): the sheet is claimed
 * by whichever panel currently shows targetSessionId — the /new handoff
 * retargets it, so the chip crosses the swap that remounts the panel.
 *
 * BC-2: client service — no $lib/server imports; no timers (the sheet
 * reads the panel's own poll truth for ✓/▶, never this module).
 */

import { appConfig } from '$lib/services/config/app-config.svelte';
import { compileRow, type SectionRecord } from './macro-sections';
import { parseCommand, type ParsedCommand } from './command-parser';
import { executeCommand, sendPrompt, type ExecutorContext } from './command-executor';
import type { SuggestedPrompt } from './prompt-trigger.js';

/** One section's lifecycle, as the sheet renders it (✓ ▶ ⏳ ⊙ ⊘ ✕). */
export type MacroLineState =
	| 'pending' // ⏳ not yet fed
	| 'queued' // ⊙ receipt accepted; the host owns the turn now
	| 'done' // ✓ (panel-derived: its assistant turn landed — W2 2.2)
	| 'skipped' // ⊘ visited-set skip: resolved to a row already in this run
	| 'failed'; // ✕ the run stopped here

/** The sheet's record kind — the section kind with `-block` stripped
 *  (send-block → send, mention-block → mention; command and query pass
 *  through — D14): blocks are delivery shapes, the sheet cares about
 *  WHAT the row did, not how many lines it spanned. */
export type MacroRecordKind = 'mention' | 'command' | 'query' | 'send';

/** Map a section kind onto the sheet's record kind (D14). */
function recordKindOf(section: SectionRecord): MacroRecordKind {
	return section.kind.replace(/-block$/, '') as MacroRecordKind;
}

/** Re-derive a command section's parsed form from its (single) line.
 *  The compiler guarantees a `command` section's display IS the line it
 *  came from, and parseCommand is the one recognition source — forwarding
 *  its whole result keeps the runner byte-identical to the line grammar
 *  (D14: single-line rows produce identical receipts), including fields
 *  the sheet never renders (addPanel, promptmanager's type). */
function commandOf(line: string): ParsedCommand | null {
	const parsed = parseCommand(line);
	// A mention line never compiles to a `command` section — the
	// compiler routes it to mention-block — so refusing here only narrows
	// the shared parser's return type, never rewrites a live value.
	return parsed !== null && parsed.type === 'mention' ? null : parsed;
}

/** Per-section record the run sheet renders (kind-driven, W2 2.2). */
export interface MacroLineRecord {
	/** 1-based feed position among sections (queries' spliced children
	 *  count too — the sheet indents them under the query row). */
	index: number;
	/** The record's kind — drives the sheet's marks and the ✓/▶ pairing
	 *  math (only `send` rows consume turn slots). */
	kind: MacroRecordKind;
	/** The section's first line (compileRow `display`) — what the row
	 *  shows; block rows append `+N lines` for the lines display omits. */
	display: string;
	/** The section's full send unit (mention message / block text) — the
	 *  sheet's row title, so hovering shows what actually went out. */
	sendText: string;
	/** Row lines the section spans (blocks > 1) — renders `+N lines`. */
	lineCount: number;
	state: MacroLineState;
	/** Executor note (failure reason, /new note, mention target). */
	note?: string;
	/** True when this record EXPANDED a ?-resolution (the sheet indents
	 *  its children under the query line). */
	isQuery?: boolean;
}

/** Whole-run phases the chip shows. */
export type MacroRunPhase =
	| 'idle'
	| 'feeding' // auto-feeding k/n
	| 'held' // started held — waiting for Feed next / Run all
	| 'fed' // every section got its receipt
	| 'stopped' // aborted — unfed sections dropped
	| 'failed'; // fail-loud stop with reason

/** Reactive run state (read by the sheet through macroRunState()). */
export interface MacroRunState {
	phase: MacroRunPhase;
	/** Total sections (a block counts once; spliced expansions included). */
	total: number;
	/** Sections that have their receipt (queued+skipped+failed+done). */
	fed: number;
	/** Per-section records in feed order (query expansions included). */
	lines: MacroLineRecord[];
	/** Fail-loud stop reason / abort note. */
	note: string | null;
	/** The session the run's remaining plain lines land in — the /new
	 *  handoff retargets it mid-run. A panel claims the sheet when its
	 *  sessionId equals this (ownership follows the target — the birth-
	 *  panelId anchor died at the swap: doReplacePanel mints a fresh id
	 *  and the floor remounts the panel). */
	targetSessionId: string | null;
	/** The target session's assistant-turn count when the run started —
	 *  0 after a /new retarget (a fresh session's transcript starts
	 *  empty). The claiming panel derives ✓/▶ as its live count minus
	 *  this. */
	baselineTurns: number;
}

function idleState(): MacroRunState {
	return {
		phase: 'idle',
		total: 0,
		fed: 0,
		lines: [],
		note: null,
		targetSessionId: null,
		baselineTurns: 0
	};
}

// Module scope, one runner per app session (the panel keys runs by
// panelId in ctx). attachment-service precedent.
let state = $state<MacroRunState>(idleState());

/** Live reactive view for components ($derived reads track it). */
export function macroRunState(): MacroRunState {
	return state;
}

// ── Feeding engine ─────────────────────────────────────────────────────

/** The Typed Run 2026-09-16, D5 — the typed draft wearing the runner's
 *  row interface ({ text, id }) without being a saved shelf row. A
 *  negative sentinel can never collide with a shelf id (DB positive
 *  integers); the visited-set seeds it and run-again re-runs
 *  startedRow.text with no shelf round-trip. No other logic change. */
export const TYPED_DRAFT_ID = -1;

/** Queue of sections pending their receipt (query expansion splices here). */
let pending: SectionRecord[] = [];
/** Visited shelf-row ids this run already consumed (cycle guard). */
let visited = new Set<number>();
/** Executor context — live (a /new successor moves the target mid-run). */
let runCtx: ExecutorContext | null = null;
/** True while start() seeded held mode — feedNext()/runAll() release it. */
let heldMode = false;
/** Feeding in progress flag (guards re-entrant feedNext/runAll). */
let feeding = false;
/** Rows resolved this run, for run-again (text + id, no re-search). */
let startedRow: { text: string; id: number } | null = null;
/** Depth of ?-expansion (0 = top-level lines; cap = chat.macro.maxDepth). */
let depth = 0;

/** Macro caps from the config store (read at call time — house idiom).
 *  maxLines caps SECTIONS (a multi-line block counts once — D15); the
 *  key keeps its name for operator continuity (W3 3.2 words it). */
function caps(): { maxLines: number; maxDepth: number } {
	const macro = (appConfig() as { chat?: { macro?: { maxLines?: unknown; maxDepth?: unknown } } }).chat
		?.macro;
	const num = (v: unknown, fallback: number): number => (typeof v === 'number' && v > 0 ? v : fallback);
	return { maxLines: num(macro?.maxLines, 25), maxDepth: num(macro?.maxDepth, 3) };
}

/**
 * Start a run. `row` is the accepted shelf row (its text is the macro);
 * `ctx` is the panel context lines execute under. `opts.held` seeds the
 * run stopped-at-entry (the Step gesture): nothing feeds until
 * feedNext()/runAll(). `opts.baselineTurns` is the starting panel's
 * assistant-turn count — the ✓/▶ baseline, held HERE so the derivation
 * survives the /new remount. Refuses (visible note) when a run is live,
 * or the row text is empty/all-blank — no fetch fires (Karpathy L2-Q4).
 */
function start(
	row: Pick<SuggestedPrompt, 'text' | 'id'>,
	ctx: ExecutorContext,
	opts: { held?: boolean; baselineTurns?: number } = {}
): MacroRunState {
	if (state.phase === 'feeding' || state.phase === 'held') {
		return {
			...state,
			note: 'a macro is already running — abort it first'
		};
	}
	// Sectioned (D11): compile the row first — the pure grammar decides
	// what feeds; the runner never splits lines again. An empty compile
	// (blank-only row) is refused here — no fetch fires (Karpathy L2-Q4).
	// The Typed Run 2026-09-16, D3/D5: the SYNTHETIC typed row (id
	// TYPED_DRAFT_ID) compiles with slashBoundaries — unknown /token lines
	// feed one per receipt; shelf rows compile default and keep the pinned
	// D12 grammar byte for byte. The panel passes no flag — this is the
	// single call site where the typed path diverges.
	const sections = compileRow(
		row.text,
		row.id === TYPED_DRAFT_ID ? { slashBoundaries: true } : {}
	);
	if (sections.length === 0) {
		return {
			...idleState(),
			phase: 'failed',
			note: 'the row is empty — nothing to run'
		};
	}
	const { maxLines } = caps();
	if (sections.length > maxLines) {
		return {
			...idleState(),
			phase: 'failed',
			note: `too many lines: ${sections.length} (max ${maxLines})`
		};
	}
	// Seed the run.
	state = {
		phase: 'held',
		total: sections.length,
		fed: 0,
		lines: [],
		note: null,
		targetSessionId: ctx.sessionId,
		baselineTurns: opts.baselineTurns ?? 0
	};
	pending = [...sections];
	visited = new Set([row.id]);
	runCtx = { ...ctx };
	heldMode = true;
	feeding = false;
	depth = 0;
	startedRow = { text: row.text, id: row.id };
	if (opts.held === true) {
		return state; // held at entry — the Step gesture
	}
	heldMode = false;
	void autoFeed();
	return state;
}

/** Feed sections until none remain (auto mode; each section waits for
 *  the previous receipt — sequential by construction). */
async function autoFeed(): Promise<void> {
	if (feeding) return;
	feeding = true;
	state.phase = 'feeding';
	try {
		while (pending.length > 0) {
			const next = pending[0];
			// feedSection consumes pending[0] and may stop the run.
			const keepGoing = await feedSection(next);
			if (!keepGoing) return;
		}
		state.phase = 'fed';
	} finally {
		feeding = false;
	}
}

/** Feed exactly ONE section (the Step gesture): held runs consume one
 *  section per call and return to held (step-wise supervision); when the
 *  last section's receipt lands the run completes. A `?` resolution is
 *  one step — the query's receipt is the search, its spliced sections
 *  stay pending for the NEXT steps. */
async function feedNext(): Promise<void> {
	if (state.phase !== 'held') return;
	if (pending.length === 0) {
		state.phase = 'fed';
		return;
	}
	// feedSection owns the shift (one consumption site — a pre-shift here
	// made step 2 skip a section). One call = one section fed.
	await feedOneHeld();
}

/** One-section feed that respects the held mode (no autoFeed chain):
 *  exactly one section (or one ?-resolution) per call, then back to held. */
async function feedOneHeld(): Promise<boolean> {
	const section = pending[0];
	const keepGoing = await feedSection(section);
	if (state.phase === 'failed') return false;
	if (pending.length === 0) {
		state.phase = 'fed'; // last section's receipt landed
	} else {
		state.phase = 'held'; // more steps remain
	}
	return keepGoing;
}

/** Release the hold: feed everything remaining. */
async function runAll(): Promise<void> {
	if (state.phase === 'held') {
		heldMode = false;
		await autoFeed();
	}
}

/** Abort: drop unfed sections WHOLE (never a partial block — a section
 *  is the atomic feed unit); queued ones stay (the host owns them). */
function abort(): void {
	if (state.phase === 'idle') return;
	pending = [];
	if (state.phase === 'feeding' || state.phase === 'held') {
		state.phase = 'stopped';
		state.note = 'aborted — unfed sections dropped';
	}
	feeding = false;
}

/** Run the same row again from scratch (ended runs only). The calling
 *  panel re-baselines ✓/▶ (its live assistant-turn count) — the sheet
 *  renders only on the target panel, so its count belongs to the run's
 *  session; without this, the PREVIOUS run's landed turns would light
 *  the new run's early lines. */
function runAgain(opts: { baselineTurns?: number } = {}): void {
	if (startedRow === null) return;
	if (state.phase === 'feeding' || state.phase === 'held') return;
	const row = startedRow;
	const ctx = runCtx;
	startedRow = null;
	if (ctx !== null) start(row, ctx, { baselineTurns: opts.baselineTurns ?? 0 });
}

/**
 * Feed ONE section (D11/D13): route by its compiled kind, record the
 * receipt, stop fail-loud on failure. Returns false when the run has
 * stopped (caller exits its loop).
 */
async function feedSection(section: SectionRecord): Promise<boolean> {
	pending.shift(); // consume — failure keeps the record, not the slot
	state.lines.push({
		index: state.lines.length + 1,
		kind: recordKindOf(section),
		display: section.display,
		sendText: section.sendText,
		lineCount: section.lineCount,
		state: 'pending'
	});
	// Read back through the $state proxy — raw-object mutation never tracks.
	const record = state.lines[state.lines.length - 1];
	state.fed = state.lines.filter((l) => l.state !== 'pending').length;

	// ?-query: resolve against the shelf, COMPILE the top hit's text, and
	// splice its sections into the queue (one block = one spliced section).
	if (section.kind === 'query') {
		record.isQuery = true;
		const key = section.sendText.slice(1).trim();
		if (key === '') {
			return stopFailed(record, 'empty ? query — nothing to search');
		}
		const { maxDepth, maxLines } = caps();
		if (depth >= maxDepth) {
			return stopFailed(record, `macro depth cap reached (${maxDepth})`);
		}
		let hit: SuggestedPrompt | null = null;
		try {
			// Macro runs resolve against macro rows only (macro=1) — the
			// `!` shelf, never an ordinary prompt.
			const res = await fetch(
				`/api/prompts?q=${encodeURIComponent(key)}&mode=contains&macro=1`
			);
			if (res.ok) {
				const body = (await res.json().catch(() => null)) as {
					results?: SuggestedPrompt[];
				} | null;
				hit = body?.results?.[0] ?? null;
			}
		} catch {
			// transport — fail loud with the query named
		}
		if (hit === null) {
			return stopFailed(record, `no shelf match for "${key}" — stopping the run`);
		}
		if (visited.has(hit.id)) {
			record.state = 'skipped';
			record.note = 'already in this run — skipped';
			return true;
		}
		visited.add(hit.id);
		const expanded = compileRow(hit.text);
		if (expanded.length === 0) {
			return stopFailed(record, `the matched row for "${key}" is empty`);
		}
		if (state.lines.length + expanded.length > maxLines) {
			return stopFailed(
				record,
				`macro line cap reached (max ${maxLines}) — "${key}" expands past it`
			);
		}
		// Expand: the hit's sections splice in as the NEXT sections (depth
		// +1). The query record itself counts as fed (its receipt = search).
		record.state = 'queued';
		record.note = `resolved: ${expanded.length} section${expanded.length > 1 ? 's' : ''}`;
		depth += 1;
		pending.unshift(...expanded);
		state.total = state.lines.length + pending.length;
		state.fed = state.lines.filter((l) => l.state !== 'pending').length;
		return true;
	}

	// Mention-block → the executor's mention route with the JOINED message
	// (sendText = inline remainder + following lines, newlines intact). A
	// bare mention (empty sendText) fails loud with the executor's usage
	// note — kept, never silently skipped (W1 1.1-T edge).
	if (section.kind === 'mention-block' && runCtx !== null) {
		const result = await executeCommand(
			{
				type: 'mention',
				args: section.sendText,
				...(section.mentionSessionId !== undefined
					? { sessionId: section.mentionSessionId }
					: {}),
				...(section.a2aId !== undefined ? { a2aId: section.a2aId } : {})
			},
			runCtx
		);
		record.note = result.note;
		if (!result.ok) {
			return stopFailed(record, result.note ?? 'mention failed');
		}
		record.state = 'queued';
		state.fed = state.lines.filter((l) => l.state !== 'pending').length;
		return true;
	}

	// Command → the executor's instant route (recognized-but-invalid
	// shapes like `/new foo bar` fail loud here — today's semantics, D12).
	if (section.kind === 'command' && runCtx !== null) {
		const parsed = commandOf(section.display);
		const result = await executeCommand(
			parsed === null ? { type: 'new', args: section.display } : parsed,
			runCtx
		);
		record.note = result.note;
		if (!result.ok) {
			return stopFailed(record, result.note ?? 'command failed');
		}
		record.state = 'queued';
		if (result.newSessionId !== undefined && runCtx !== null) {
			// The /new handoff: later sections land in the successor session —
			// and the SHEET moves with them. The floor mints a fresh panel id
			// and remounts the panel; the successor panel claims the run by
			// SESSION (targetSessionId), and a fresh session's transcript
			// starts empty, so the ✓/▶ baseline resets to exactly 0.
			runCtx = { ...runCtx, sessionId: result.newSessionId };
			state.targetSessionId = result.newSessionId;
			state.baselineTurns = 0;
			record.note = `new session: ${result.newSessionId.slice(0, 12)}…`;
		}
		state.fed = state.lines.filter((l) => l.state !== 'pending').length;
		return true;
	}

	// Send-block → ONE queue-mode receipt via sendPrompt — the whole
	// block POSTs as ONE unit with its newlines intact (D13).
	if (runCtx !== null) {
		const result = await sendPrompt(section.sendText, runCtx, plainSend);
		if (!result.ok) {
			return stopFailed(record, result.note ?? 'prompt rejected');
		}
		record.state = 'queued';
		state.fed = state.lines.filter((l) => l.state !== 'pending').length;
		return true;
	}
	return stopFailed(record, 'no run context');
}

/** The plain-send path for macro lines: POST the prompt (queue mode is
 *  the route's wire default) — receipt only, never a turn wait. */
async function plainSend(text: string): Promise<boolean> {
	if (runCtx === null) return false;
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(runCtx.sessionId)}/prompt`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text })
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Fail-loud stop: mark the section failed, freeze the run, name the reason. */
function stopFailed(record: MacroLineRecord, reason: string): boolean {
	record.state = 'failed';
	record.note = reason;
	state.phase = 'failed';
	state.note = reason;
	state.fed = state.lines.filter((l) => l.state !== 'pending').length;
	return false;
}

export const macroRunner = {
	start,
	feedNext,
	runAll,
	abort,
	runAgain,
	/** Dismiss the sheet — ended runs only (fed/stopped/failed); a live
	 *  run keeps its surface (Stop is the exit, not Close). */
	dismiss() {
		if (state.phase !== 'fed' && state.phase !== 'stopped' && state.phase !== 'failed') return;
		state = idleState();
	},
	/** Test seam — reset the module singleton between tests. */
	resetForTests() {
		state = idleState();
		pending = [];
		visited = new Set();
		runCtx = null;
		heldMode = false;
		feeding = false;
		depth = 0;
		startedRow = null;
	}
};

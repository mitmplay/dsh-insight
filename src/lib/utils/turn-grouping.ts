/**
 * Turn grouping (OCI pattern adoption, 2026-08-21; merged-prompt revision;
 * open-turn absorption — The Turn Kept Whole ADR, 2026-09-03).
 *
 * The conversation renders in TWO groups, the way OpenClaw Insight does:
 *
 *   PromptBubble   — anything sent to the LLM (right-aligned, square
 *                    bottom-right corner). A human prompt and the harness
 *                    context injections that follow it (workspace
 *                    instructions · runtime context · skill catalog) are
 *                    ONE bubble: prompt text on top, ContextInjection
 *                    chips below — they feed the same turn.
 *   AssistantTurn  — everything the LLM produced for one contiguous run:
 *                    responses, reasoning, tool calls, unknown events,
 *                    PLUS any context injection the wire spliced into the
 *                    open turn's span (a background-job notice rides
 *                    inside as a chip — never a bubble that splits the
 *                    turn). (left-aligned, square bottom-left corner).
 *
 * Pure render-level rule (BC-E): `entries` — the ledger truth — is never
 * rewritten. A consecutive run of assistant-side entries becomes one turn
 * bubble; a context injection merges into the group it actually feeds:
 * the preceding prompt when there is one, the OPEN turn when assistant
 * work is its most recent neighbor (D1 — the wire spliced it mid-turn),
 * or a club of consecutive injections when no turn or prompt sits behind
 * it (D4 — session open). Turn key is the FIRST entry id so a streaming
 * turn keeps a stable identity across renders.
 */
import type { DsiEntry } from '$lib/types';

type UserMessageEntry = Extract<DsiEntry, { kind: 'user-message' }>;
/** A user-message entry that carries the injection marker — the shape a
 *  merged context chip member has (exported for tests and chip renderers). */
export type ContextEntry = UserMessageEntry & { meta: NonNullable<UserMessageEntry['meta']> };
type SystemPromptEntry = Extract<DsiEntry, { kind: 'system-prompt' }>;
export type AssistantSideEntry = Exclude<DsiEntry, { kind: 'user-message' | 'system-prompt' | 'developer-message' }>;

/** A member of an assistant-turn bubble: assistant-side wire truth, or a
 *  context injection the open turn absorbed (The Turn Kept Whole, D1 —
 *  the notice renders as a chip between the runs it interrupted). */
export type TurnMember = AssistantSideEntry | ContextEntry;

export type TurnGroup =
	| { kind: 'prompt'; key: string; entry: UserMessageEntry; context: ContextEntry[] }
	| { kind: 'context'; key: string; entries: ContextEntry[] }
	| { kind: 'system-prompt'; key: string; entry: SystemPromptEntry }
	| { kind: 'developer'; key: string; entry: Extract<DsiEntry, { kind: 'developer-message' }> }
	| { kind: 'assistant-turn'; key: string; entries: TurnMember[] };

/** Group a render list into prompt(+context) / context / system-prompt / assistant-turn bubbles. */
export function groupTurns(entries: DsiEntry[]): TurnGroup[] {
	const groups: TurnGroup[] = [];
	// DSH anchor parity (2026-09-01): the request/header is LOGGED inside its
	// step — after the turn's user messages — but DSH's Chat renders the
	// system prompt "at the start of its visible message series"
	// (requestPromptAnchor: turn/start for step 1, step/start otherwise), so
	// the conversation's opening row sits ABOVE the first user prompt. DSI's
	// stateless mirror: the EARLIEST system-prompt row hoists to the top of
	// the transcript; a later prompt-change row keeps its raw-seq seat
	// between that turn's prompt and its response (DSH's step/start anchor).
	// Render-level (BC-E): the entries list itself is never reordered.
	const earliestSystem = entries.reduce<SystemPromptEntry | undefined>(
		(min, e) => (e.kind === 'system-prompt' && (min === undefined || e.seq < min.seq) ? e : min),
		undefined
	);
	const hoisted = earliestSystem !== undefined && entries[0] !== earliestSystem;
	if (hoisted && earliestSystem !== undefined) {
		groups.push({ kind: 'system-prompt', key: earliestSystem.id, entry: earliestSystem });
	}
	for (const entry of entries) {
		if (entry.kind === 'system-prompt') {
			if (hoisted && entry === earliestSystem) continue; // already emitted at the top
			groups.push({ kind: 'system-prompt', key: entry.id, entry });
			continue;
		}
		if (entry.kind === 'user-message') {
			// Context injections merge into the group they feed: the
			// immediately preceding prompt (the turn it opens), the OPEN
			// turn the wire spliced them into (D1), or the club of
			// consecutive injections when neither sits behind them (D4 —
			// session open). Otherwise they stand alone — exactly where
			// the wire put them.
			if (entry.meta) {
				const last = groups[groups.length - 1];
				if (last?.kind === 'prompt') {
					last.context.push(entry as ContextEntry);
					continue;
				}
				if (last?.kind === 'assistant-turn') {
					last.entries.push(entry as ContextEntry);
					continue;
				}
				if (last?.kind === 'context') {
					last.entries.push(entry as ContextEntry);
					continue;
				}
				groups.push({ kind: 'context', key: entry.id, entries: [entry as ContextEntry] });
				continue;
			}
			groups.push({ kind: 'prompt', key: entry.id, entry, context: [] });
			continue;
		}
		// Turn End Stamp (ADR 2026-09-25, task 1.3): turn-lifecycle markers are
		// pipeline-faithful bookkeeping — they must never become TurnMembers,
		// join a group, split one, or start one. The projection folds them.
		if (entry.kind === 'turn-lifecycle') continue;
		// ADR-0027b: the harness's developer turn is its own notice group —
		// never a TurnMember, so it cannot fold into (or split) an assistant
		// bubble, and never an unknown-event (the escape family's counts stay).
		if (entry.kind === 'developer-message') {
			groups.push({ kind: 'developer', key: entry.id, entry });
			continue;
		}
		const side = entry as AssistantSideEntry;
		const last = groups[groups.length - 1];
		if (last?.kind === 'assistant-turn') last.entries.push(side);
		else groups.push({ kind: 'assistant-turn', key: entry.id, entries: [side] });
	}
	return groups;
}

/** The turn's timestamp: its LAST entry's wire time (OCI parity — one stamp per turn). */
export function turnLastTime(entries: TurnMember[]): number | undefined {
	return entries[entries.length - 1]?.time;
}

/** The turn's FIRST entry's wire time — pairs with turnLastTime for the
 *  turn's wall time (the "Ran for" stamp prefix). */
export function turnStartTime(entries: TurnMember[]): number | undefined {
	return entries[0]?.time;
}

/**
 * The turn's fork anchor (The Fork-Here Button ADR, 2026-09-02): its FIRST
 * entry's wire seq — the number the host's `session/fork` atSeq resolves to
 * this turn's own end (the first turn/end at or after it). The turn's key is
 * already its first entry id, so the anchor shares the turn's stable
 * identity across re-renders and streams.
 */
export function turnAnchorSeq(entries: TurnMember[]): number {
	return entries[0].seq;
}

/**
 * The turn's token usage: the SUM over its assistant-message usage
 * records (each finalizes one attempt; DSH deriveTurnTokenUsage parity
 * without the retry-chain state machine). Routes aggregate all-or-
 * nothing — present only when EVERY usage record carries attribution;
 * distinct pairs in wire order. Undefined when the turn carries none.
 */
export function turnUsage(entries: TurnMember[]): import('$lib/types').DsiTokenUsage | undefined {
	const records = entries
		.filter((e): e is Extract<DsiEntry, { kind: 'assistant-message' }> => e.kind === 'assistant-message')
		.map((e) => e.usage)
		.filter((u): u is NonNullable<typeof u> => u !== undefined);
	if (records.length === 0) return undefined;
	const all = <T,>(values: (T | undefined)[]): T[] | undefined =>
		values.some((v) => v === undefined) ? undefined : (values as T[]);
	const routes: { provider: string; model: string }[] = [];
	let attributed = true;
	for (const u of records) {
		if (u.provider === undefined || u.model === undefined) {
			attributed = false;
			continue;
		}
		if (!routes.some((r) => r.provider === u.provider && r.model === u.model)) {
			routes.push({ provider: u.provider, model: u.model });
		}
	}
	const sum = (pick: (u: import('$lib/types').DsiTokenUsage) => number | undefined): number | undefined => {
		const values = all(records.map(pick));
		return values === undefined ? undefined : values.reduce((a, b) => a + b, 0);
	};
	const cacheRead = sum((u) => u.cacheReadTokens);
	const cacheWrite = sum((u) => u.cacheWriteTokens);
	const reasoning = sum((u) => u.reasoningTokens);
	// The provider's exact total aggregates under the same all-or-nothing
	// rule (The Exact Total, ADR-0012 D3): a turn mixing carriers and
	// non-carriers keeps the bucket-sum headline.
	const total = sum((u) => u.totalTokens);
	return {
		inputTokens: records.reduce((a, u) => a + u.inputTokens, 0),
		outputTokens: records.reduce((a, u) => a + u.outputTokens, 0),
		...(total !== undefined ? { totalTokens: total } : {}),
		...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
		...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
		...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
		...(attributed && routes.length > 0 ? { routes } : {})
	};
}

/**
 * The turn's text: every non-empty assistant message text in wire order,
 * joined by a blank line (markdown block separation). Undefined for
 * tool-only turns — that gate hides the ToolsMessage action row, which
 * has no text to copy or flip.
 */
export function turnText(entries: TurnMember[]): string | undefined {
	const texts = entries.filter(
		(e): e is Extract<DsiEntry, { kind: 'assistant-message' }> =>
			e.kind === 'assistant-message' && e.text !== ''
	);
	if (texts.length === 0) return undefined;
	return texts.map((e) => e.text).join('\n\n');
}

/** A run inside an AssistantTurn: a text block, or an inline chip row.
 *  A chips row carries assistant-side chips (reasoning, tool calls,
 *  unknown events) AND absorbed context injections (D1) — wire order. */
export type TurnRun =
	| { kind: 'text'; key: string; entry: Extract<DsiEntry, { kind: 'assistant-message' }> }
	| { kind: 'chips'; key: string; entries: TurnMember[] };

/** A chips run alone — the fold's payload type. */
export type ChipsRun = Extract<TurnRun, { kind: 'chips' }>;

/**
 * Split a turn's entries into render runs (inline-chips rule, 2026-08-22;
 * reasoning-is-a-chip revision): ReasoningSection is a CHIP like any other
 * — consecutive chips (reasoning, tool calls, unknown events, absorbed
 * context injections) with NO TEXT between them form ONE inline row; only
 * TEXT breaks the row. A wire message carrying BOTH reasoning and text
 * contributes its think to the chip row and its text as the block after it;
 * an absorbed injection's text never becomes a block — it opens in the
 * chip's popup. Pure render rule (BC-E).
 */
export function splitRuns(entries: TurnMember[]): TurnRun[] {
	const runs: TurnRun[] = [];
	const addChip = (key: string, entry: TurnMember): void => {
		const last = runs[runs.length - 1];
		if (last?.kind === 'chips') last.entries.push(entry);
		else runs.push({ kind: 'chips', key, entries: [entry] });
	};
	for (const entry of entries) {
		if (entry.kind === 'assistant-message') {
			if (entry.reasoning !== undefined && entry.reasoning !== '') addChip(`r:${entry.id}`, entry);
			if (entry.text !== '') runs.push({ kind: 'text', key: `t:${entry.id}`, entry });
			continue;
		}
		addChip(entry.id, entry);
	}
	return runs;
}

/**
 * Turn-process fold summary (ADR-0010 "The Fold Gate", 2026-09-09, D3/D6).
 *
 * Pure view over one assistant turn's members: which runs fold behind a
 * TurnProcessDisclosure row and what the row counts. Everything before the
 * LAST text run folds; reasoning never folds (D6 — its entries escape the
 * folded runs and render as pills outside the row); absorbed context
 * injections fold silently and are never counted. A turn with no text run
 * has no answer to protect and never folds (`hasAnswer: false`). When the
 * turn is in flight and `progressiveFold` is false, the turn renders open
 * (`folds: false`) — re-derived per render from the same pure inputs.
 *
 * Counts (DSH's three families, `TurnProcessNodeView.tsx:14-37` parity):
 * tool-call entries; reply-bearing assistant messages (non-empty text);
 * `subagent` tool calls counted separately and never as ordinary tool
 * calls — a delegation whose meta is missing degrades to a tool call
 * (ADR-0010 accepted give-up). Reasoning-only messages never count.
 */
export interface TurnProcessSummary {
	/** Non-delegation tool-call entries in the turn. */
	toolCallCount: number;
	/** Reply-bearing assistant messages (non-empty text). */
	messageCount: number;
	/** `subagent` tool-call delegations. */
	subagentCount: number;
	/** ALL runs before the last text run — chips AND text, wire order,
	 *  reasoning entries KEPT at their original positions: an expanded fold
	 *  replays the turn's work exactly as the wire delivered it. The caller
	 *  hides this content while the row is closed. */
	folded: TurnRun[];
	/** The reasoning-bearing entries carried by `folded` (D6): the caller
	 *  renders them as pills ABOVE the row while it is closed — thinking
	 *  never hides — and omits the strip when the fold is open (the pills
	 *  are then visible at their wire positions inside the expanded body). */
	escapedReasoning: TurnMember[];
	/** The context-injection entries carried by `folded` (ADR-0022, D7):
	 *  the caller renders them as chips beside the escaped reasoning while
	 *  the row is closed — what the model was TOLD never hides — and omits
	 *  the strip when the fold is open (the chips then sit at their wire
	 *  positions inside the expanded body). Never counted in the label. */
	escapedInjections: TurnMember[];
	/** The last text run and everything after it — render open BELOW the
	 *  row, wire order preserved. */
	trailingTextRuns: TurnRun[];
	/** At least one text run — the answer the fold protects. */
	hasAnswer: boolean;
	/** Whether the disclosure path applies for this render (answer present,
	 *  and not held open by in-flight + progressiveFold=false). */
	folds: boolean;
	/** All three counts zero — the caller renders the fallback label
	 *  ("thought for a while", DSH parity). */
	allCountsZero: boolean;
}

/**
 * Derive a turn's fold summary. Pure; flags arrive from the caller (the
 * selector never reads config).
 *
 * @param entries one assistant turn's members (group.entries)
 * @param opts.inFlight true while the turn is still streaming
 * @param opts.progressiveFold fold mid-stream instead of holding open
 * @returns the summary the disclosure render consumes
 */
export function turnProcess(
	entries: TurnMember[],
	opts?: { inFlight?: boolean; progressiveFold?: boolean }
): TurnProcessSummary {
	const runs = splitRuns(entries);
	let toolCallCount = 0;
	let messageCount = 0;
	let subagentCount = 0;
	for (const entry of entries) {
		if (entry.kind === 'tool-call') {
			if (entry.toolName === 'subagent') subagentCount += 1;
			else toolCallCount += 1;
		} else if (entry.kind === 'assistant-message' && entry.text !== '') {
			messageCount += 1;
		}
	}
	const lastText = runs.findLastIndex((r) => r.kind === 'text');
	const hasAnswer = lastText !== -1;
	const escapedReasoning: TurnMember[] = [];
	const escapedInjections: TurnMember[] = [];
	const folded: TurnRun[] = [];
	for (const run of hasAnswer ? runs.slice(0, lastText) : []) {
		if (run.kind !== 'chips') {
			folded.push(run);
			continue;
		}
		for (const e of run.entries) {
			if (e.kind === 'assistant-message' && e.reasoning !== undefined && e.reasoning !== '') {
				escapedReasoning.push(e);
			}
			// ADR-0022 D7: every injection producer rides one entry shape
			// (user-message + meta, ContextEntry); the whole family escapes
			// together — no producer-string switch here.
			// I4 (operator call, 2026-10-13): unmodeled wire events
			// (unknown-event — e.g. 'working-directory/change') are harness
			// notices relayed INTO the stream, not agent work; they join the
			// escape family so the work row's badge matches the disclosure's
			// work count. Unknown-events were never counted in the label.
			if (e.kind === 'unknown-event') {
				escapedInjections.push(e);
			}
			if (e.kind === 'user-message' && e.meta !== undefined) {
				escapedInjections.push(e);
			}
		}
		folded.push(run);
	}
	const folds =
		hasAnswer && (opts?.progressiveFold === true || opts?.inFlight !== true);
	return {
		toolCallCount,
		messageCount,
		subagentCount,
		folded,
		escapedReasoning,
		escapedInjections,
		trailingTextRuns: hasAnswer ? runs.slice(lastText) : [],
		hasAnswer,
		folds,
		allCountsZero: toolCallCount === 0 && messageCount === 0 && subagentCount === 0
	};
}

/**
 * turn-grouping unit tests — the OCI two-group pattern on DSI (2026-08-21).
 *
 * groupTurns: a user prompt is its own prompt-group; harness context
 * injections merge into the group they FEED — the preceding prompt, the
 * OPEN assistant turn the wire spliced them into (The Turn Kept Whole,
 * D1), or a club of consecutive injections when neither sits behind (D4).
 * A contiguous run of assistant-side entries (responses, reasoning
 * carriers, tool calls, orphan results, unknown events) collapses into
 * ONE assistant-turn group that absorbed injections join as chip members.
 * The ledger truth (`entries`) is never rewritten — pure render rule (BC-E).
 */

import { describe, expect, it } from 'vitest';
import { groupTurns, turnLastTime, turnStartTime, turnUsage, turnText, splitRuns, turnAnchorSeq, turnProcess, type AssistantSideEntry, type ContextEntry, type TurnMember } from '$lib/utils/turn-grouping';
import type { DsiEntry } from '$lib/types';

const user = (id: string, seq: number): DsiEntry => ({
	kind: 'user-message', id, seq, time: 1000 + seq, text: `prompt ${id}`
});
const assistant = (id: string, seq: number): AssistantSideEntry => ({
	kind: 'assistant-message', id, seq, time: 1000 + seq, text: `answer ${id}`, streaming: false
});
const call = (id: string, seq: number, callId: string): AssistantSideEntry => ({
	kind: 'tool-call', id, seq, time: 1000 + seq, callId, toolName: 'grep', status: 'pass'
});
const reasoningOnly = (id: string, seq: number): AssistantSideEntry => ({
	kind: 'assistant-message', id, seq, time: 1000 + seq, text: '', streaming: false, reasoning: 'hmm'
});
const reasoningWithText = (id: string, seq: number): AssistantSideEntry => ({
	kind: 'assistant-message', id, seq, time: 1000 + seq, text: 'the answer', streaming: false, reasoning: 'hmm'
});
const unknown = (id: string, seq: number): AssistantSideEntry => ({
	kind: 'unknown-event', id, seq, time: 1000 + seq, eventType: 'plugin/frobnicated'
});
/** A mid-turn injection (The Turn Kept Whole): the tool-jobs notice shape
 *  the live ledger carries — kind:'plugin', form:'notice'. */
const notice = (id: string, seq: number): ContextEntry => ({
	kind: 'user-message', id, seq, time: 1000 + seq, text: 'background job finished',
	meta: 'plugin', metaSource: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice' }
});
/** An image-carrying injected user-message (2026-10-29): harness tool-result
 *  images (read_image et al) arrive as injected user/messages whose ImageBlock
 *  refs survive the fold (content.ts imageRefsOfContent) — visual prompts,
 *  not chip fodder. */
const injectedImage = (id: string, seq: number, attachmentId: string): DsiEntry => ({
	kind: 'user-message', id, seq, time: 1000 + seq, text: '<path>/tmp/x.png</path>',
	meta: 'injected', metaSource: { kind: 'ptc-mode' },
	imageRefs: [{ attachmentId, mediaType: 'image/png', bytes: 236821, width: 777, height: 859 }]
});

describe('groupTurns — two-group render rule (OCI pattern)', () => {
	it('prompt → turn → prompt → turn: groups alternate and never merge across a prompt', () => {
		const groups = groupTurns([user('u1', 1), assistant('a1', 2), user('u2', 3), assistant('a2', 4)]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'assistant-turn', 'prompt', 'assistant-turn']);
	});

	it('a contiguous assistant run (response + tool call + unknown) is ONE turn', () => {
		const groups = groupTurns([user('u1', 1), assistant('a1', 2), call('c1', 3, 'k1'), unknown('e9', 9)]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'assistant-turn']);
		const turn = groups[1] as { kind: 'assistant-turn'; entries: DsiEntry[] };
		expect(turn.entries.map((e) => e.id)).toEqual(['a1', 'c1', 'e9']);
	});

	it('turn key is the FIRST entry id — stable while chunks append (streaming identity)', () => {
		const first = groupTurns([assistant('a1', 2), call('c1', 3, 'k1')]);
		const grown = groupTurns([assistant('a1', 2), call('c1', 3, 'k1'), unknown('e9', 9)]);
		expect(first[0].kind === 'assistant-turn' && grown[0].kind === 'assistant-turn').toBe(true);
		expect(first[0].key).toBe(grown[0].key);
	});

	it('turns open cold: leading assistant entries (no preceding prompt) still group', () => {
		const groups = groupTurns([assistant('a1', 1), user('u1', 2)]);
		expect(groups.map((g) => g.kind)).toEqual(['assistant-turn', 'prompt']);
	});

	it('context following a prompt MERGES into that prompt group (merged-prompt revision)', () => {
		const ctx: DsiEntry = {
			kind: 'user-message', id: 'm1', seq: 2, time: 1002, text: 'runtime context',
			meta: 'runtime-context', metaSource: { files: [] }
		};
		const groups = groupTurns([user('u1', 1), ctx, assistant('a1', 3)]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'assistant-turn']);
		const prompt = groups[0] as { kind: 'prompt'; context: unknown[] };
		expect(prompt.context).toHaveLength(1);
	});

	it('context at session OPEN stands alone (no turn or prompt sits behind it)', () => {
		const groups = groupTurns([notice('m1', 1), assistant('a1', 2)]);
		expect(groups.map((g) => g.kind)).toEqual(['context', 'assistant-turn']);
	});

	it('an image-carrying injection is a PROMPT group — the gallery renders right-aligned (2026-10-29)', () => {
		// Wire shape (session-e3a589d3 seq 1520): my read_image image arrives
		// as an injected user/message whose ImageBlock refs survive the fold.
		// Visual prompt rule: meta text stays, but the entry keeps the prompt
		// seat — imageRefs ride to MessageImages, never into a chip.
		const groups = groupTurns([assistant('a1', 1), injectedImage('m1', 2, 'sha256:x')]);
		expect(groups.map((g) => g.kind)).toEqual(['assistant-turn', 'prompt']);
		const prompt = groups[1] as { kind: 'prompt'; entry: { imageRefs?: unknown[] } };
		expect(prompt.entry.imageRefs).toHaveLength(1);
		expect(prompt.entry.imageRefs?.[0]).toMatchObject({ attachmentId: 'sha256:x' });
	});

	it('an image-carrying injection after a prompt OPENS ITS OWN prompt group (never swallows into chips)', () => {
		const groups = groupTurns([user('u1', 1), injectedImage('m1', 2, 'sha256:y'), assistant('a1', 3)]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'prompt', 'assistant-turn']);
		expect((groups[0] as { context: unknown[] }).context).toHaveLength(0);
	});

	it('chip-only injections still fold (the 2026-08-21 rule, untouched)', () => {
		const groups = groupTurns([assistant('a1', 1), notice('m1', 2), call('c1', 3, 'k1')]);
		expect(groups.map((g) => g.kind)).toEqual(['assistant-turn']);
	});

	it('a mid-turn injection JOINS the open turn as a chip member (The Turn Kept Whole, D1)', () => {
		// Wire shape of a live working turn (session-3fa2df02): assistant
		// work → tool-jobs notice spliced mid-turn → work continues — ONE
		// wire turn, ONE bubble, the notice a member at its wire position.
		const groups = groupTurns([user('u1', 1), assistant('a1', 2), notice('m1', 3), call('c1', 4, 'k1')]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'assistant-turn']);
		const turn = groups[1] as { kind: 'assistant-turn'; entries: TurnMember[] };
		expect(turn.entries.map((e) => e.id)).toEqual(['a1', 'm1', 'c1']);
		// …and after a completed turn, context merges BACKWARDS into the
		// turn that precedes it (D1/D3 — adjacency is the render truth;
		// the ledger order is untouched, BC-E).
		const groups2 = groupTurns([assistant('a1', 1), notice('m1', 2)]);
		expect(groups2.map((g) => g.kind)).toEqual(['assistant-turn']);
	});

	it('a joined notice never shifts the fork anchor or the turn key (first entry owns identity)', () => {
		const groups = groupTurns([user('u1', 1), assistant('a1', 2), notice('m1', 3), call('c1', 4, 'k1')]);
		const turn = groups[1] as { kind: 'assistant-turn'; key: string; entries: TurnMember[] };
		expect(turn.key).toBe('a1');
		expect(turnAnchorSeq(turn.entries)).toBe(2);
		// The stamp stays honest: a trailing notice IS the last wire time.
		expect(turnLastTime(turn.entries)).toBe(1004);
	});

	it('consecutive injections with no turn behind them club into ONE context group (D4)', () => {
		const groups = groupTurns([notice('m1', 1), notice('m2', 2), user('u1', 3)]);
		expect(groups.map((g) => g.kind)).toEqual(['context', 'prompt']);
		const context = groups[0] as { kind: 'context'; entries: TurnMember[] };
		expect(context.entries.map((e) => e.id)).toEqual(['m1', 'm2']);
	});

	it('entries list is never reordered by the join (BC-E)', () => {
		const entries = [assistant('a1', 1), notice('m1', 2), call('c1', 3, 'k1')];
		groupTurns(entries);
		expect(entries.map((e) => e.id)).toEqual(['a1', 'm1', 'c1']);
	});

	it('empty input → empty groups', () => {
		expect(groupTurns([])).toEqual([]);
	});
});

describe('turnUsage', () => {
	const withUsage = (id: string, seq: number, usage: Record<string, unknown>): AssistantSideEntry => ({
		kind: 'assistant-message', id, seq, time: 1000 + seq, text: `answer ${id}`, streaming: false,
		usage
	} as unknown as AssistantSideEntry);

	it('sums the turn assistant-message usage records (per-turn billing, DSH parity)', () => {
		const run: AssistantSideEntry[] = [
			withUsage('a1', 2, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50, cacheWriteTokens: 5, reasoningTokens: 4 }),
			call('c1', 3, 'k1'),
			withUsage('a2', 4, { inputTokens: 200, outputTokens: 20, cacheReadTokens: 70, cacheWriteTokens: 15, reasoningTokens: 6 })
		];
		expect(turnUsage(run)).toEqual({
			inputTokens: 300,
			outputTokens: 30,
			cacheReadTokens: 120,
			cacheWriteTokens: 20,
			reasoningTokens: 10
		});
	});

	it('routes aggregate all-or-nothing, distinct pairs in wire order', () => {
		const full: AssistantSideEntry[] = [
			withUsage('a1', 2, { inputTokens: 1, outputTokens: 1, provider: 'deepseek', model: 'deepseek-chat' }),
			withUsage('a2', 3, { inputTokens: 1, outputTokens: 1, provider: 'deepseek', model: 'deepseek-reasoner' }),
			withUsage('a3', 4, { inputTokens: 1, outputTokens: 1, provider: 'deepseek', model: 'deepseek-chat' })
		];
		expect(turnUsage(full)!.routes).toEqual([
			{ provider: 'deepseek', model: 'deepseek-chat' },
			{ provider: 'deepseek', model: 'deepseek-reasoner' }
		]);
		const partial: AssistantSideEntry[] = [
			withUsage('a1', 2, { inputTokens: 1, outputTokens: 1, provider: 'deepseek', model: 'deepseek-chat' }),
			withUsage('a2', 3, { inputTokens: 1, outputTokens: 1 })
		];
		expect(turnUsage(partial)!.routes).toBeUndefined();
	});

	it('undefined when the turn carries no usage (tool-only or unattributed)', () => {
		expect(turnUsage([call('c1', 3, 'k1'), assistant('a1', 2)])).toBeUndefined();
	});
});

describe('turnStartTime', () => {
	it('carries the FIRST entry time of the turn (pairs with turnLastTime for the wall time)', () => {
		const run: AssistantSideEntry[] = [assistant('a1', 2), call('c1', 5, 'k1')];
		expect(turnStartTime(run)).toBe(1002);
	});
	it('undefined for an empty run (degenerate, never rendered)', () => {
		expect(turnStartTime([])).toBeUndefined();
	});
});

describe('turnLastTime', () => {
	it('carries the LAST entry time of the turn (one stamp per turn, OCI parity)', () => {
		const run: AssistantSideEntry[] = [assistant('a1', 2), call('c1', 5, 'k1')];
		expect(turnLastTime(run)).toBe(1005);
	});
	it('undefined for an empty run (degenerate, never rendered)', () => {
		expect(turnLastTime([])).toBeUndefined();
	});
});

describe('turnText', () => {
	it('concatenates non-empty assistant texts in wire order, blank-line joined', () => {
		const run: AssistantSideEntry[] = [assistant('a1', 1), call('c1', 2, 'k1'), assistant('a2', 3)];
		expect(turnText(run)).toBe('answer a1\n\nanswer a2');
	});
	it('skips reasoning-only carriers (empty text contributes nothing)', () => {
		const run: AssistantSideEntry[] = [reasoningOnly('r1', 1), assistant('a1', 2)];
		expect(turnText(run)).toBe('answer a1');
	});
	it('tool-only turns → undefined (gates the action row off)', () => {
		const run: AssistantSideEntry[] = [call('c1', 1, 'k1'), reasoningOnly('r1', 2), unknown('e9', 3)];
		expect(turnText(run)).toBeUndefined();
	});
});

describe('splitRuns — inline chip rows (2026-08-22)', () => {
	it('consecutive chips with NO text between them form ONE inline row', () => {
		const runs = splitRuns([reasoningOnly('r1', 2), call('c1', 3, 'k1'), call('c2', 4, 'k2'), unknown('e9', 9)]);
		expect(runs).toHaveLength(1);
		expect(runs[0].kind).toBe('chips');
		if (runs[0].kind === 'chips') expect(runs[0].entries.map((e) => e.id)).toEqual(['r1', 'c1', 'c2', 'e9']);
	});

	it('a message with text is its own block and BREAKS the row', () => {
		const runs = splitRuns([call('c1', 1, 'k1'), assistant('a1', 2), call('c2', 3, 'k2')]);
		expect(runs.map((r) => r.kind)).toEqual(['chips', 'text', 'chips']);
	});

	it('text-only turns render as pure text runs', () => {
		const runs = splitRuns([assistant('a1', 1), assistant('a2', 2)]);
		expect(runs.map((r) => r.kind)).toEqual(['text', 'text']);
	});

	it('empty turn → no runs', () => {
		expect(splitRuns([])).toEqual([]);
	});
});

describe('splitRuns — reasoning is a chip (2026-08-22 bugfix)', () => {
	it('[think][bash][think] one row — wire order reasoning-only, call, reasoning+text: the last think joins the row, its text follows', () => {
		// The live wire (session-2754a625): reasoning-only msg → tool call →
		// msg with reasoning+text. The row collects ALL consecutive chips;
		// the trailing message's text renders as the block AFTER the row.
		const runs = splitRuns([reasoningOnly('r1', 1), call('c1', 2, 'k1'), reasoningWithText('m2', 3)]);
		expect(runs.map((r) => r.kind)).toEqual(['chips', 'text']);
		if (runs[0].kind === 'chips') expect(runs[0].entries.map((e) => e.id)).toEqual(['r1', 'c1', 'm2']);
	});

	it('reasoning+text message text breaks the row — chips after it start fresh (text is a block)', () => {
		const runs = splitRuns([reasoningWithText('m1', 1), call('c1', 2, 'k1')]);
		expect(runs.map((r) => r.kind)).toEqual(['chips', 'text', 'chips']);
		if (runs[2].kind === 'chips') expect(runs[2].entries.map((e) => e.id)).toEqual(['c1']);
	});

	it('reasoning-only message before text stays a chip (existing behavior preserved)', () => {
		const runs = splitRuns([reasoningOnly('r1', 1), reasoningWithText('m1', 2)]);
		expect(runs.map((r) => r.kind)).toEqual(['chips', 'text']);
	});
});

describe('splitRuns — absorbed injections club into the row (The Turn Kept Whole, D2)', () => {
	it('back-to-back notices between text blocks form ONE chips row', () => {
		// Live shape (session-3fa2df02 seq 27168+27169): two job notices
		// arrive in the same breath — one row, two chips, never two rows.
		const runs = splitRuns([assistant('a1', 1), notice('m1', 2), notice('m2', 3), assistant('a2', 4)]);
		expect(runs.map((r) => r.kind)).toEqual(['text', 'chips', 'text']);
		if (runs[1].kind === 'chips') expect(runs[1].entries.map((e) => e.id)).toEqual(['m1', 'm2']);
	});

	it('a notice between tool calls stays in the SAME row (one row, wire order)', () => {
		const runs = splitRuns([call('c1', 1, 'k1'), notice('m1', 2), call('c2', 3, 'k2')]);
		expect(runs).toHaveLength(1);
		if (runs[0].kind === 'chips') expect(runs[0].entries.map((e) => e.id)).toEqual(['c1', 'm1', 'c2']);
	});

	it("an absorbed notice's text never becomes a text block — it opens in the chip's popup", () => {
		const runs = splitRuns([assistant('a1', 1), notice('m1', 2)]);
		expect(runs.map((r) => r.kind)).toEqual(['text', 'chips']);
	});
});

describe('groupTurns — system prompt placement (2026-09-01)', () => {
	const sysprompt = (id: string, seq: number, text = 'You are app-dev.'): DsiEntry => ({
		kind: 'system-prompt', id, seq, time: 1000 + seq, text
	});

	it('the earliest system-prompt row hoists ABOVE the first user prompt (DSH requestPromptAnchor parity)', () => {
		// Wire truth: request/header is logged INSIDE its step — after the
		// turn's user messages — but DSH renders the opening row at the top
		// ("the start of its visible message series"). The hoist mirrors that.
		const groups = groupTurns([user('u1', 1), sysprompt('sp:4', 4), assistant('a1', 5)]);
		expect(groups.map((g) => g.kind)).toEqual(['system-prompt', 'prompt', 'assistant-turn']);
	});

	it('a system-prompt already first stays first — never a duplicate group', () => {
		const groups = groupTurns([sysprompt('sp:1', 1), user('u1', 2)]);
		expect(groups.map((g) => g.kind)).toEqual(['system-prompt', 'prompt']);
	});

	it("only the EARLIEST row hoists; a LATER change row keeps its seq seat (between that turn's prompt and response)", () => {
		const groups = groupTurns([
			user('u1', 1), assistant('a1', 2),
			user('u2', 3), sysprompt('sp:6', 6), assistant('a2', 7),
			user('u3', 8), sysprompt('sp:9', 9), assistant('a3', 10)
		]);
		expect(groups.map((g) => g.kind)).toEqual([
			'system-prompt', 'prompt', 'assistant-turn', 'prompt', 'assistant-turn',
			'prompt', 'system-prompt', 'assistant-turn'
		]);
		// The hoisted row is the EARLIEST header; the later change stays put.
		const head = groups[0];
		expect(head.kind === 'system-prompt' && head.entry.id).toBe('sp:6');
	});

	it('entries list is never reordered (BC-E) — the hoist is render-level only', () => {
		const entries = [user('u1', 1), sysprompt('sp:4', 4)];
		groupTurns(entries);
		expect(entries.map((e) => e.id)).toEqual(['u1', 'sp:4']);
	});
});

describe('turnAnchorSeq — the fork-here anchor (The Fork-Here Button ADR, 2026-09-02)', () => {
	it("the anchor is the turn group's FIRST entry seq — the identity the turn key already rides", () => {
		const groups = groupTurns([user('u1', 1), assistant('a1', 2), call('c1', 3, 'k1')]);
		const turn = groups[1] as { kind: 'assistant-turn'; entries: AssistantSideEntry[] };
		expect(turn.entries[0]?.id).toBe('a1');
		expect(turnAnchorSeq(turn.entries)).toBe(2);
	});

	it('a tool-only turn anchors on its first chip — tool-only turns are first-class fork points', () => {
		const groups = groupTurns([user('u1', 1), call('c1', 5, 'k1'), unknown('e9', 9)]);
		const turn = groups[1] as { kind: 'assistant-turn'; entries: AssistantSideEntry[] };
		expect(turn.entries.map((e) => e.kind)).toEqual(['tool-call', 'unknown-event']);
		expect(turnAnchorSeq(turn.entries)).toBe(5);
	});
});

const subagentCall = (id: string, seq: number, callId: string): AssistantSideEntry => ({
	kind: 'tool-call', id, seq, time: 1000 + seq, callId, toolName: 'subagent', status: 'pass'
});

describe('turnProcess — the fold summary (ADR-0010, The Fold Gate)', () => {
	it('counts the three families: tool calls, reply messages, subagent delegations', () => {
		const s = turnProcess([
			call('c1', 2, 'k1'),
			subagentCall('s1', 3, 'k2'),
			call('c2', 4, 'k3'),
			assistant('a1', 5)
		]);
		expect(s.toolCallCount).toBe(2);
		expect(s.subagentCount).toBe(1);
		expect(s.messageCount).toBe(1);
		expect(s.hasAnswer).toBe(true);
		expect(s.folds).toBe(true);
	});

	it('reasoning chips escape to the caller (D6) AND keep their wire positions in the fold body', () => {
		const s = turnProcess([reasoningOnly('r1', 2), call('c1', 3, 'k1'), reasoningWithText('a1', 4)]);
		// the caller renders these above the row while it is closed
		expect(s.escapedReasoning.map((e) => e.id)).toEqual(['r1', 'a1']);
		// the fold body keeps them AT THEIR WIRE POSITIONS so the expanded
		// view replays the turn exactly as delivered (r1 → call → a1's think)
		const chipEntries = s.folded.flatMap((r) => (r.kind === 'chips' ? r.entries : []));
		expect(chipEntries.map((e) => e.id)).toEqual(['r1', 'c1', 'a1']);
		expect(s.messageCount).toBe(1);
	});

	it('reasoning BETWEEN tool calls keeps its between-position in the fold body', () => {
		const s = turnProcess([call('c1', 2, 'k1'), reasoningOnly('r1', 3), call('c2', 4, 'k2'), assistant('a1', 5)]);
		expect(s.escapedReasoning.map((e) => e.id)).toEqual(['r1']);
		// adjacent chips merge into ONE chips row — the between-position is
		// the entry ORDER inside it, which InlineToolCalls renders verbatim
		expect(s.folded.map((r) => r.kind)).toEqual(['chips']);
		const run = s.folded[0];
		expect(run.kind === 'chips' && run.entries.map((e) => e.id)).toEqual(['c1', 'r1', 'c2']);
	});

	it('absorbed injections fold silently and are never counted', () => {
		const s = turnProcess([call('c1', 2, 'k1'), notice('n1', 3), assistant('a1', 4)]);
		const foldedKinds = s.folded.flatMap((r) => (r.kind === 'chips' ? r.entries.map((e) => e.kind) : []));
		expect(foldedKinds).toContain('user-message');
		expect(s.toolCallCount).toBe(1);
		expect(s.messageCount).toBe(1);
		expect(s.folded.length).toBe(1);
	});

	it('narration between tool calls counts as a message and rides INSIDE the expanded fold, wire order', () => {
		const s = turnProcess([
			call('c1', 2, 'k1'),
			assistant('n1', 3),
			call('c2', 4, 'k2'),
			assistant('a1', 5)
		]);
		expect(s.messageCount).toBe(2);
		expect(s.trailingTextRuns.map((r) => r.kind)).toEqual(['text']);
		// the fold body is the FULL pre-boundary sequence in wire order:
		// chips, the narration text run, chips — so expanding reveals the
		// counted messages next to the tool calls
		expect(s.folded.map((r) => r.kind)).toEqual(['chips', 'text', 'chips']);
	});

	it('tool-only turn never folds — no answer to protect', () => {
		const s = turnProcess([call('c1', 2, 'k1'), call('c2', 3, 'k2')]);
		expect(s.hasAnswer).toBe(false);
		expect(s.folds).toBe(false);
		expect(s.folded).toEqual([]);
		expect(s.trailingTextRuns).toEqual([]);
	});

	it('in-flight turns hold open unless progressiveFold opts in (A1/D5)', () => {
		const entries = [call('c1', 2, 'k1'), assistant('a1', 3)];
		expect(turnProcess(entries, { inFlight: true }).folds).toBe(false);
		expect(turnProcess(entries, { inFlight: true, progressiveFold: true }).folds).toBe(true);
		expect(turnProcess(entries, { inFlight: false }).folds).toBe(true);
		expect(turnProcess(entries).folds).toBe(true);
	});

	// a folding turn always carries its answer as ≥1 message, so the
	// zero-count flag only fires on turns without countable families
	it('zero-count fallback: unknown-event-only turn flags allCountsZero', () => {
		const s = turnProcess([reasoningOnly('r1', 2), assistant('a1', 3)]);
		expect(s.hasAnswer).toBe(true);
		expect(s.messageCount).toBe(1);
		expect(s.allCountsZero).toBe(false);
		// the reasoning chip escapes even when nothing else folds
		expect(s.escapedReasoning.map((e) => e.id)).toEqual(['r1']);
		expect(turnProcess([unknown('e1', 2)]).allCountsZero).toBe(true);
	});

	it('key stability: same entries → same summary, independent of pagination window', () => {
		const entries: TurnMember[] = [call('c1', 2, 'k1'), assistant('a1', 3)];
		const a = turnProcess(entries);
		const b = turnProcess([...entries]);
		expect(a).toEqual(b);
		const groups = groupTurns([user('u1', 1), ...entries]);
		expect(groups[1]?.kind).toBe('assistant-turn');
	});

	it('entries are never mutated — the input array and its members survive verbatim (BC-E)', () => {
		const entries: TurnMember[] = [call('c1', 2, 'k1'), reasoningOnly('r1', 3), assistant('a1', 4)];
		const before = JSON.stringify(entries);
		turnProcess(entries);
		expect(JSON.stringify(entries)).toBe(before);
	});

	// ── ADR-0022 (The Escaped Injection): injections escape the fold ──

	it('injections lift to escapedInjections in wire order (D7)', () => {
		const s = turnProcess([
			call('c1', 2, 'k1'),
			notice('n1', 3),
			call('c2', 4, 'k2'),
			notice('n2', 5),
			assistant('a1', 6)
		]);
		expect(s.escapedInjections.map((e) => e.id)).toEqual(['n1', 'n2']);
		// honest-body rule (A4): the fold body keeps them at wire positions
		// (a1 is a TEXT run — the answer — so the chips body ends at n2)
		const chipEntries = s.folded.flatMap((r) => (r.kind === 'chips' ? r.entries : []));
		expect(chipEntries.map((e) => e.id)).toEqual(['c1', 'n1', 'c2', 'n2']);
	});

	it('an injection AFTER the last text run never lifts — it already renders open', () => {
		const s = turnProcess([assistant('a1', 2), notice('n1', 3)]);
		expect(s.escapedInjections).toEqual([]);
	});

	it('an injection in a tool-only turn never lifts — tool-only turns do not fold', () => {
		const s = turnProcess([call('c1', 2, 'k1'), notice('n1', 3)]);
		expect(s.hasAnswer).toBe(false);
		expect(s.escapedInjections).toEqual([]);
	});

	it('escaped injections are uncounted — the disclosure label never changes (D3 half stands)', () => {
		const s = turnProcess([notice('n1', 2), call('c1', 3, 'k1'), assistant('a1', 4)]);
		expect(s.toolCallCount).toBe(1);
		expect(s.messageCount).toBe(1);
		expect(s.subagentCount).toBe(0);
	});

	it('a turn with no injections exports an empty escape list', () => {
		const s = turnProcess([call('c1', 2, 'k1'), assistant('a1', 3)]);
		expect(s.escapedInjections).toEqual([]);
	});

	// ── ADR-0022 I4: unknown-event notices are injected stream content ──

	it('an unknown-event notice joins the escape family (I4) — the work row keeps only work', () => {
		const s = turnProcess([
			call('c1', 2, 'k1'),
			unknown('e1', 3),
			notice('n1', 4),
			assistant('a1', 5)
		]);
		// the notice escapes beside the injection (wire order)
		expect(s.escapedInjections.map((e) => e.id)).toEqual(['e1', 'n1']);
		// counts never included unknown-events — disclosure and work row agree
		expect(s.toolCallCount).toBe(1);
		expect(s.messageCount).toBe(1);
	});
});

// ── Turn End Stamp (2026-09-25, task 1.3-T): markers never group ──
const marker = (turn: number, phase: 'start' | 'end', seq: number): DsiEntry => ({
	kind: 'turn-lifecycle', id: `tl:${turn}:${phase}`, seq, time: 900 + seq, turn, phase,
	...(phase === 'end' ? { reasonKind: 'completed' } : {})
} as DsiEntry);

describe('groupTurns — turn-lifecycle markers (Turn End Stamp task 1.3)', () => {
	it('markers interleaved INSIDE an assistant run do not join or split the group', () => {
		const groups = groupTurns([
			user('u1', 1),
			marker(1, 'start', 2),
			assistant('a1', 3),
			marker(1, 'end', 4),
			assistant('a2', 5)
		]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'assistant-turn']);
		const turn = groups.find((g) => g.kind === 'assistant-turn')!;
		if (turn.kind === 'assistant-turn') {
			expect(turn.entries.map((e) => (e as { id: string }).id)).toEqual(['a1', 'a2']);
		}
	});

	it('a marker where a turn would START does not start a group', () => {
		const groups = groupTurns([marker(1, 'start', 1), user('u1', 2), assistant('a1', 3)]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt', 'assistant-turn']);
	});

	it('an assistant run of ONLY markers produces no group at all', () => {
		const groups = groupTurns([user('u1', 1), marker(1, 'start', 2), marker(1, 'end', 3)]);
		expect(groups.map((g) => g.kind)).toEqual(['prompt']);
	});

	it('group counts and turnProcess are unchanged by markers (Fold Gate regression)', () => {
		const withMarkers = groupTurns([user('u1', 1), marker(1, 'start', 2), call('c1', 3, 'k1'), assistant('a1', 4), marker(1, 'end', 5)]);
		const without = groupTurns([user('u1', 1), call('c1', 3, 'k1'), assistant('a1', 4)]);
		const summarize = (gs: ReturnType<typeof groupTurns>) =>
			gs.filter((g) => g.kind === 'assistant-turn').map((g) => (g.kind === 'assistant-turn' ? g.entries.map((e) => (e as { id: string }).id) : []));
		expect(summarize(withMarkers)).toEqual(summarize(without));
	});
});

describe('turnUsage — the exact total (ADR-0012 D3)', () => {
	const zai = (id: string, seq: number, withTotal: boolean): AssistantSideEntry => ({
		kind: 'assistant-message', id, seq, time: 1000 + seq, text: 'x', streaming: false,
		usage: {
			inputTokens: 11302, outputTokens: 205,
			...(withTotal ? { totalTokens: 22259 } : {}),
			provider: 'zai', model: 'glm-5.3-flash'
		}
	});

	it('a turn where every record carries the total sums it', () => {
		const u = turnUsage([zai('a1', 1, true), zai('a2', 2, true)]);
		expect(u?.totalTokens).toBe(44518);
	});

	it('a turn mixing carriers and non-carriers drops the field (all-or-nothing)', () => {
		const u = turnUsage([zai('a1', 1, true), zai('a2', 2, false)]);
		expect(u).toBeDefined();
		expect(u && 'totalTokens' in u).toBe(false);
	});

	it('the observed bucketless zai turn totals 22,259 while buckets sum 11,507', () => {
		const u = turnUsage([zai('a1', 1, true)]);
		expect(u?.totalTokens).toBe(22259);
		expect(u!.inputTokens + u!.outputTokens).toBe(11507); // the gap D2 closes at render
	});
});


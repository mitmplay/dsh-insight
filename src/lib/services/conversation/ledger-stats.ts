/**
 * ledger-stats — the host's whole-log ledger stats, read from the
 * sessionStats + tokenUsage projections (the todo-projection seam: same
 * control/follow block, pure mapping — no I/O, no Svelte).
 *
 * conversation.statsBar 'full-ledger' renders THESE numbers: the same
 * durable fold the DSH web stats bar shows (packages/session/session-stats
 * projection — every closed step/turn including cancelled and failed, tool
 * call→result wall pairs, TTFT and decode throughput, and the tokenUsage
 * totals' three billed-input buckets). The panel's own
 * deriveSessionStats fold ('partial') only ever sees the entries its store
 * holds, so the two legitimately disagree on long sessions.
 *
 * Null on any missing/malformed input: an older host, an absent projection
 * key, or a schema drift renders the partial bar instead — degrade lane,
 * never a guess.
 */

import type { DsiLedgerStats } from '$lib/types';

/** Non-negative finite number guard (projection values are JSON).
 *  Exported (Subagent Anchor ADR D2) so the /api/dsh/subagents join
 *  validates the same JSON projection values with the same guard —
 *  behavior byte-identical, one validator per house. */
export function nn(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Validate one projection record field-by-field; null on any miss.
 *  Exported (Subagent Anchor ADR D2) alongside `nn` for the subagents
 *  endpoint — the SAME validator, so the popup's numbers and the panel's
 *  stats bar can never disagree on what counts as present. */
export function statsRecord(raw: unknown, fields: readonly string[]): Record<string, number> | null {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const o = raw as Record<string, unknown>;
	const out: Record<string, number> = {};
	for (const field of fields) {
		const v = nn(o[field]);
		if (v === null) return null;
		out[field] = v;
	}
	return out;
}

const SESSION_STATS_FIELDS = [
	'turns',
	'steps',
	'llmMs',
	'toolMs',
	'ttftMs',
	'ttftSteps',
	'decodeMs',
	'decodeTokens'
] as const;

const TOKEN_USAGE_FIELDS = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'] as const;

/**
 * Validate the projections block's ledger-stats pair.
 *
 * @param sessionStats - projections.values.sessionStats (sessionStats wire view).
 * @param tokenUsage - projections.values.tokenUsage (the flat
 *   TokenUsageProjection wire value — the persisted fold state's totals
 *   wrapper never rides the projection stream).
 * @returns the merged ledger stats, or null when either projection is
 *   absent or malformed (the caller keeps the partial fold).
 */
export function ledgerStatsFromProjections(sessionStats: unknown, tokenUsage: unknown): DsiLedgerStats | null {
	const stats = statsRecord(sessionStats, SESSION_STATS_FIELDS);
	if (stats === null) return null;
	const totals = statsRecord(tokenUsage, TOKEN_USAGE_FIELDS);
	if (totals === null) return null;
	return {
		turns: stats.turns,
		steps: stats.steps,
		llmMs: stats.llmMs,
		toolMs: stats.toolMs,
		ttftMs: stats.ttftMs,
		ttftSteps: stats.ttftSteps,
		decodeMs: stats.decodeMs,
		decodeTokens: stats.decodeTokens,
		uncachedInputTokens: totals.uncachedInputTokens,
		cacheReadTokens: totals.cacheReadTokens,
		cacheWriteTokens: totals.cacheWriteTokens,
		outputTokens: totals.outputTokens
	};
}

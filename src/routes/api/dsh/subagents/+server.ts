/**
 * api-dsh — GET /api/dsh/subagents?parent=<sessionId> (Subagent Anchor
 * ADR D2, scoped by the D1-R revision: THIS conversation's children).
 *
 * Tokens: the sessionStats + tokenUsage projections via the bounded
 * waitForProjections baseline (a child nobody opened has no cached
 * block — a bare projectionValue peek reads an empty cache and renders
 * dashes for every row); folded through the SAME ledger-stats validators
 * the per-panel stats bar uses, so popup and panel can never disagree.
 *
 * Elapsed (operate time): the ledger's llmMs — the same fold the panel
 * stats bar shows as 'LLM 36m14s'. The child's durable log is written
 * in bulk around spawn (live-verified 2026-10-26: first and last durable
 * event 76ms apart on a ten-minute helper), so wall-clock from event
 * times is a lie; the ledger's accumulated LLM time is the honest
 * 'how long it operated'.
 *
 * HONEST LANES (Tasks §1): a missing/malformed projection degrades THAT
 * row's tokens AND operate time to null — never synthesized. On the
 * wire null renders a dash and flips the footer to Σ-incomplete (D7).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';
import { ledgerStatsFromProjections } from '$lib/services/conversation/ledger-stats';

import type { DsiSessionSummary, DsiSubagentRow } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ setHeaders, url }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const parent = url.searchParams.get('parent');
	try {
		const conn = getDshConnection();
		const feed = await conn.listSessions();
		const rows = feed.items as DsiSessionSummary[];
		const byId = new Map(rows.map((r) => [r.sessionId, r] as const));

		const children = rows.filter(
			(r) => (r.origin ?? null) === 'subagent' && (parent === null || r.parentSessionId === parent)
		);

		const out = await Promise.all(
			children.map(async (row): Promise<DsiSubagentRow> => {
				const block = await conn.waitForProjections(row.sessionId).catch(() => null);
				const stats = ledgerStatsFromProjections(
					block?.values?.sessionStats,
					block?.values?.tokenUsage
				);
				const spawner = row.parentSessionId ?? null;
				return {
					sessionId: row.sessionId,
					title: row.title ?? null,
					parentTitle: (spawner !== null ? byId.get(spawner)?.title : undefined) ?? null,
					tokens:
						stats === null
							? null
							: {
									input:
										stats.uncachedInputTokens +
										stats.cacheReadTokens +
										stats.cacheWriteTokens,
									output: stats.outputTokens
							  },
					operateMs: stats === null ? null : stats.llmMs,
					running: row.running,
					updatedAt: row.updatedAt
				};
			})
		);
		return json({ ok: true, subagents: out });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};

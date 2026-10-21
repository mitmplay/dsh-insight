/**
 * api-dsh — GET /api/dsh/jobs?sessionId=… · POST /api/dsh/jobs
 *
 * Jobs (ADR-0026 D2/D3, Job Badge Wave 1): the browser's only view of the
 * host's per-session job roster (BC-1/BC-6 — the browser never reaches the
 * DSH Host directly).
 *
 * GET: one job.list snapshot for sessionId — the whole visible set (the
 * session's own jobs plus every unowned job). Live updates ride the mux push
 * path (relay.dispatchJobRoster) or a client refetch; the ledger is NOT
 * authority for live state (ADR fact 10).
 *
 * POST: job.kill passthrough — body {sessionId, jobId} → {outcome}.
 * The session fence stays server-side; a refusal surfaces verbatim.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

/** ADR-0032 D3 — the URL-length guard: one batch per tick for ≤50 watched sessions. */
const JOBS_BATCH_LIMIT = 50;

export const GET: RequestHandler = async ({ url }) => {
	// ADR-0032 D1/D5 — batch form: GET /api/dsh/jobs?sessionIds=a,b,c answers
	// one envelope of per-session rosters so a spine tick costs ONE request.
	// The singular sessionId path below is byte-identical to its pre-batch
	// shape (D5) — the two forms are gated by which query param was sent.
	const batchParam = url.searchParams.get('sessionIds');
	if (batchParam !== null) {
		const ids = [...new Set(batchParam.split(',').map((s) => s.trim()).filter(Boolean))];
		if (ids.length === 0 || ids.length > JOBS_BATCH_LIMIT) {
			return json(
				{
					ok: false,
					error: {
						code: 'bad-session',
						message: `sessionIds must list 1-${JOBS_BATCH_LIMIT} comma-separated session ids`
					}
				},
				{ status: 400 }
			);
		}
		const rosters: Record<string, { jobs: import('$lib/types').DsiJobView[]; pending?: boolean }> = {};
		const relay = getDshConnection().relay;
		for (const id of ids) {
			try {
				relay.touchJobRoster(id);
				const frame = relay.jobRosterSnapshot(id);
				rosters[id] = frame.pending ? { jobs: frame.jobs, pending: true } : { jobs: frame.jobs };
			} catch {
				// Per-id degradation (ADR-0032 §7): one poisoned session must not
				// 500 the whole chunk — it answers honest pending instead.
				rosters[id] = { jobs: [], pending: true };
			}
		}
		return json({ ok: true, rosters });
	}
	const sessionId = url.searchParams.get('sessionId');
	if (!sessionId) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId query parameter is required' } },
			{ status: 400 }
		);
	}
	try {
		// The Roster Mirror (ADR 2026-10-17 D1/D3): the poll tick is the
		// server-side watch heartbeat; the answer is the cached newest
		// job/list frame, or an honest pending — never a unary host call
		// (the host refuses unary on its stream-only method; RCA 2026-10-17).
		const relay = getDshConnection().relay;
		relay.touchJobRoster(sessionId);
		const frame = relay.jobRosterSnapshot(sessionId);
		return json({
			ok: true,
			sessionId,
			jobs: frame.jobs,
			...(frame.pending ? { pending: true } : {})
		});
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}
	const { sessionId, jobId } = (body ?? {}) as { sessionId?: unknown; jobId?: unknown };
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId is required' } },
			{ status: 400 }
		);
	}
	if (typeof jobId !== 'string' || jobId.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-job', message: 'jobId is required' } },
			{ status: 400 }
		);
	}
	try {
		const result = await getDshConnection().relay.jobKill(sessionId, jobId);
		return json({ ok: true, outcome: result.outcome });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};

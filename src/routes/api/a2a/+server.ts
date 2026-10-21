/**
 * /api/a2a (2026-08-25) — the a2a read surface: recent ledger rows for the
 * sender-panel chip join (W4), newest first, optional from-filter.
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD communication map "routes → browser"; Tasks 3.2/3.2-T).
 *
 * Read-only: browser code never imports $lib/server (BC-2) — this JSON
 * route is its only window onto the ledger. Never exposes the DB path.
 *
 * Boot re-arm (2026-08-25 RCA follow-up, risk 2): a dev-server restart
 * mid-watch left waiting rows with a dead ticker until the next register.
 * The browser chip already polls this route on the spine's 5s cadence —
 * the idempotent ensureStarted() below means any open page revives the
 * watcher within one cadence (and the once-per-process boot sweep expires
 * stale rows honestly). The route stays read-only in the DB sense: it
 * never writes rows itself.
 */

import { json } from '@sveltejs/kit';
import { listRecent } from '$lib/server/a2a/db.js';
import { ensureStarted } from '$lib/server/a2a/watcher.js';
import type { RequestHandler } from './$types';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export const GET: RequestHandler = ({ url }) => {
	ensureStarted();
	const from = url.searchParams.get('from') ?? undefined;
	const rawLimit = url.searchParams.get('limit');
	let limit = DEFAULT_LIMIT;
	if (rawLimit !== null) {
		const parsed = Number.parseInt(rawLimit, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			return json({ ok: false, error: { code: 'bad-limit', message: 'limit must be a positive integer' } }, { status: 400 });
		}
		limit = Math.min(parsed, MAX_LIMIT);
	}
	const rows = listRecent(limit, from);
	return json({ ok: true, rows });
};

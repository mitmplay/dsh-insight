/**
 * /api/a2a/[id] (2026-08-25) — one ledger row (debug-friendly single
 * lookup; the chip join uses the list route).
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD communication map; Tasks 3.2/3.2-T). 404 on unknown id.
 */

import { json } from '@sveltejs/kit';
import { getRow } from '$lib/server/a2a/db.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const row = getRow(params.id);
	if (row === null) {
		return json({ ok: false, error: { code: 'not-found', message: `no a2a exchange ${params.id}` } }, { status: 404 });
	}
	return json({ ok: true, row });
};

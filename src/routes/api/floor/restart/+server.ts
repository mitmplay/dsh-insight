/**
 * POST /api/floor/restart — the Restart Verb (ADR 2026-10-12, D1).
 *
 * Delegates to the SAME detached chain plugin-apply uses: answer
 * { ok, restarting } FIRST, then the chain kills and re-serves the floor
 * in the same mode (W3.5 mode fidelity). No body, no engine work — this
 * route exists so the verb does not piggyback on plugin apply.
 */
import { json } from '@sveltejs/kit';
import { spawnRestartChain } from '$lib/server/plugins/restart-chain';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const restarting = spawnRestartChain();
	if (!restarting) {
		// Honest false: the bin is missing — the operator restarts by hand.
		return json({ ok: false, error: 'restart chain could not spawn (missing bin)' }, { status: 500 });
	}
	return json({ ok: true, restarting: true });
};

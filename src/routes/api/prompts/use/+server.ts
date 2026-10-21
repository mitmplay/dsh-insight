/**
 * POST /api/prompts/use — COUNT-ONLY use ledger (The Prompt Tags ADR,
 * 2026-09-14, D7): bump use_count + refresh last_used_at for a KNOWN row
 * (the strip's ?/! ranking input); unknown text returns 200 {counted:
 * false} and inserts NOTHING. The insert leg (prompts.autoAdd upsert) is
 * decommissioned — every library row is born through the tagged save
 * popup or an operator edit, never a passive send.
 *
 * Body: { text: string }. One fire-and-forget call per admitted ordinary
 * send (command-executor); the route stays stateless and thin.
 *
 * Supersedes: the 202 {skipped, reason} autoAdd contract (Suggest Strip
 * Tasks 1.3); the use-count leg of that route is preserved unchanged.
 */

import { json } from '@sveltejs/kit';
import { countPromptUse } from '$lib/server/prompts/db.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const text = (body as { text?: unknown })?.text;
	if (typeof text !== 'string' || text.trim().length === 0) {
		return json({ error: 'text must be a non-empty string' }, { status: 400 });
	}

	const result = countPromptUse(text);
	if (result === null) {
		return json({ error: 'Failed to record prompt use' }, { status: 500 });
	}
	if (!result.counted) {
		// Unknown text — count-only means no insert, by design (D7).
		return json({ counted: false });
	}
	return json({ record: result.record });
};

/**
 * /api/browser/[id]/close — the D8 owner-release endpoint.
 * Kills the MCP child, the CDP session, the headed Chromium; frees the port;
 * removes the registry entry. Idempotent: closing a gone session is 200.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string } }): Promise<Response> => {
	const r = await browserRegistry.close(ctx.params.id);
	return json({ ok: r.ok, alreadyClosed: r.alreadyClosed });
};

/**
 * /api/browser/[id]/closetab — close ONE tab (the strip ✕, BUGFIX round 3).
 * Body { targetId }. Closing the LAST tab is refused (NO_TARGET): session
 * death belongs to the kill ladder (trash / reaper), never to a tab ✕.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	let body: { targetId?: unknown };
	try {
		body = (await ctx.request.json()) as typeof body;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	if (typeof body.targetId !== 'string' || !body.targetId) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		return json(await browserRegistry.closeTab(ctx.params.id, body.targetId));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' ? 404 : err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

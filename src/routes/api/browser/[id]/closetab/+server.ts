/**
 * /api/browser/[id]/closetab — close ONE tab (the strip ✕, BUGFIX round 3).
 * Body { targetId } OR { tabId } (glass-tab-ids: the strip addresses tabs
 * by their session-stable ordinal). A retired/unknown tabId is an EXPLICIT
 * 404 — never a silent nearest-match. Closing the LAST tab is refused
 * (NO_TARGET): session death belongs to the kill ladder (trash / reaper),
 * never to a tab ✕.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

const NUMERIC = /^\d+$/;

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	let body: { tabId?: unknown; targetId?: unknown };
	try {
		body = (await ctx.request.json()) as typeof body;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	// one of the two grammars, verbatim: an ordinal (number / numeric
	// string) or a non-empty targetId string. Everything else is a 400.
	let ref: string | number | null = null;
	if (typeof body.tabId === 'number' || (typeof body.tabId === 'string' && NUMERIC.test(body.tabId))) {
		ref = typeof body.tabId === 'number' ? body.tabId : body.tabId;
	} else if (typeof body.targetId === 'string' && body.targetId) {
		ref = body.targetId;
	}
	if (ref === null) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		return json(await browserRegistry.closeTab(ctx.params.id, ref));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' ? 404 : err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

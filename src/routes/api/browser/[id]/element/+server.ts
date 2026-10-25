/**
 * /api/browser/[id]/element — what the page has under viewport coords
 * (BUGFIX 2026-10-25): the glass context menu's data pass. Chrome's NATIVE
 * right-click menu is browser UI and never renders in the screencast, so
 * DSI renders its own; this answers href/src/text under the point.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	let body: { x?: unknown; y?: unknown; targetId?: unknown };
	try {
		body = (await ctx.request.json()) as typeof body;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	if (typeof body.x !== 'number' || typeof body.y !== 'number' || !Number.isFinite(body.x) || !Number.isFinite(body.y)) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	const targetId = typeof body.targetId === 'string' && body.targetId ? body.targetId : undefined;
	try {
		return json(await browserRegistry.elementAt(ctx.params.id, body.x, body.y, targetId));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

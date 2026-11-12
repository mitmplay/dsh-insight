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
	let body: { x?: unknown; y?: unknown; targetId?: unknown; selectionOnly?: unknown; selectAll?: unknown };
	try {
		body = (await ctx.request.json()) as typeof body;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	const targetId = typeof body.targetId === 'string' && body.targetId ? body.targetId : undefined;
	// ADR-0061 D7/D8 (amendments 2026-11-12): the POINT-LESS passes — ⌘A
	// select-all and ⌘C selection read need no x/y point. Still NO new route.
	const selectionOnly = body.selectionOnly === true;
	const selectAll = body.selectAll === true;
	if (selectionOnly || selectAll) {
		try {
			const selection = selectAll ? await browserRegistry.selectAll(ctx.params.id, targetId) : await browserRegistry.selectionOf(ctx.params.id, targetId);
			return json({ href: null, src: null, text: null, selection });
		} catch (err) {
			if (err instanceof BrowserRegistryRefusal) {
				return json({ error: err.code }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
			}
			throw err;
		}
	}
	if (typeof body.x !== 'number' || typeof body.y !== 'number' || !Number.isFinite(body.x) || !Number.isFinite(body.y)) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		return json(await browserRegistry.elementAt(ctx.params.id, body.x, body.y, targetId));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

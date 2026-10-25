/**
 * /api/browser/[id]/activate — move the glass's face to another tab
 * (ADR-0040 D1/D2/D4): lazy attach, per-switch first-frame seed, pointer
 * move. The answer IS the boundary frame (seq + jpeg) so the panel never
 * waits on a blank paint; the SSE then resumes from that seq.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	let body: { targetId?: unknown };
	try {
		body = (await ctx.request.json()) as { targetId?: unknown };
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	if (typeof body.targetId !== 'string' || !body.targetId) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		return json(await browserRegistry.activate(ctx.params.id, body.targetId));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' ? 404 : err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

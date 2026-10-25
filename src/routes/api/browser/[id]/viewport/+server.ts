/**
 * /api/browser/[id]/viewport — size the mirrored page to the panel's
 * glass box (ADR-0031 amendment 2): the screencast frame then matches
 * the panel, so content renders at native scale, never zoomed. The
 * registry clamps; this route only validates shapes.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: { width?: unknown; height?: unknown; targetId?: unknown };
	try {
		body = (await ctx.request.json()) as { width?: unknown; height?: unknown; targetId?: unknown };
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	if (typeof body.width !== 'number' || typeof body.height !== 'number' || !Number.isFinite(body.width) || !Number.isFinite(body.height)) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		// ADR-0040 D3: optional tab pointer; absent means the ACTIVE tab
		const targetId = typeof body.targetId === 'string' && body.targetId ? body.targetId : undefined;
		// keep the 3-arg call shape when no tab is targeted (call-compat)
		if (targetId) await browserRegistry.setViewport(ctx.params.id, body.width, body.height, targetId);
		else await browserRegistry.setViewport(ctx.params.id, body.width, body.height);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			// NO_TARGET (ADR-0040) is a 404 like NO_SESSION; only tombstones 409
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

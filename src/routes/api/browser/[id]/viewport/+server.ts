/**
 * /api/browser/[id]/viewport — size the mirrored page to the panel's
 * glass box (ADR-0031 amendment 2): the screencast frame then matches
 * the panel, so content renders at native scale, never zoomed. The
 * registry clamps; this route only validates shapes.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: { width?: unknown; height?: unknown };
	try {
		body = (await ctx.request.json()) as { width?: unknown; height?: unknown };
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	if (typeof body.width !== 'number' || typeof body.height !== 'number' || !Number.isFinite(body.width) || !Number.isFinite(body.height)) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		await browserRegistry.setViewport(ctx.params.id, body.width, body.height);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 409 });
		}
		throw err;
	}
};

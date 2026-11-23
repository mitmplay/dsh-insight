/**
 * /api/terminal/[id]/reattach — token re-mint for a page reload (The
 * Surviving Shell, ADR 2026-09-24 D2): a thin POST over the registry's
 * reattach — the asking tab gets a fresh token and the session's whole-
 * stream byte tail; the old token dies (many watchers, one writer).
 *
 * Baton facet (ADR-0079 D3): the body is OPTIONAL — `{holder?: 'operator'|
 * 'automation', holderId?: string}` records WHO took the baton. No body, a
 * non-JSON body, or junk fields all mean the operator default (the desk's
 * own `{}` posts); the route never answers 400 for a label. The mint
 * pushes one `baton` frame on both SSE paths (D7) — the desk sees the
 * takeover without a keystroke.
 */
import { json } from '@sveltejs/kit';

import { terminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import type { BatonMintOptions } from '$lib/server/terminal/registry.js';

/** resolve(request) for the mint labels — the route's own defaulting step
 *  (mirrors /api/terminal POST): only `automation` is a claimable
 *  non-default label, a label is a non-empty string or nothing. */
function resolveMintOptions(body: { holder?: unknown; holderId?: unknown }): BatonMintOptions {
	return {
		holder: body.holder === 'automation' ? 'automation' : 'operator',
		holderId: typeof body.holderId === 'string' && body.holderId.length > 0 ? body.holderId : null
	};
}

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: { holder?: unknown; holderId?: unknown } = {};
	try {
		const parsed: unknown = await ctx.request.json();
		body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { holder?: unknown; holderId?: unknown }) : {};
	} catch {
		body = {}; // no body / not JSON — the operator default, never a 400
	}
	try {
		const { holder, holderId } = resolveMintOptions(body);
		const { token, fromByte } = terminalRegistry.reattach(ctx.params.id, holder, holderId);
		return json({ token, fromByte });
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		}
		throw err;
	}
};

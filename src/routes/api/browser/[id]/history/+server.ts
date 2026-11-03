/**
 * /api/browser/[id]/history — the long-press history dropdown's wire
 * (operator-approved 2026-10-28). GET ?targetId=... answers the FOCUSED
 * tab's full navigation history { currentIndex, entries }; POST
 * { targetId?, index } travels to that entry via CDP
 * Page.navigateToHistoryEntry (TRUE history travel — no new entries
 * appended). 404/409 refusals follow the closetab/navigate pattern.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const GET = async (ctx: { params: { id: string }; url: URL }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	const targetId = ctx.url.searchParams.get('targetId') ?? undefined;
	try {
		return json(await browserRegistry.navEntries(ctx.params.id, targetId));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	let body: { targetId?: unknown; index?: unknown };
	try {
		body = (await ctx.request.json()) as typeof body;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	const targetId = typeof body.targetId === 'string' && body.targetId ? body.targetId : undefined;
	if (typeof body.index !== 'number') return json({ error: 'BAD_REQUEST' }, { status: 400 });
	try {
		return json(await browserRegistry.historyTravel(ctx.params.id, body.index, targetId));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

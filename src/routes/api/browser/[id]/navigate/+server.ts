/**
 * /api/browser/[id]/navigate — drive the mirrored browser's page from the
 * header proxies (ADR-0031 D1–D4): a closed union of { url } (the original
 * address-bar verb, ADR-0029 Wave 2), { action: 'reload' } (D4),
 * { action: 'back' } / { action: 'forward' } (D3). One route, one refusal
 * path; every branch answers the landed page's pageInfo.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

const URL_OK = /^https?:\/\/|^data:text\/html/;
const ACTIONS = new Set(['reload', 'back', 'forward']);

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: { url?: unknown; action?: unknown };
	try {
		body = (await ctx.request.json()) as { url?: unknown; action?: unknown };
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	// the closed union: exactly one member or the door stays shut
	if (!('url' in body) === !('action' in body)) {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	try {
		if ('url' in body) {
			if (typeof body.url !== 'string' || !URL_OK.test(body.url)) {
				return json({ error: 'BAD_URL' }, { status: 400 });
			}
			await browserRegistry.navigate(ctx.params.id, body.url, { waitLoad: true });
			// every answer carries the history position (ADR-0031): the header
			// buttons ride currentIndex/entryCount, whatever the verb was
			return json({
				...(await browserRegistry.pageInfo(ctx.params.id)),
				...(await browserRegistry.navInfo(ctx.params.id))
			});
		}
		if (typeof body.action !== 'string' || !ACTIONS.has(body.action)) {
			return json({ error: 'BAD_ACTION' }, { status: 400 });
		}
		if (body.action === 'reload') {
			return json(await browserRegistry.reload(ctx.params.id));
		}
		const info = await browserRegistry.pageHistory(ctx.params.id, body.action as 'back' | 'forward');
		return json(info);
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' ? 404 : 409 });
		}
		throw err;
	}
};
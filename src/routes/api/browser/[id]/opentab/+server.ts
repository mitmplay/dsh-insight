/**
 * /api/browser/[id]/opentab — open a NEW tab in the glass and make it the
 * active face. With { url } (http(s) or data: like navigate): the context
 * menu's 'open in new tab' verbs. WITHOUT a url — absent or empty (ADR-0042
 * D1, the strip's + chip): a BLANK tab, the birth state again.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

const URL_OK = /^https?:\/\/|^data:text\/html/;

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	let body: { url?: unknown };
	try {
		body = (await ctx.request.json()) as typeof body;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	// ADR-0042 D1: absent/empty url = open a BLANK tab (+ chip); the strict
	// grammar applies only when a URL is actually requested — and any
	// PRESENT non-string url is still a refusal, not a silent blank.
	const hasUrl = body.url !== undefined && body.url !== '';
	if (hasUrl && (typeof body.url !== 'string' || !URL_OK.test(body.url))) {
		return json({ error: 'BAD_URL' }, { status: 400 });
	}
	try {
		return json(await browserRegistry.openTab(ctx.params.id, hasUrl ? (body.url as string) : undefined));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code, reason: err.message }, { status: err.code === 'NO_SESSION' ? 404 : err.code === 'NO_TARGET' ? 404 : 409 });
		}
		throw err;
	}
};

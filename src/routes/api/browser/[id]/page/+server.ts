/**
 * /api/browser/[id]/page — the active page's { url, title } (Wave 2
 * amendment: the status strip's location read; the e2e's DOM-truth channel).
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const GET = async (ctx: { params: { id: string }; url: URL }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	try {
		// ADR-0040 D3: optional tab pointer; absent means the ACTIVE tab
		const tid = ctx.url.searchParams.get('targetId') ?? undefined;
		return json(await browserRegistry.pageInfo(ctx.params.id, tid || undefined));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 409 });
		}
		throw err;
	}
};
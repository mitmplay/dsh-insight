/**
 * /api/browser/[id]/page — the active page's { url, title } (Wave 2
 * amendment: the status strip's location read; the e2e's DOM-truth channel).
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const GET = async (ctx: { params: { id: string } }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	try {
		return json(await browserRegistry.pageInfo(ctx.params.id));
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 409 });
		}
		throw err;
	}
};
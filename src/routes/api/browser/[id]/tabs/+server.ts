/**
 * /api/browser/[id]/tabs — enumerate the glass context's pages (ADR-0040
 * D5): the tab strip's feed. type:page only; read-only, never attaches,
 * never streams (D1 — only the active tab streams).
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const GET = async (ctx: { params: { id: string } }): Promise<Response> => {
	if (browserRegistry.isClosed(ctx.params.id)) return json({ error: 'CLOSED' }, { status: 409 });
	try {
		return json({ tabs: await browserRegistry.listTabs(ctx.params.id) });
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 409 });
		}
		throw err;
	}
};

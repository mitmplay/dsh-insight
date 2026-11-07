/**
 * DELETE /api/terminal/[id]/delete — kill + PRUNE (ADR amendment
 * 2026-11-07, D2 extension; spec 2026-11-07 Terminal Prune Verb).
 *
 * Runs the proven close ladder over terminalRegistry.destroy, then the
 * registry entry (id + ring) is gone from list() in the same call. The
 * fence applies: the request presents the session's token; a wrong one
 * is refused FOREIGN_SESSION (the desk heals once — reattach, retry the
 * SAME verb — per the 2026-11-04 auto-heal law).
 */
import { json } from '@sveltejs/kit';

import { TerminalRegistryRefusal, terminalRegistry } from '$lib/server/terminal/registry.js';

export const DELETE = async ({ params, request }: { params: { id: string }; request: Request }): Promise<Response> => {
	let token: unknown = null;
	try {
		const body = (await request.json()) as { token?: unknown };
		token = body?.token;
	} catch {
		token = null;
	}
	if (typeof token !== 'string' || token.length === 0) {
		return json({ error: 'FOREIGN_SESSION' }, { status: 403 });
	}
	try {
		const result = await terminalRegistry.destroy(params.id, token);
		return json(result);
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		}
		throw err;
	}
};

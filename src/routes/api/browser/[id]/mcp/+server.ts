/**
 * /api/browser/[id]/mcp — the agent's connection descriptor (Wave 3, 3.3).
 * GET: where the DSH agent's MCP config points for THIS session —
 * { mode, url?, pid? }. The in-process brain serves SSE on the sibling
 * listener; the child mode is stdio (the agent host spawns it itself).
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

export const GET = (ctx: { params: { id: string } }): Response => {
	try {
		const info = browserRegistry.list().find((s) => s.id === ctx.params.id);
		if (!info) return json({ error: 'NO_SESSION' }, { status: 404 });
		if (info.mcp === 'in-process') {
			// the brain's ACTUAL bound port (stable 9515; scan fallback reports its own)
			return json({ mode: 'in-process', url: browserRegistry.mcpBrainUrl(ctx.params.id), health: info.mcpHealth });
		}
		if (info.mcp === 'child') {
			return json({ mode: 'stdio', command: 'npx @playwright/mcp@<pin> --cdp-endpoint http://127.0.0.1:' + info.port, pid: info.pid, health: info.mcpHealth });
		}
		return json({ mode: 'none', health: info.mcpHealth });
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) return json({ error: err.code }, { status: 404 });
		throw err;
	}
};

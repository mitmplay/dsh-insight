/**
 * /api/browser — the session table (Wave 1 task 1.4).
 * GET lists sessions; POST opens a new headed browser session (D2/D5) and
 * returns { id, port }. The registry owns every refusal.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry } from '$lib/server/browser/registry.js';

export const GET = (): Response => json({ sessions: browserRegistry.list() });

export const POST = async (event?: { request?: Request }): Promise<Response> => {
	try {
		// BUGFIX round 11 (operator: glass born desktop-scale): the opener
		// measures its BrowserContent box BEFORE this POST and passes it —
		// the glass is born at the size of the panel it will live in.
		let width: number | undefined;
		let height: number | undefined;
		try {
			const body = event?.request ? (await event.request.json()) as { width?: number; height?: number } : {};
			if (typeof body.width === 'number' && body.width >= 200) width = Math.round(body.width);
			if (typeof body.height === 'number' && body.height >= 120) height = Math.round(body.height);
		} catch { /* empty body — defaults apply */ }
		const info = await browserRegistry.open({ width, height });
		return json(info);
	} catch (e) {
		return json({ error: 'OPEN_FAILED', message: (e as Error).message }, { status: 500 });
	}
};

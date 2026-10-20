/**
 * /api/browser — the session table (Wave 1 task 1.4).
 * GET lists sessions; POST opens a new headed browser session (D2/D5) and
 * returns { id, port }. The registry owns every refusal.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry } from '$lib/server/browser/registry.js';

export const GET = (): Response => json({ sessions: browserRegistry.list() });

export const POST = async (): Promise<Response> => {
	try {
		const info = await browserRegistry.open();
		return json(info);
	} catch (e) {
		return json({ error: 'OPEN_FAILED', message: (e as Error).message }, { status: 500 });
	}
};

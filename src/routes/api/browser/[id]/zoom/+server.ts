/**
 * /api/browser/[id]/zoom — the live zoom slider's wire door (2026-10-28,
 * operator-approved). POST {zoom: 0.5..1.25} stores the session zoom and
 * pushes it to every attached tab instantly (registry.setZoom); GET
 * answers the session's current zoom + whether the config knob is even
 * enabled (the panel hides the slider when it is not).
 */
import { json } from '@sveltejs/kit';

import { readBrowserConfig } from '$lib/server/insight-config.js';
import { browserRegistry, BrowserRegistryRefusal, clampZoom } from '$lib/server/browser/registry.js';

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: { zoom?: unknown };
	try {
		body = (await ctx.request.json()) as { zoom?: unknown };
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	const zoom = clampZoom(body.zoom);
	if (zoom === null) return json({ error: 'BAD_REQUEST' }, { status: 400 });
	try {
		await browserRegistry.setZoom(ctx.params.id, zoom);
		return json({ ok: true, zoom });
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 409 });
		}
		throw err;
	}
};

export const GET = async (ctx: { params: { id: string } }): Promise<Response> => {
	const cfg = readBrowserConfig();
	try {
		const e = browserRegistry.peek(ctx.params.id);
		return json({ zoom: e.zoom ?? cfg.contentZoom, knobEnabled: cfg.contentZoom !== 1 });
	} catch {
		// no live session — the config knob alone decides visibility
		return json({ zoom: cfg.contentZoom, knobEnabled: cfg.contentZoom !== 1 });
	}
};

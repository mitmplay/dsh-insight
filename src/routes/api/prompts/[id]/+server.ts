/**
 * PATCH /api/prompts/[id] — update a prompt (ADR D3/D8 + E4 extend).
 * Body fields (any subset): { label?: string | null, text?: string,
 * use_count?: number, macro?: boolean, tags?: string } — label null clears it, use_count
 * floored at 1 (reset), macro toggles the macro flag. 200 + record on
 * success; 409 on text/label collision or no-op against a missing row;
 * 400 on invalid id/body.
 *
 * DELETE /api/prompts/[id] — remove a saved prompt (ADR D8 row menu).
 * 200 {ok}; 404 unknown id; 400 invalid id.
 *
 * Spec: dev/specs/2026-08-28 - DSI Suggest Strip (PRD Module Map
 *      "prompts-api"; Tasks 1.3). Reference: OCI [id]/+server.ts.
 */

import { json } from '@sveltejs/kit';
import { renamePromptLabel, deletePrompt, updatePrompt } from '$lib/server/prompts/db.js';
import type { RequestHandler } from './$types.js';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const b = body as { label?: unknown; text?: unknown; use_count?: unknown; macro?: unknown; tags?: unknown };

	// Full update path when text, use_count, macro, or tags present (E4 extend + The Prompt Tags)
	if (
		b.text !== undefined ||
		b.use_count !== undefined ||
		b.macro !== undefined ||
		b.tags !== undefined
	) {
		if (b.text !== undefined && typeof b.text !== 'string') {
			return json({ error: 'text must be a string' }, { status: 400 });
		}
		if (b.use_count !== undefined && typeof b.use_count !== 'number') {
			return json({ error: 'use_count must be a number' }, { status: 400 });
		}
		if (b.macro !== undefined && typeof b.macro !== 'boolean') {
			return json({ error: 'macro must be a boolean' }, { status: 400 });
		}
		if (b.tags !== undefined && typeof b.tags !== 'string') {
			return json({ error: 'tags must be a string (space/comma separated words)' }, { status: 400 });
		}
		const updated = updatePrompt(id, {
			text: b.text as string | undefined,
			label: b.label as string | null | undefined,
			use_count: b.use_count as number | undefined,
			macro: b.macro as boolean | undefined,
			tags: b.tags as string | undefined
		});
		if (!updated) return json({ error: 'Not found or conflict' }, { status: 409 });
		return json({ record: updated });
	}

	// Legacy: label-only rename (original D3/D8 path)
	const label = b.label;
	if (label !== null && typeof label !== 'string') {
		return json({ error: 'label must be a string or null' }, { status: 400 });
	}

	const ok = renamePromptLabel(id, label);
	if (!ok) return json({ error: 'Label conflict or not found' }, { status: 409 });

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}
	const ok = deletePrompt(id);
	if (!ok) return json({ error: 'Not found' }, { status: 404 });
	return json({ ok: true });
};

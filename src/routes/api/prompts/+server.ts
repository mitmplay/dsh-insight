/**
 * GET /api/prompts — search + manager list (Suggest Strip W1, Task 1.2).
 *
 * Search mode (default): `?q=<query>&limit=&mode=prefix|contains&macro=0|1`
 *   Ranked by use_count DESC, last_used_at DESC; `{ results }` shape,
 *   limit clamped ≤10. `mode=contains` routes to the tiered `?` search
 *   (schema v2 FTS5); absent or unrecognized mode keeps the prefix
 *   contract — a stale client never gets a 500 (thin route). `macro`
 *   filters the macro flag: 1 = macro rows only (the `!` run trigger),
 *   0 = ordinary rows only (the `?` find trigger); absent = all rows.
 *
 * Manager mode (ADR E4): when `sort` is present, switches to listPrompts:
 *   `?q=&limit=&offset=&sort=uses|last_used|created|display&dir=asc|desc`
 *   Returns `{ rows, total }` (limit clamped ≤500, default 200).
 *
 * POST /api/prompts — create (ADR E4). Body: { text, label? }.
 *   201 + record on success; 409 + existing row on duplicate text; 400 on
 *   invalid body. `tags?: string[]` extends the body additively (The
 *   Prompt Tags ADR, 2026-09-14, D6): any invalid word → 400.
 *
 * Spec: dev/specs/2026-08-28 - DSI Suggest Strip (PRD Module Map
 *      "prompts-api"; Tasks 1.2). DSI drops OCI's ghost param — the ghost
 *      is out (ADR §6); the strip is the only finder surface.
 */

import { json } from '@sveltejs/kit';
import { searchPrompts, listPrompts, createPrompt } from '$lib/server/prompts/db.js';
import { isValidTagWord, parseTagWords } from '$lib/server/prompts/tags.js';
import type { RequestHandler } from './$types.js';

const MAX_LIMIT = 10;

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const limitParam = Number(url.searchParams.get('limit'));
	const limit =
		Number.isFinite(limitParam) && limitParam > 0
			? Math.min(Math.floor(limitParam), MAX_LIMIT)
			: 5;
	const modeParam = url.searchParams.get('mode');
	const mode = modeParam === 'contains' ? 'contains' : 'prefix';
	const macroParam = url.searchParams.get('macro');
	const macro = macroParam === '0' || macroParam === '1' ? (Number(macroParam) as 0 | 1) : undefined;
	const sort = url.searchParams.get('sort');

	// Manager mode: when `sort` param is present, use listPrompts (paging,
	// sort, total) — the manager's table contract, distinct from search.
	if (sort) {
		const offset = Number(url.searchParams.get('offset')) || 0;
		const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
		const mgrLimit =
			Number.isFinite(limitParam) && limitParam > 0
				? Math.min(Math.floor(limitParam), 500)
				: 200;
		// D4/D11: comma-separated tag words, grammar-gated (invalid dropped —
		// the words can never carry LIKE wildcards into the predicate).
		const tags = parseTagWords(url.searchParams.get('tags') ?? '');
		const result = listPrompts({ q, tags, limit: mgrLimit, offset, sort, dir });
		return json(result);
	}

	const results = searchPrompts(q, limit, { mode, macro });
	return json({ results });
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const text = (body as { text?: unknown })?.text;
	const label = (body as { label?: unknown })?.label;
	// Add-dialog extend: create may seed use_count/macro directly (the Add
	// dialog mirrors the Edit dialog's fields); absent = insert defaults
	// (1 / not-macro) so stale clients keep working.
	const useCount = (body as { use_count?: unknown })?.use_count;
	const macro = (body as { macro?: unknown })?.macro;

	if (typeof text !== 'string' || text.trim().length === 0) {
		return json({ error: 'text must be a non-empty string' }, { status: 400 });
	}
	if (label !== undefined && label !== null && typeof label !== 'string') {
		return json({ error: 'label must be a string or null' }, { status: 400 });
	}
	if (useCount !== undefined && typeof useCount !== 'number') {
		return json({ error: 'use_count must be a number' }, { status: 400 });
	}
	if (macro !== undefined && typeof macro !== 'boolean') {
		return json({ error: 'macro must be a boolean' }, { status: 400 });
	}
	// The Prompt Tags ADR D3/D6: tags is an optional string array; ANY
	// non-string member or grammar-invalid word rejects (400) — the route
	// gate rejects, it never coerces. Absent = untagged (additive: stale
	// clients POSTing {text} alone keep working).
	const rawTags = (body as { tags?: unknown })?.tags;
	if (rawTags !== undefined && (!Array.isArray(rawTags) || !rawTags.every((t) => typeof t === 'string'))) {
		return json({ error: 'tags must be an array of strings' }, { status: 400 });
	}
	const tagWords = (Array.isArray(rawTags) ? (rawTags as string[]) : []).map((t) =>
		t.trim().toLowerCase()
	);
	if (tagWords.some((t) => !isValidTagWord(t))) {
		return json({ error: 'invalid tag word' }, { status: 400 });
	}

	const result = createPrompt(
		text,
		label as string | null | undefined,
		tagWords,
		useCount !== undefined ? { use_count: useCount, macro: macro === true } : undefined
	);
	if (!result.ok) {
		if (result.existing) {
			return json({ error: 'Duplicate', existing: result.existing }, { status: 409 });
		}
		return json({ error: 'Failed to create prompt' }, { status: 500 });
	}

	return json({ record: result.record }, { status: 201 });
};

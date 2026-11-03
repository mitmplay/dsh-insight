/**
 * POST /api/prompts/use — EDGE arms (coverage gap sweep, 2026-10-30).
 * prompts-routes.test.ts owns the happy contracts; this file pins the
 * remaining arms of the thin route: invalid-JSON body -> 400, the
 * whitespace-only-text guard, and the DB-unavailable -> 500 arm
 * (countPromptUse null — the openPromptsDb seam).
 *
 * Node env (serverOnlyTestFiles) — imports the real prompts db seam.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetPromptsDbCache, PROMPTS_DB_ENV, recordPromptUse } from '$lib/server/prompts/db.js';
import { POST as POST_USE } from '../../src/routes/api/prompts/use/+server';

const BASE = 'http://localhost';

/** Minimal RequestEvent double — the established prompts-routes pattern. */
function mkEvent(e: Record<string, unknown>): never {
	return { setHeaders: () => {}, ...e } as never;
}

function postRaw(body: string): Promise<Response> {
	return Promise.resolve(
		POST_USE(
			mkEvent({
			request: new Request(`${BASE}/api/prompts/use`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			})
		})
		)
	);
}

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-prompts-use-'));
	process.env[PROMPTS_DB_ENV] = join(tmpRoot, 'prompts.sqlite');
	__resetPromptsDbCache();
});

afterEach(() => {
	__resetPromptsDbCache();
	delete process.env[PROMPTS_DB_ENV];
});

describe('POST /api/prompts/use — edge arms', () => {
	it('invalid JSON body -> 400 {error:"Invalid JSON body"}', async () => {
		const res = await postRaw('not json');
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({ error: 'Invalid JSON body' });
	});

	it('whitespace-only text -> 400 (the trim guard, not just missing text)', async () => {
		const res = await postRaw(JSON.stringify({ text: '   \n\t ' }));
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({
			error: 'text must be a non-empty string'
		});
	});

	it('known text still counts on a healthy db (file-local happy path)', async () => {
		recordPromptUse('use-edges probe');
		const res = await postRaw(JSON.stringify({ text: 'use-edges probe' }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { record: { use_count: number } };
		expect(body.record.use_count).toBe(2);
	});

	it('db unavailable -> 500 {error:"Failed to record prompt use"} (countPromptUse null)', async () => {
		// A DIRECTORY at the db path: sqlite open fails -> openPromptsDb null.
		mkdirSync(join(tmpRoot, 'prompts.sqlite'), { recursive: true });
		const res = await postRaw(JSON.stringify({ text: 'any non-empty text' }));
		expect(res.status).toBe(500);
		expect((await res.json()) as { error: string }).toEqual({
			error: 'Failed to record prompt use'
		});
	});
});

/**
 * The Glass Close Ladder (2026-10-24) task 1.3-T: the release executor —
 * fire-and-forget POST close per doomed glass id; an ok answer prunes the
 * slot entry LIVE (ADR D4). Network errors swallow (the reaper stays the
 * net); refusals other than ok never prune.
 */
import { describe, expect, it } from 'vitest';

import { releaseGlasses } from '$lib/services/panels/glass-release.js';

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe('releaseGlasses — the wire kill executor', () => {
	it('POSTs close once per id and prunes the slot on ok', async () => {
		const calls: string[] = [];
		const pruned: string[] = [];
		await releaseGlasses(["bs-1", "bs-2"], {
			fetchImpl: (async (url: string | URL | Request) => {
				calls.push(String(url));
				return jsonRes({ ok: true });
			}) as typeof fetch,
			prune: (id) => void pruned.push(id)
		});
		expect(calls).toEqual(["/api/browser/bs-1/close", "/api/browser/bs-2/close"]);
		expect(pruned).toEqual(["bs-1", "bs-2"]);
	});

	it('a network failure swallows and never prunes (the reaper stays the net)', async () => {
		const pruned: string[] = [];
		await releaseGlasses(["bs-err"], {
			fetchImpl: (async () => {
				throw new Error("network down");
			}) as typeof fetch,
			prune: (id) => void pruned.push(id)
		});
		expect(pruned).toEqual([]);
	});

	it('a refusal (not ok) never prunes the slot', async () => {
		const pruned: string[] = [];
		await releaseGlasses(["bs-refused"], {
			fetchImpl: (async () => jsonRes({ ok: false }, 500)) as typeof fetch,
			prune: (id) => void pruned.push(id)
		});
		expect(pruned).toEqual([]);
	});

	it('an empty release list is a quiet no-op', async () => {
		let calls = 0;
		await releaseGlasses([], { fetchImpl: (async () => { calls += 1; return jsonRes({ ok: true }); }) as typeof fetch, prune: () => undefined });
		expect(calls).toBe(0);
	});
});
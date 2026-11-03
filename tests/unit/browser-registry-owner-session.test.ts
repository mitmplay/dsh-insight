import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

// ADR-0045 amendment 3 (D7/D8) — the registry records the opener's harness
// session id; GET list() exposes it; legacy sessions report null.
const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

describe('registry ownerSessionId (glass answers by name)', () => {
	it('route contract: POST parses ownerSessionId and passes it to open()', async () => {
		const src = (await import('node:fs')).readFileSync('src/routes/api/browser/+server.ts', 'utf8');
		expect(src).toContain('ownerSessionId');
		expect(src).toContain('browserRegistry.open({ width, height, ownerSessionId })');
	});

	it('open() stores the owner and list() exposes it', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, ownerSessionId: 'session-test-owner' });
		opened.push(info.id);
		expect(info.ownerSessionId).toBe('session-test-owner');
		const listed = browserRegistry.list().find((s) => s.id === info.id);
		expect(listed?.ownerSessionId).toBe('session-test-owner');
	}, 120_000);

	it('open() without an owner reports null (legacy shape)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		expect(info.ownerSessionId).toBeNull();
	}, 120_000);
});

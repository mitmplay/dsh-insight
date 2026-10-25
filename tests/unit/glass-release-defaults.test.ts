import { describe, expect, it } from 'vitest';

import { releaseGlasses } from '$lib/services/panels/glass-release.js';

/**
 * Default-deps mop for the release executor: exercises the injectable-free
 * path (global fetch, empty apiBase, and the DEFAULT prune that goes through
 * removeBrowserSlot on localStorage) so the fallback closures count.
 */
describe('releaseGlasses — default seams (no injected deps)', () => {
	it('uses the global fetch + default localStorage prune when deps are omitted', async () => {
		localStorage.setItem('dsi.browser.panelIndex', JSON.stringify([{ index: 0, sessionId: 'bs-default' }, { index: 1, sessionId: 'bs-keep' }]));
		let hit = '';
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: RequestInfo | URL) => {
			hit = String(url);
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;
		try {
			await releaseGlasses(['bs-default']);
			expect(hit).toBe('/api/browser/bs-default/close');
			const slots = JSON.parse(localStorage.getItem('dsi.browser.panelIndex') ?? '[]') as Array<{ sessionId: string }>;
			expect(slots.map((s) => s.sessionId)).toEqual(['bs-keep']);
		} finally {
			globalThis.fetch = original;
		}
	});

	it('honors a custom apiBase prefix on the close URL', async () => {
		const urls: string[] = [];
		await releaseGlasses(['bs-x'], {
			apiBase: 'http://relay.test',
			fetchImpl: (async (url: string | URL) => {
				urls.push(String(url));
				return new Response('{}', { status: 200 });
			}) as typeof fetch,
			prune: () => undefined
		});
		expect(urls).toEqual(['http://relay.test/api/browser/bs-x/close']);
	});
});

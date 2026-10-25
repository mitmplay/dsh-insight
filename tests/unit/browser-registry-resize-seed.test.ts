/**
 * ADR-0041 D3 — seed-after-resize. A viewport POST on a SILENT page must
 * end with a FRESH painted ring: the screencast speaks only on page
 * change, so without the seed a static page keeps the old-aspect frame
 * letterboxed on the panel forever (the operator's black bands). Real
 * (headless-default) chromium, spawnMcp off — the brain is not under
 * test (the browser-registry-tabs.test.ts pattern).
 */
import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

describe('browser registry — seed after resize (ADR-0041 D3)', () => {
	it('a viewport POST on a silent static page repaints the ring (fresh frame or resize seed)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<title>still</title>static' });
		opened.push(info.id);
		// the first-frame contract guarantees a birth frame; record its seq
		const before = browserRegistry.relay(info.id).latestFrame();
		expect(before).not.toBeNull();
		// a STATIC data: page never screencasts again — the resize must not
		// rely on a natural frame arriving
		await browserRegistry.setViewport(info.id, 500, 400);
		const after = browserRegistry.relay(info.id).latestFrame();
		expect(after).not.toBeNull();
		expect(after!.jpeg.length).toBeGreaterThan(0);
		// fresh = the ring moved past the old frame, OR the deterministic
		// seed fired (metadata marks it) — either way the mirror repaints
		const fresh = after!.seq !== before!.seq || (after!.metadata as { seeded?: boolean })?.seeded === true;
		expect(fresh).toBe(true);
	}, 120_000);

	it('setViewport keeps the wire contract: still ONE active tab, session alive', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<title>t</title>x' });
		opened.push(info.id);
		await browserRegistry.setViewport(info.id, 600, 450);
		const tabs = await browserRegistry.listTabs(info.id);
		expect(tabs.filter((t2) => t2.active)).toHaveLength(1); // the seed never moves the pointer
	}, 120_000);
});

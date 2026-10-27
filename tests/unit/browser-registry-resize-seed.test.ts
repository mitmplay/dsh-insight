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
		const info = await browserRegistry.open({ spawnMcp: false, port: 9498 + opened.length * 3, url: 'data:text/html,<title>still</title>static' });
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
		const info = await browserRegistry.open({ spawnMcp: false, port: 9498 + opened.length * 3, url: 'data:text/html,<title>t</title>x' });
		opened.push(info.id);
		await browserRegistry.setViewport(info.id, 600, 450);
		const tabs = await browserRegistry.listTabs(info.id);
		expect(tabs.filter((t2) => t2.active)).toHaveLength(1); // the seed never moves the pointer
	}, 120_000);

	describe('browser registry — the surface-lag repair (BUG 2026-10-26)', () => {
		function jpegSize(b64: string): { w: number; h: number } | null {
			const b = Buffer.from(b64, 'base64');
			let i = 2;
			while (i < b.length - 9) {
				if (b[i] !== 0xff) { i += 1; continue; }
				const marker = b[i + 1];
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
				}
				const len = b.readUInt16BE(i + 2);
				i += Math.max(2, len);
			}
			return null;
		}

		it('a HEADED height-GROW resize repaints at the REQUESTED size — the compositor surface must not stay stale', async () => {
			// The off-screen window takes the new RENDERER size but macOS never
			// reallocates the compositor surface: every screencast frame (even
			// captureScreenshot) kept arriving at the OLD height — the operator's
			// top/bottom bands. The registry must detect the lag and bounce the
			// window state so the surface follows the renderer.
			const info = await browserRegistry.open({ spawnMcp: false, headless: false, port: 9489, url: 'data:text/html,<title>lag</title>body' });
			opened.push(info.id);
			await browserRegistry.setViewport(info.id, 500, 400);
			await browserRegistry.setViewport(info.id, 500, 700); // height GROW
			const f = browserRegistry.relay(info.id).latestFrame();
			expect(f).not.toBeNull();
			const dims = jpegSize(f!.jpeg);
			expect(dims).toEqual({ w: 500, h: 700 });
		}, 180_000);

		it('a HEADED birth renders at the REQUESTED size - no chrome guess (BUG 2026-10-26c)', async () => {
			// The glass was born banded: launch used --window-size = box + 6/+70
			// (a hardcoded chrome guess); the real macOS chrome costs more, so the
			// birth frame is shorter than the panel. Birth must measure and
			// chrome-compensate exactly like the resize path.
			const info = await browserRegistry.open({ spawnMcp: false, headless: false, port: 9487, width: 520, height: 640, url: 'data:text/html,<title>birth</title>x' });
			opened.push(info.id);
			const f = browserRegistry.relay(info.id).latestFrame();
			expect(f).not.toBeNull();
			const dims = jpegSize(f!.jpeg);
			expect(dims).toEqual({ w: 520, h: 640 });
		}, 180_000);
	});
});

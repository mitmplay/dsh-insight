/**
 * ADR-0041 Amendment 5 (2026-11-07) — the headed glass keeps its place.
 * The surface-repair ladder may RESIZE a headed window but must never
 * MOVE or HIDE it: no minimize/normal bounce, no on-screen flash, no
 * -32000,-32000 park. Drives the private repairSurfaceAfterResize with a
 * recording CDP mock — no real browser needed (the chassis behavior for
 * headless:false + headedOpen:false stays pinned as the mirror drive).
 */
import { describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

/** Minimal JPEG whose SOF0 dims are (w, h) — enough for dimsOf's SOF scan. */
function syntheticJpeg(w: number, h: number): string {
	const b = Buffer.alloc(23);
	b[0] = 0xff; b[1] = 0xd8; // SOI
	b[2] = 0xff; b[3] = 0xc0; // SOF0
	b.writeUInt16BE(17, 4); // segment length
	b[6] = 8; // precision
	b.writeUInt16BE(h, 7);
	b.writeUInt16BE(w, 9);
	b[11] = 3; // components
	b[20] = 0xff; b[21] = 0xd9; // EOI
	return b.toString('base64');
}

type Call = { method: string; params: Record<string, unknown> | undefined };

function makeHandle(neverMatches: { w: number; h: number }) {
	const calls: Call[] = [];
	const reseeds: unknown[] = [];
	const jpeg = syntheticJpeg(neverMatches.w, neverMatches.h);
	const cdp = {
		send: async (method: string, params?: Record<string, unknown>) => {
			calls.push({ method, params });
			if (method === 'Runtime.evaluate') return { result: { value: '{"oh":20,"ow":15}' } };
			if (method === 'Target.getWindowForTarget') return {};
			if (method === 'Browser.getWindowForTarget') return { windowId: 7, bounds: { width: 900, height: 700, left: 0, top: 0 } };
			if (method === 'Page.captureScreenshot') return { data: jpeg };
			return null;
		}
	};
	const relay = {
		latestFrame: () => null,
		reseed: (frame: unknown) => reseeds.push(frame)
	};
	return { calls, reseeds, handle: { cdp, relay, page: undefined } };
}

function entry(headedOpen: boolean): Record<string, unknown> {
	return { headedOpen, headless: false, viewport: { width: 500, height: 400 }, activeTargetId: 't1' };
}

async function run(headedOpen: boolean): Promise<Call[]> {
	const { calls, handle } = makeHandle({ w: 300, h: 200 }); // never within ±3px of want — the ladder must exhaust
	const priv = browserRegistry as unknown as { repairSurfaceAfterResize: (e: unknown, h: unknown, prevSeq: number) => Promise<void> };
	await priv.repairSurfaceAfterResize(entry(headedOpen), handle, 0);
	return calls;
}

const bounds = (calls: Call[]): Record<string, unknown>[] => calls.filter((c) => c.method === 'Browser.setWindowBounds').map((c) => c.params?.bounds as Record<string, unknown>);

describe('headed repair gate (ADR-0041 Amendment 5)', () => {
	it('HEADED: bounce and park never fire; STEP 1 resize still runs', async () => {
		const calls = await run(true);
		const b = bounds(calls);
		expect(b.length).toBeGreaterThan(0); // the ladder RAN — resize arms intact
		expect(b.some((x) => x.windowState === 'minimized')).toBe(false); // no bounce
		expect(b.some((x) => x.left === -32000 || x.top === -32000)).toBe(false); // no park
	}, 30_000);

	it('HEADED: the final reseed still fires (mirror repaint kept)', async () => {
		const { reseeds, handle } = makeHandle({ w: 300, h: 200 });
		const priv = browserRegistry as unknown as { repairSurfaceAfterResize: (e: unknown, h: unknown, prevSeq: number) => Promise<void> };
		await priv.repairSurfaceAfterResize(entry(true), handle, 0);
		expect(reseeds).toHaveLength(1); // the gate falls through to the reseed arm
	}, 30_000);

	it('CHASSIS (headedOpen false): the bounce + park ladder stays alive', async () => {
		const calls = await run(false);
		const b = bounds(calls);
		expect(b.some((x) => x.windowState === 'minimized')).toBe(true); // bounce still runs
		expect(b.some((x) => x.left === -32000 && x.top === -32000)).toBe(true); // park still runs
	}, 30_000);
});
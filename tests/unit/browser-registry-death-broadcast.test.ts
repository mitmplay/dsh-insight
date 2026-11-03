/**
 * Ghost Glass Fix 2 (RCA 2026-10-31, Bug 1's silence): glass death is a
 * server-side decision that must be ANNOUNCED. close() grows a death
 * broadcast: onDeath(id, cb) listeners fire exactly once with the reason
 * ('closed' by human click, 'reaped' from the idle reaper), late
 * subscribers to an already-dead id hear the truth immediately, and the
 * listener registry lives in the process-global state so an HMR reload
 * (which severs SSEs) cannot strand it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

const PORT = 9494;

describe('registry death broadcast (Ghost Glass Fix 2)', () => {
	it('close(id) fires onDeath listeners with the carried reason', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: PORT, headless: true });
		try {
			const cb = vi.fn();
			browserRegistry.onDeath(info.id, cb);
			await browserRegistry.close(info.id, 'reaped');
			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith('reaped');
		} finally {
			await browserRegistry.close(info.id); // idempotent D8
		}
	}, 120_000);

	it('a HUMAN close carries the default reason', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: PORT, headless: true });
		const cb = vi.fn();
		browserRegistry.onDeath(info.id, cb);
		await browserRegistry.close(info.id);
		expect(cb).toHaveBeenCalledWith('closed');
	}, 120_000);

	it('a listener on an already-dead id hears the truth immediately', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: PORT, headless: true });
		await browserRegistry.close(info.id);
		const cb = vi.fn();
		browserRegistry.onDeath(info.id, cb);
		expect(cb).toHaveBeenCalledTimes(1);
	}, 120_000);

	it('the unsubscribe handle detaches the listener', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: PORT, headless: true });
		const cb = vi.fn();
		const off = browserRegistry.onDeath(info.id, cb);
		off();
		await browserRegistry.close(info.id);
		expect(cb).not.toHaveBeenCalled();
	}, 120_000);

	it('the reaper tick announces its harvests as reaped (source pin)', () => {
		const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(src).toContain("this.close(e.id, 'reaped')");
	});

	it('a listener that throws cannot break the close path', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: PORT, headless: true });
		browserRegistry.onDeath(info.id, () => { throw new Error('listener bomb'); });
		const second = vi.fn();
		browserRegistry.onDeath(info.id, second);
		await expect(browserRegistry.close(info.id)).resolves.toMatchObject({ ok: true });
		expect(second).toHaveBeenCalledTimes(1);
	}, 120_000);
});

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

import { browserRegistry } from '$lib/server/browser/registry.js';

const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

const portHeld = (port: number): boolean =>
	spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0;

describe('browser registry (real headed chromium)', () => {
	it('launch contract: anti-bot hardening present in source (D5/D1 args)', async () => {
		const src = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(src).toContain('--enable-automation');
		expect(src).toContain('--disable-blink-features=AutomationControlled');
		expect(src).toContain("channel: 'chrome'"); // real Chrome = full codecs/Widevine for YouTube
	});
	it('creates a session with a debug port that actually listens', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9516 + opened.length * 3, });
		opened.push(info.id);
		expect(info.port).toBeGreaterThan(0);
		expect(portHeld(info.port)).toBe(true);
		expect(info.mcp).toBe('none');
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('close() kills the browser and frees the port (D8)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9516 + opened.length * 3, });
		expect(portHeld(info.port)).toBe(true);
		const r = await browserRegistry.close(info.id);
		expect(r).toEqual({ ok: true, alreadyClosed: false });
		expect(portHeld(info.port)).toBe(false);
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('double close is idempotent (D8)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9516 + opened.length * 3, });
		await browserRegistry.close(info.id);
		const second = await browserRegistry.close(info.id);
		expect(second).toEqual({ ok: true, alreadyClosed: true });
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('relay survives in process-global state across module reimports', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9516 + opened.length * 3, });
		opened.push(info.id);
		// dynamic path (not a literal) so TS does not type-resolve the query string
		const reimportUrl = '$lib/server/browser/registry.js?reimport=1';
		const mod = (await import(reimportUrl)) as unknown as {
			browserRegistry: { list(): { id: string }[] };
		};
		expect(mod.browserRegistry.list().map((s) => s.id)).toContain(info.id);
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling
});
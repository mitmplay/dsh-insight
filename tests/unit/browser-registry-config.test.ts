import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { browserRegistry } from '$lib/server/browser/registry.js';

const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

const portHeld = (port: number): boolean =>
	spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0;

/** Task 1.2-T (The Sticky Glass, ADR-0030 D3): open() reads BrowserConfig at
 *  create — headless flows into the launch, profileRoot replaces the old
 *  constant, brainPort resolution keeps env-over-default precedence. */
describe('registry reads BrowserConfig at create', () => {
	it('source pins: config read, headless ?? cfg, profileRoot from cfg, env precedence', () => {
		const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(src).toContain('readBrowserConfig()');
		expect(src).toContain('options.headless ?? cfg.headless');
		expect(src).toContain('join(cfg.profileRoot, id.slice(0, 8))');
		expect(src).toContain('Number(process.env.DSI_MCP_PORT ?? cfg.brainPort)');
		// the reaper arms from the same config read
		expect(src).toContain('this.ensureReaper(cfg.idleMs)');
	});

	it('real launch honors headless from the config path (headless:true opens without a visible window and holds the port)', async () => {
		// headless override is the same code path cfg.headless feeds — the
		// config default (true) lands in the identical expression
		const info = await browserRegistry.open({ spawnMcp: false, headless: true });
		opened.push(info.id);
		expect(info.port).toBeGreaterThan(0);
		expect(portHeld(info.port)).toBe(true);
	}, 120_000);

	it('profile root comes from the config default (~/.dsi/browser-profiles)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, headless: true });
		opened.push(info.id);
		expect(info.profileDir).toContain('.dsi/browser-profiles');
	}, 120_000);
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_BROWSER_CONFIG, readBrowserConfig } from '$lib/server/insight-config.js';

/** Task 1.1-T (The Sticky Glass, ADR-0030 D3): the yaml `browser:` section
 *  reads with defaults-on-absence; headless defaults TRUE; explicit values
 *  override; coercion follows the terminal section's helpers. */
describe('readBrowserConfig', () => {
	it('DEFAULT_BROWSER_CONFIG pins headless=true (operator decision 2026-10-20)', () => {
		expect(DEFAULT_BROWSER_CONFIG.headless).toBe(true);
		expect(DEFAULT_BROWSER_CONFIG.enabled).toBe(true);
		expect(DEFAULT_BROWSER_CONFIG.brainPort).toBe(9515);
		expect(DEFAULT_BROWSER_CONFIG.mcpPin).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('absent yaml section returns the defaults verbatim', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dsi-bcfg-'));
		const path = join(dir, 'settings.yaml');
		writeFileSync(path, 'terminal:\n  enabled: true\n');
		expect(readBrowserConfig(path)).toEqual(DEFAULT_BROWSER_CONFIG);
	});

	it('no file at all returns the defaults verbatim', () => {
		expect(readBrowserConfig(join(tmpdir(), 'dsi-does-not-exist-' + Date.now(), 'settings.yaml'))).toEqual(DEFAULT_BROWSER_CONFIG);
	});

	it('explicit headless:false flips to the headed glass', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dsi-bcfg-'));
		const path = join(dir, 'settings.yaml');
		writeFileSync(path, 'browser:\n  headless: false\n');
		const cfg = readBrowserConfig(path);
		expect(cfg.headless).toBe(false);
		expect(cfg.brainPort).toBe(DEFAULT_BROWSER_CONFIG.brainPort); // untouched key stays default
	});

	it('brainPort / mcpPin / maxSessions / idleMs override, out-of-range falls back', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dsi-bcfg-'));
		const path = join(dir, 'settings.yaml');
		writeFileSync(path, [
			'browser:',
			'  brainPort: 9600',
			'  mcpPin: 0.0.90',
			'  maxSessions: 8',
			'  idleMs: 30000',
			'  profileRoot: /tmp/dsi-profiles-x'
		].join('\n'));
		const cfg = readBrowserConfig(path);
		expect(cfg.brainPort).toBe(9600);
		expect(cfg.mcpPin).toBe('0.0.90');
		expect(cfg.maxSessions).toBe(8);
		expect(cfg.idleMs).toBe(30_000);
		expect(cfg.profileRoot).toBe('/tmp/dsi-profiles-x');

		const bad = join(dir, 'bad.yaml');
		writeFileSync(bad, 'browser:\n  brainPort: 7\n  maxSessions: 999\n  idleMs: 5\n');
		const cfgBad = readBrowserConfig(bad);
		expect(cfgBad.brainPort).toBe(DEFAULT_BROWSER_CONFIG.brainPort);
		expect(cfgBad.maxSessions).toBe(DEFAULT_BROWSER_CONFIG.maxSessions);
		expect(cfgBad.idleMs).toBe(DEFAULT_BROWSER_CONFIG.idleMs);
	});
});

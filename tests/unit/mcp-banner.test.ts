import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brainBannerLines } from '../../bin/lib/mcp-banner.mjs';

const here = dirname(fileURLToPath(import.meta.url));

describe('brainBannerLines (A6 D7d — say what the flag chose)', () => {
	it('built floor (no --dev): names the page-server blast radius and the escape hatch', () => {
		const lines = brainBannerLines(false);
		const text = lines.join('\n');
		expect(text).toContain('in-process browser brain');
		expect(text).toContain('page server');
		expect(text).toContain('Drop the --playwright-mcp flag');
	});

	it('dev floor: names the dev floor server instead', () => {
		const text = brainBannerLines(true).join('\n');
		expect(text).toContain('dev floor server');
		expect(text).not.toContain('not just the glass');
	});

	it('always mentions the gain (one less background process)', () => {
		for (const dev of [true, false]) {
			expect(brainBannerLines(dev).join('\n')).toContain('one less background process');
		}
	});
});

describe('dsi.mjs source contract (banner wiring)', () => {
	it('prints the banner when the flag is present, before the pair spawns', () => {
		const src = readFileSync(join(here, '../../bin/dsi.mjs'), 'utf8');
		expect(src).toContain("import { brainBannerLines } from './lib/mcp-banner.mjs'");
		expect(src).toContain('if (withPlaywrightMcp)');
		// banner must print BEFORE runSyncedPair in the source order
		const bannerAt = src.indexOf('brainBannerLines(bannerMode');
		const spawnAt = src.indexOf('runSyncedPair(hostArgs');
		expect(bannerAt).toBeGreaterThan(-1);
		expect(spawnAt).toBeGreaterThan(bannerAt);
	});
});

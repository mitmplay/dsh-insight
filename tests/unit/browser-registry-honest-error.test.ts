import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Task 1.3-T — raw-source pins for the honest launch error (ADR D5):
// the registry's launch site names the cure, not just the symptom.
const src = readFileSync('src/lib/server/browser/registry.ts', 'utf-8');

describe('the honest glass launch error (D5)', () => {
	it('wraps the SECOND arm — launch(false) is inside a try now', () => {
		const site = src.indexOf('context = await launch(false)');
		expect(site).toBeGreaterThan(-1);
		expect(src.slice(site - 200, site)).toContain('try {');
	});

	it('the rethrow names the chromium cure verbatim', () => {
		const site = src.indexOf('Glass browser: no browser binary');
		expect(site).toBeGreaterThan(-1);
		const msg = src.slice(site, site + 600);
		expect(msg).toContain('install chromium');
		expect(msg).toContain('playwright-core');
		expect(msg).toContain('install Google Chrome');
	});

	it('preserves BOTH original error messages in the rethrow', () => {
		const site = src.indexOf('Glass browser: no browser binary');
		const msg = src.slice(site - 300, site + 600);
		expect(msg).toContain('chromeErr');
		expect(msg).toContain('chromiumErr');
	});
});

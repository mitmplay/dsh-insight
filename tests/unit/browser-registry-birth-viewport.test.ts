import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Viewport-follows-panel revert (2026-10-28, operator screenshot): the
 *  acae5c47 fixed 1280x800 birth default LETTERBOXED portrait panels —
 *  the mirror must ALWAYS be the panel's shape (syncViewport converges the
 *  viewport ~250ms after streaming; the birth default just sets what the
 *  first frames look like). The birth default is back at 730x830. */
describe('birth viewport follows the panel box (revert)', () => {
	it('source pins: no fixed birthViewport helper, the 730x830 defaults are back', () => {
		const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(src).not.toContain('birthViewport');
		expect(src).toContain('options.width ?? 730');
		expect(src).toContain('options.height ?? 830');
	});
});

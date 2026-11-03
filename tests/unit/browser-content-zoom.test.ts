import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { DEFAULT_BROWSER_CONFIG, readBrowserConfig } from '$lib/server/insight-config.js';

/** Layout-scale zoom (ADR-0041 amendment, 2026-10-31): the config knob keeps
 *  its name and default, but its MEANING changed — contentZoom is the layout
 *  SCALE (emulated viewport = panel box / zoom), not CSS zoom. The registry
 *  must carry NO trace of the retired documentElement.style.zoom mechanism,
 *  whose split coordinate space broke YouTube's seek-preview math. */
describe('browser.contentZoom', () => {
	it('defaults to 0.8', () => {
		expect(DEFAULT_BROWSER_CONFIG.contentZoom).toBe(0.8);
	});

	it('readBrowserConfig gates the knob and falls back to the default', () => {
		expect(readBrowserConfig().contentZoom).toBe(0.8);
	});

	it('source pins: the CSS-zoom mechanism is RETIRED from the registry', () => {
		const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(src).not.toContain('document.documentElement.style.zoom');
		expect(src).not.toContain('addInitScript');
		expect(src).not.toContain('contentZoomScript');
		// the new mechanism is present
		expect(src).toContain('layoutViewport(');
	});
});

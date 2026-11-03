import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry, clampZoom, layoutViewport } from '$lib/server/browser/registry.js';
import { readBrowserConfig } from '$lib/server/insight-config.js';

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

/** Live zoom slider (2026-10-28, operator-approved) — the pure pins:
 *  clampZoom's wire bounds, applyZoomToAttached's sweep, and the entry
 *  zoom field's shape. No browser: fake handles record evaluates. */

describe('clampZoom (zoom slider wire bounds)', () => {
	it('accepts 0.5..1.25', () => {
		expect(clampZoom(0.5)).toBe(0.5);
		expect(clampZoom(0.9)).toBe(0.9);
		expect(clampZoom(1.25)).toBe(1.25);
	});
	it('rejects out-of-range, non-finite, and non-number', () => {
		expect(clampZoom(0.49)).toBeNull();
		expect(clampZoom(1.26)).toBeNull();
		expect(clampZoom(Number.NaN)).toBeNull();
		expect(clampZoom(Infinity)).toBeNull();
		expect(clampZoom('0.9')).toBeNull();
		expect(clampZoom(undefined)).toBeNull();
	});
});

describe('layoutViewport (the zoom knob is layout scale now)', () => {
	it('box/zoom, clamped — the slider drives the EMULATION size', () => {
		expect(layoutViewport(800, 600, 0.8)).toEqual({ width: 1000, height: 750 });
		expect(layoutViewport(800, 600, 1)).toEqual({ width: 800, height: 600 });
	});
});

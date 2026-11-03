/**
 * Layout-scale zoom (ADR-0041 amendment, 2026-10-31): the zoom knob stops
 * being documentElement CSS zoom — which broke YouTube's own seek-preview
 * math by exactly the zoom factor (54:58 vs 1:08:44 at zoom 0.8) — and
 * becomes LAYOUT SCALE: the emulated viewport is box/zoom, the mirror's
 * contain-fit does the visual shrinking, and page-side geometry stays in
 * ONE consistent coordinate space. CSS zoom is retired from the registry.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry, clampZoom, layoutViewport } from '$lib/server/browser/registry.js';
import { readFileSync } from 'node:fs';

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

describe('layoutViewport (pure: box/zoom, clamped)', () => {
	it('divides the panel box by the zoom', () => {
		expect(layoutViewport(773, 859, 0.8)).toEqual({ width: 966, height: 1074 });
		expect(layoutViewport(800, 600, 0.5)).toEqual({ width: 1600, height: 1200 });
	});

	it('is the identity at zoom 1 (disabled knob)', () => {
		expect(layoutViewport(773, 859, 1)).toEqual({ width: 773, height: 859 });
	});

	it('keeps the wire clamps (200/120 min, 8192 max)', () => {
		expect(layoutViewport(100, 100, 0.5)).toEqual({ width: 200, height: 200 });
		expect(layoutViewport(8000, 8000, 0.5)).toEqual({ width: 8192, height: 8192 });
	});
});

describe('CSS zoom retirement (source pins)', () => {
	const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');
	it('the registry no longer injects documentElement CSS zoom', () => {
		expect(src).not.toContain('document.documentElement.style.zoom');
		expect(src).not.toContain('DOMContentLoaded');
		expect(src).not.toContain('contentZoomScript');
		expect(src).not.toContain('applyZoomToAttached');
	});
	it('setZoom re-applies the panel viewport (the layout scale rides the resize)', () => {
		const i = src.indexOf('async setZoom');
		const block = src.slice(i, src.indexOf('\n\t}', i) + 4);
		expect(block).toContain('applyPanelViewport');
	});
	it('applyPanelViewport applies the LAYOUT viewport, not the raw box', () => {
		const i = src.indexOf('private async applyPanelViewport');
		const block = src.slice(i, src.indexOf('\n\tasync ', i + 10) + 1);
		expect(block).toContain('layoutViewport(');
	});
});

describe('setZoom live behavior (real headless session)', () => {
	it('zoom 0.8 lays the page out at box/0.8 with NO CSS zoom on the page', { timeout: 120_000 }, async () => {
		const port = 9531;
		const info = await browserRegistry.open({ spawnMcp: false, port, headless: true });
		opened.push(info.id);
		await browserRegistry.setViewport(info.id, 800, 600);
		await browserRegistry.setZoom(info.id, 0.8);
		const e = (browserRegistry as unknown as { peek(id: string): { tabs: Map<string, { page?: { evaluate: (s: string) => Promise<unknown> } }> } }).peek(info.id);
		const page = [...e.tabs.values()][0]?.page;
		expect(page).toBeTruthy();
		const inner = (await page!.evaluate('window.innerWidth')) as number;
		expect(inner).toBe(1000); // 800 / 0.8
		const zoomStyle = (await page!.evaluate('document.documentElement.style.zoom')) as string;
		expect(zoomStyle).toBe('');
	});
});

describe('clampZoom keeps the wire bounds', () => {
	it('accepts 0.5..1.25, rejects the rest', () => {
		expect(clampZoom(0.8)).toBe(0.8);
		expect(clampZoom(1.26)).toBeNull();
	});
});

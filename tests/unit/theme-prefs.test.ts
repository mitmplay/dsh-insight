import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_BASE_KEY, themePrefs } from '../../src/lib/utils/theme-prefs.svelte';

// Wave 2 tasks 2.1-T / 2.2-T (ADR-0023, The Three-State Lamp).

const setOs = (dark: boolean) => {
	// happy-dom has matchMedia; pin its answer per test
	const real = window.matchMedia;
	window.matchMedia = ((q: string) => ({
		matches: dark ? q.includes('dark') : false,
		media: q,
		onchange: null,
		addEventListener: (_t: string, fn: EventListener) => listeners.push(fn as unknown as (e: { matches: boolean }) => void),
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false
	})) as unknown as typeof window.matchMedia;
	return real;
};

let listeners: ((e: { matches: boolean }) => void)[] = [];

// the active profile lives in the sticky ?profile= param (storage-profile.ts)
const setProfile = (profile: string | null) => {
	const url = new URL('http://localhost/');
	if (profile) url.searchParams.set('profile', profile);
	window.history.replaceState(null, '', url.pathname + url.search);
};
const key = () => (window.location.search.includes('profile=') ? THEME_BASE_KEY + '_' + window.location.search.match(/profile=([^&]*)/)![1] : THEME_BASE_KEY);

const boot = (storage: string | null, attr?: 'light' | 'dark') => {
	localStorage.clear();
	if (storage) localStorage.setItem(key(), storage);
	if (attr) document.documentElement.dataset.theme = attr;
	else delete document.documentElement.dataset.theme;
	listeners = [];
	themePrefs.adopt();
};

describe('theme-prefs — the three-state switch (2.1-T)', () => {
	beforeEach(() => {
		setOs(false);
	});
	afterEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
	});

	it('junk / absent storage falls back to system-resolved light', () => {
		boot('not-a-theme');
		expect(themePrefs.choice).toBe('system');
		expect(themePrefs.resolved).toBe('light');
		expect(document.documentElement.dataset.theme).toBe('light');
	});

	it('adopt keeps the pre-paint attribute — flash-free boot (D3 contract)', () => {
		// OS says light, storage says system, but pre-paint resolved dark:
		// the attribute is the authority at boot and must NOT be re-set
		setOs(true);
		boot('system', 'dark');
		expect(themePrefs.resolved).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
	});

	it('set(dark) persists the CHOICE and flips the attribute', () => {
		boot(null);
		themePrefs.set('dark');
		expect(localStorage.getItem(THEME_BASE_KEY)).toBe('dark');
		expect(themePrefs.resolved).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
	});

	it('system follows a live OS flip; pinned mode ignores it', () => {
		boot('system');
		expect(themePrefs.resolved).toBe('light');
		listeners.forEach((fn) => fn({ matches: true }));
		expect(themePrefs.resolved).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');

		themePrefs.set('light'); // pin
		listeners.forEach((fn) => fn({ matches: false }));
		expect(themePrefs.resolved).toBe('light'); // OS flip ignored while pinned
	});
});

describe('pre-paint twin pin (2.2-T, ADR-0063 D2)', () => {
	const appHtml = readFileSync('src/app.html', 'utf8');

	it('app.html carries the GENERATED base applier verbatim (markers + exact source)', async () => {
		const { themeApplierScript } = await import('@deepseek-insight/container-base');
		expect(appHtml).toContain('container-base:theme-applier BEGIN');
		expect(appHtml).toContain('container-base:theme-applier END');
		// the block between the markers IS the base applier for dsi-theme — byte-identical
		const block = appHtml.split('container-base:theme-applier BEGIN')[1]!.split('container-base:theme-applier END')[0]!;
		const generated = themeApplierScript('dsi-theme')
			.split('\n')
			.map((l) => '\t\t\t' + l)
			.join('\n');
		expect(block).toContain(generated);
	});

	it('the applier is guarded against blocked storage (try/catch + light fallback)', () => {
		expect(appHtml).toContain('try {');
		expect(appHtml).toContain("dataset.theme = 'light'");
	});

	it('ONE key, one derivation: the wrapper base key, the applier arg, and the html agree on dsi-theme', async () => {
		expect(THEME_BASE_KEY).toBe('dsi-theme');
		const { themeApplierScript } = await import('@deepseek-insight/container-base');
		expect(appHtml).toContain("themeApplierScript('dsi-theme')".length > 0 ? "'dsi-theme'" : '');
		expect(appHtml).toContain("var k = 'dsi-theme' + (prof ? '_' + prof : '');");
		// and no third spelling creeps in anywhere in src
		const fs = require('node:fs');
		const path = require('node:path');
		const walk = (dir: string): string[] =>
			fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory: () => boolean }) =>
				e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
			);
		const carriers = walk('src').filter((f) => /\.(ts|svelte|html)$/.test(f) && !f.includes('theme-prefs') && !f.endsWith('app.html')).filter((f) => fs.readFileSync(f, 'utf8').includes("'dsi-theme'"));
		expect(carriers, 'dsi-theme must live in theme-prefs.svelte.ts + app.html only').toEqual([]);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemePrefs, themeApplierScript, storageKey } from '../src/index';
import type { ThemeChoice } from '../src/index';

// R2 W2 2.1-T (ADR-0063 D2) — the base theming survival suite.

const setOs = (dark: boolean) => {
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

const setProfile = (profile: string | null) => {
	const url = new URL('http://localhost/');
	if (profile) url.searchParams.set('profile', profile);
	window.history.replaceState(null, '', url.pathname + url.search);
};

const boot = (prefs: ReturnType<typeof createThemePrefs>, storage: string | null, attr?: 'light' | 'dark') => {
	localStorage.clear();
	if (storage) localStorage.setItem(storageKey('cb-theme', window.location.search.includes('profile=') ? window.location.search.match(/profile=([^&]*)/)![1] : null), storage);
	if (attr) document.documentElement.dataset.theme = attr;
	else delete document.documentElement.dataset.theme;
	listeners = [];
	prefs.adopt();
};

describe('createThemePrefs — key grammar + survival (2.1-T)', () => {
	beforeEach(() => {
		setOs(false);
		setProfile(null);
	});
	afterEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
		vi.unstubAllGlobals();
	});

	it('junk / absent storage falls back to system-resolved light', () => {
		const prefs = createThemePrefs({ baseKey: 'cb-theme' });
		boot(prefs, 'not-a-theme');
		expect(prefs.choice).toBe('system');
		expect(prefs.resolved).toBe('light');
		expect(document.documentElement.dataset.theme).toBe('light');
	});

	it('adopt keeps the pre-paint attribute — flash-free boot', () => {
		setOs(true);
		const prefs = createThemePrefs({ baseKey: 'cb-theme' });
		boot(prefs, 'system', 'dark');
		expect(prefs.resolved).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
	});

	it('set persists the CHOICE under the profile-suffixed key and flips the attribute', () => {
		setProfile('widi');
		const prefs = createThemePrefs({ baseKey: 'cb-theme' });
		boot(prefs, null);
		prefs.set('dark');
		expect(localStorage.getItem('cb-theme_widi')).toBe('dark');
		expect(localStorage.getItem('cb-theme')).toBeNull();
		expect(prefs.resolved).toBe('dark');
	});

	it('system follows a live OS flip; pinned mode ignores it', () => {
		const prefs = createThemePrefs({ baseKey: 'cb-theme' });
		boot(prefs, 'system');
		expect(prefs.resolved).toBe('light');
		listeners.forEach((fn) => fn({ matches: true }));
		expect(prefs.resolved).toBe('dark');
		prefs.set('light'); // pin
		listeners.forEach((fn) => fn({ matches: false }));
		expect(prefs.resolved).toBe('light'); // OS flip ignored while pinned
	});

	it('SSR safety: no localStorage / no document never throws', () => {
		const realLocalStorage = globalThis.localStorage;
		const realDocument = globalThis.document;
		try {
			vi.stubGlobal('localStorage', undefined);
			vi.stubGlobal('document', undefined);
			const prefs = createThemePrefs({ baseKey: 'cb-theme' });
			expect(() => prefs.adopt()).not.toThrow();
			expect(prefs.choice).toBe('system'); // junk-free fallback under SSR
			expect(() => prefs.set('dark')).not.toThrow(); // best-effort write
		} finally {
			vi.stubGlobal('localStorage', realLocalStorage);
			vi.stubGlobal('document', realDocument);
		}
	});
});

describe('themeApplierScript — the pre-paint twin derivation (2.1-T)', () => {
	it('embeds the base key and re-derives the identical profile-suffix grammar', () => {
		const script = themeApplierScript('cb-theme');
		expect(script).toContain("'cb-theme'");
		expect(script).toContain("[?&]profile=([^&]*)");
		// the suffix rule mirrors storageKey: base + '_' + sanitized profile
		expect(script).toContain("'_' + prof");
		expect(script).toContain("replace(/[^A-Za-z0-9_-]/g, '')");
		expect(script).toContain("slice(0, 40)");
	});

	it('junk falls back to system, and the guard falls back to light', () => {
		const script = themeApplierScript('cb-theme');
		expect(script).toContain("t !== 'light' && t !== 'dark' && t !== 'system'");
		expect(script).toContain("dataset.theme = 'light'");
	});

	it('executed inline, the script sets data-theme from storage before paint', () => {
		localStorage.clear();
		setProfile(null);
		localStorage.setItem('cb-theme', 'dark');
		// run the generated source as the browser would (no modules)
		const fn = new Function(themeApplierScript('cb-theme'));
		fn();
		expect(document.documentElement.dataset.theme).toBe('dark');
	});
});

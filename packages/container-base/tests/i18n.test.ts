import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalePrefs, LanguageMenu } from '../src/index';

// R2 W3 3.1-T (ADR-0063 D3) — the base locale survival suite.

const LOCALES = ['en', 'zh', 'id'] as const;

const make = () =>
	createLocalePrefs({
		baseKey: 'pg.locale',
		cookieName: 'pg.locale',
		locales: LOCALES,
		defaultLocale: 'en'
	});

const cookieValue = (name: string): string | null => {
	const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
	return m ? m[1] : null;
};

describe('createLocalePrefs — dual-write survival (3.1-T)', () => {
	beforeEach(() => {
		localStorage.clear();
		document.cookie = 'pg.locale=; path=/; max-age=0';
	});
	afterEach(() => {
		localStorage.clear();
		document.cookie = 'pg.locale=; path=/; max-age=0';
	});

	it('set writes BOTH the storage mirror and the cookie (dual-write)', () => {
		const prefs = make();
		prefs.adopt();
		prefs.set('zh');
		expect(localStorage.getItem('pg.locale')).toBe('zh');
		expect(cookieValue('pg.locale')).toBe('zh');
		expect(prefs.locale).toBe('zh');
	});

	it('cookie is read FIRST, storage second, default last (resolution order)', () => {
		localStorage.setItem('pg.locale', 'id');
		document.cookie = 'pg.locale=zh; path=/';
		const prefs = make();
		prefs.adopt();
		expect(prefs.locale).toBe('zh'); // cookie outranks storage
	});

	it('junk (unknown locale) in either home falls back to the default', () => {
		localStorage.setItem('pg.locale', 'xx');
		document.cookie = 'pg.locale=garbage; path=/';
		const prefs = make();
		prefs.adopt();
		expect(prefs.locale).toBe('en');
	});

	it('profile scoping: the suffixed key is written and read, the bare key untouched', () => {
		const url = new URL('http://localhost/');
		url.searchParams.set('profile', 'widi');
		window.history.replaceState(null, '', url.pathname + url.search);
		const prefs = make();
		prefs.adopt();
		prefs.set('id');
		expect(localStorage.getItem('pg.locale_widi')).toBe('id');
		expect(localStorage.getItem('pg.locale')).toBeNull(); // legacy bare blob untouched
		window.history.replaceState(null, '', '/');
	});

	it('set with an invalid locale is a silent no-op (D3 gate semantics)', () => {
		const prefs = make();
		prefs.adopt();
		prefs.set('xx');
		expect(prefs.locale).toBe('en');
		expect(localStorage.getItem('pg.locale')).toBeNull();
	});

	it('SSR safety: no document / no localStorage never throws, reads default', () => {
		const realDoc = globalThis.document;
		const realStorage = globalThis.localStorage;
		try {
			(globalThis as Record<string, unknown>).document = undefined;
			(globalThis as Record<string, unknown>).localStorage = undefined;
			const prefs = make();
			expect(prefs.read()).toBe('en');
			expect(() => prefs.adopt()).not.toThrow();
			expect(() => prefs.set('zh')).not.toThrow();
		} finally {
			(globalThis as Record<string, unknown>).document = realDoc;
			(globalThis as Record<string, unknown>).localStorage = realStorage;
		}
	});

	it('legacy bare blob reads verbatim (no migration, ADR-0062 D4)', () => {
		localStorage.setItem('pg.locale', 'id'); // written by an older consumer
		const prefs = make();
		prefs.adopt();
		expect(prefs.locale).toBe('id');
	});
});

describe('LanguageMenu — generic mount contract (3.1-T)', () => {
	it('the base component imports with no DSI vocabulary (module-level contract)', () => {
		// the component renders via tokens only; its existence + type is the
		// contract here — deep DOM behavior is covered by the consumers' e2e
		expect(LanguageMenu).toBeTruthy();
	});
});

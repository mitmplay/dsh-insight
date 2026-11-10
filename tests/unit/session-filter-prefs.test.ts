/**
 * Unit: session-filter-prefs — the persisted filter state (workspace +
 * preset pills + conversation-count toggle), 2026-08-23.
 *
 * Behavior under test: defaults on absent storage, full round-trip,
 * per-field junk fallback, the legacy dsi-blank-mode read-only fallback,
 * SSR safety, and best-effort writes. happy-dom provides localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_FILTER } from '$lib/utils/session-filters';
import { loadSessionFilter, saveSessionFilter } from '$lib/utils/session-filter-prefs';

describe('session-filter-prefs', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns defaults when nothing is stored', () => {
		expect(loadSessionFilter()).toEqual({ ...DEFAULT_SESSION_FILTER });
	});

	it('round-trips the full state', () => {
		saveSessionFilter({ workspace: '/tmp', preset: 'app-dev', blankMode: 'empty' });
		expect(loadSessionFilter()).toEqual({ workspace: '/tmp', preset: 'app-dev', blankMode: 'empty' });
	});

	it("round-trips the 'workspace' toggle mode (quad-state, 2026-08-26)", () => {
		saveSessionFilter({ workspace: null, preset: null, blankMode: 'workspace' });
		expect(loadSessionFilter()).toEqual({ workspace: null, preset: null, blankMode: 'workspace' });
	});

	it('round-trips null dimensions (All)', () => {
		saveSessionFilter({ workspace: null, preset: null, blankMode: 'any' });
		expect(loadSessionFilter()).toEqual({ workspace: null, preset: null, blankMode: 'any' });
	});

	it('falls back to defaults on junk JSON', () => {
		localStorage.setItem('dsi-session-filter', '{not json');
		expect(loadSessionFilter()).toEqual({ ...DEFAULT_SESSION_FILTER });
	});

	it('falls back to defaults on non-object JSON', () => {
		localStorage.setItem('dsi-session-filter', JSON.stringify(true));
		expect(loadSessionFilter()).toEqual({ ...DEFAULT_SESSION_FILTER });
	});

	it('falls back PER FIELD on wrong-shaped values', () => {
		localStorage.setItem(
			'dsi-session-filter',
			JSON.stringify({ workspace: 42, preset: '', blankMode: 'empty' })
		);
		expect(loadSessionFilter()).toEqual({ workspace: null, preset: null, blankMode: 'empty' });
	});

	it('honors the legacy dsi-blank-mode key when the new key is absent', () => {
		localStorage.setItem('dsi-blank-mode', JSON.stringify('empty'));
		expect(loadSessionFilter()).toEqual({ ...DEFAULT_SESSION_FILTER, blankMode: 'empty' });
	});

	it('honors the legacy key for an invalid blankMode in the new key', () => {
		localStorage.setItem('dsi-blank-mode', JSON.stringify('empty'));
		localStorage.setItem(
			'dsi-session-filter',
			JSON.stringify({ workspace: '/tmp', preset: null, blankMode: 'everything' })
		);
		expect(loadSessionFilter()).toEqual({ workspace: '/tmp', preset: null, blankMode: 'empty' });
	});

	it('new key wins over legacy when it carries a valid blankMode', () => {
		localStorage.setItem('dsi-blank-mode', JSON.stringify('empty'));
		saveSessionFilter({ workspace: null, preset: null, blankMode: 'nonempty' });
		expect(loadSessionFilter().blankMode).toBe('nonempty');
	});

	it('save never writes the legacy key', () => {
		saveSessionFilter({ workspace: '/tmp', preset: 'main', blankMode: 'any' });
		expect(localStorage.getItem('dsi-blank-mode')).toBeNull();
		expect(localStorage.getItem('dsi-session-filter')).toBeTruthy();
	});

	it('save is best-effort — a throwing store does not propagate', () => {
		const setter = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('store full');
		};
		try {
			expect(() => saveSessionFilter({ workspace: null, preset: null, blankMode: 'any' })).not.toThrow();
		} finally {
			localStorage.setItem = setter;
		}
	});
});

describe('session-filter-prefs — workspace profiles (dsi-session-filter_<profile>)', () => {
	it('save/load under a profile touch ONLY the profile key — desks isolated', () => {
		localStorage.clear();
		saveSessionFilter({ workspace: '/w', preset: 'research', blankMode: 'any' }, 'widi');
		expect(localStorage.getItem('dsi-session-filter_widi')).toContain('research');
		expect(localStorage.getItem('dsi-session-filter')).toBeNull();

		saveSessionFilter({ workspace: null, preset: 'main', blankMode: 'nonempty' });
		expect(loadSessionFilter('widi').preset).toBe('research');
		expect(loadSessionFilter().preset).toBe('main');
	});

	it('the legacy dsi-blank-mode fallback stays GLOBAL (predates profiles)', () => {
		localStorage.clear();
		localStorage.setItem('dsi-blank-mode', JSON.stringify('nonempty'));
		// No profile-desk blob → blankMode falls back to the legacy key too.
		expect(loadSessionFilter('widi').blankMode).toBe('nonempty');
	});
});

describe('session-filter-prefs — SSR and parse-catch arms', () => {
	/** Temporarily hide the storage global so the typeof guards take the
	 *  SSR arm (happy-dom always defines localStorage otherwise). */
	function withoutStorage<T>(run: () => T): T {
		const g = globalThis as { localStorage?: unknown };
		const real = g.localStorage;
		g.localStorage = undefined;
		try {
			return run();
		} finally {
			g.localStorage = real;
		}
	}

	it('load without localStorage returns the defaults (SSR early return)', () => {
		withoutStorage(() => {
			expect(loadSessionFilter()).toEqual({ ...DEFAULT_SESSION_FILTER });
			expect(loadSessionFilter('widi')).toEqual({ ...DEFAULT_SESSION_FILTER });
		});
	});

	it('save without localStorage is a silent no-op (SSR early return)', () => {
		withoutStorage(() => {
			expect(() => saveSessionFilter({ workspace: '/w', preset: null, blankMode: 'any' })).not.toThrow();
		});
		// Nothing landed once storage is back.
		expect(localStorage.getItem('dsi-session-filter')).toBeNull();
	});

	it('legacyBlankMode catches a junk legacy key and falls back to the default', () => {
		localStorage.clear();
		localStorage.setItem('dsi-blank-mode', '{not json');
		// The new key carries an INVALID blankMode, so blankMode consults
		// the legacy key — whose parse throws and lands on the default.
		localStorage.setItem(
			'dsi-session-filter',
			JSON.stringify({ workspace: '/w', preset: null, blankMode: 'everything' })
		);
		expect(loadSessionFilter()).toEqual({ ...DEFAULT_SESSION_FILTER, workspace: '/w' });
	});
});

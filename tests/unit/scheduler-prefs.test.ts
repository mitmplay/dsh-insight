/**
 * Unit: scheduler-prefs (ADR-0058 D2/D3, W2 task 2.2-T; Filter Cluster
 * ADR D5 task 1.1-T) — the Scheduler Shelf's persisted blob. Behavior
 * under test: defaults with empty storage AND with localStorage
 * undefined (SSR — the web-storage stub is removed for that case, then
 * restored), strict round-trips of all four fields, junk payloads
 * (string, null, {collapsed:'yes'}, a junk viewMode, a throwing
 * JSON.parse) fall back per field without throwing, and the profile
 * suffix key grammar (dsi-scheduler_widi). happy-dom provides
 * localStorage via the web-storage stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SCHEDULER_PREFS_KEY,
	defaultSchedulerPrefs,
	loadSchedulerPrefs,
	schedulerPrefsKey,
	saveSchedulerPrefs,
	type SchedulerShelfPrefs
} from '$lib/utils/scheduler-prefs';

describe('scheduler-prefs', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('defaults with empty storage (ADR-0058 D2/D3 + D5)', () => {
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true, nameFilter: '', dateFilter: '', viewMode: 'all' });
		expect(defaultSchedulerPrefs()).toEqual({ collapsed: true, nameFilter: '', dateFilter: '', viewMode: 'all' });
		expect(localStorage.getItem(SCHEDULER_PREFS_KEY)).toBeNull();
	});

	it('defaults when localStorage is undefined (SSR), then restores', () => {
		const real = globalThis.localStorage;
		// The web-storage stub installs a configurable accessor — shadow it
		// with undefined to simulate the server, restore in finally.
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			writable: true,
			configurable: true
		});
		try {
			expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());
			expect(() => saveSchedulerPrefs({ ...defaultSchedulerPrefs(), collapsed: false })).not.toThrow();
		} finally {
			Object.defineProperty(globalThis, 'localStorage', {
				value: real,
				writable: true,
				configurable: true
			});
		}
		expect(typeof globalThis.localStorage).toBe('object');
	});

	it('all four fields survive the round-trip (Filter Cluster D5)', () => {
		const prefs: SchedulerShelfPrefs = { collapsed: false, nameFilter: 'report', dateFilter: '2026-11-11', viewMode: 'delivered' };
		saveSchedulerPrefs(prefs);
		expect(loadSchedulerPrefs()).toEqual(prefs);
	});

	it('a legacy fold-only blob reads defaults for the new fields (strict-read migration)', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":false}');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: false, nameFilter: '', dateFilter: '', viewMode: 'all' });
	});

	it('junk viewMode falls back to all; only scheduled/delivered pass exactly', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":true,"nameFilter":"","dateFilter":"","viewMode":"junk"}');
		expect(loadSchedulerPrefs().viewMode).toBe('all');
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":true,"nameFilter":"","dateFilter":"","viewMode":"All"}');
		expect(loadSchedulerPrefs().viewMode).toBe('all');
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":true,"nameFilter":"","dateFilter":"","viewMode":"scheduled"}');
		expect(loadSchedulerPrefs().viewMode).toBe('scheduled');
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":true,"nameFilter":"","dateFilter":"","viewMode":"delivered"}');
		expect(loadSchedulerPrefs().viewMode).toBe('delivered');
	});

	it('junk nameFilter/dateFilter fall back to empty strings', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":true,"nameFilter":7,"dateFilter":null,"viewMode":"all"}');
		const prefs = loadSchedulerPrefs();
		expect(prefs.nameFilter).toBe('');
		expect(prefs.dateFilter).toBe('');
	});

	it('junk payloads fall back to defaults without throwing', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, 'a plain string');
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());

		localStorage.setItem(SCHEDULER_PREFS_KEY, 'null');
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());

		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":"yes"}');
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());

		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":1}');
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());

		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"other":true}');
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());
	});

	it('a throwing JSON.parse path falls back to defaults without throwing', () => {
		const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
			throw new Error('storage exploded');
		});
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());
		expect(() => saveSchedulerPrefs({ ...defaultSchedulerPrefs(), collapsed: false })).not.toThrow();
		spy.mockRestore();
	});

	it('profile suffix key: dsi-scheduler_widi for profile widi', () => {
		expect(schedulerPrefsKey()).toBe('dsi-scheduler');
		expect(schedulerPrefsKey(null)).toBe('dsi-scheduler');
		expect(schedulerPrefsKey('widi')).toBe('dsi-scheduler_widi');
	});

	it('profiles keep separate blobs', () => {
		saveSchedulerPrefs({ ...defaultSchedulerPrefs(), collapsed: false, nameFilter: 'x' }, 'widi');
		expect(loadSchedulerPrefs('widi')).toEqual({ collapsed: false, nameFilter: 'x', dateFilter: '', viewMode: 'all' });
		expect(loadSchedulerPrefs()).toEqual(defaultSchedulerPrefs());
		expect(localStorage.getItem('dsi-scheduler')).toBeNull();
	});
});

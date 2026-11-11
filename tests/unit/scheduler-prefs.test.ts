/**
 * Unit: scheduler-prefs (ADR-0058 D2/D3, W2 task 2.2-T) — the Scheduler
 * Shelf's persisted fold. Behavior under test: collapsed by default with
 * empty storage AND with localStorage undefined (SSR — the web-storage
 * stub is removed for that case, then restored), strict-boolean
 * round-trip, junk payloads (string, null, {collapsed:'yes'}, a throwing
 * JSON.parse) fall back to collapsed without throwing, and the profile
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

	it('defaults collapsed with empty storage (ADR-0058 D2/D3)', () => {
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });
		expect(defaultSchedulerPrefs()).toEqual({ collapsed: true });
		expect(localStorage.getItem(SCHEDULER_PREFS_KEY)).toBeNull();
	});

	it('defaults collapsed when localStorage is undefined (SSR), then restores', () => {
		const real = globalThis.localStorage;
		// The web-storage stub installs a configurable accessor — shadow it
		// with undefined to simulate the server, restore in finally.
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			writable: true,
			configurable: true
		});
		try {
			expect(loadSchedulerPrefs()).toEqual({ collapsed: true });
			expect(() => saveSchedulerPrefs({ collapsed: false })).not.toThrow();
		} finally {
			Object.defineProperty(globalThis, 'localStorage', {
				value: real,
				writable: true,
				configurable: true
			});
		}
		expect(typeof globalThis.localStorage).toBe('object');
	});

	it('stored true survives the round-trip (expanded persisted)', () => {
		const prefs: SchedulerShelfPrefs = { collapsed: false };
		saveSchedulerPrefs(prefs);
		expect(localStorage.getItem(SCHEDULER_PREFS_KEY)).toBe('{"collapsed":false}');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: false });
	});

	it('stored false survives the round-trip (collapsed persisted)', () => {
		saveSchedulerPrefs({ collapsed: true });
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });
	});

	it('junk payloads fall back to collapsed without throwing', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, 'a plain string');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });

		localStorage.setItem(SCHEDULER_PREFS_KEY, 'null');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });

		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":"yes"}');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });

		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":1}');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });

		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"other":true}');
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });
	});

	it('a throwing JSON.parse path falls back to collapsed without throwing', () => {
		const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
			throw new Error('storage exploded');
		});
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });
		expect(() => saveSchedulerPrefs({ collapsed: false })).not.toThrow();
		spy.mockRestore();
	});

	it('profile suffix key: dsi-scheduler_widi for profile widi', () => {
		expect(schedulerPrefsKey()).toBe('dsi-scheduler');
		expect(schedulerPrefsKey(null)).toBe('dsi-scheduler');
		expect(schedulerPrefsKey('widi')).toBe('dsi-scheduler_widi');
	});

	it('profiles keep separate folds', () => {
		saveSchedulerPrefs({ collapsed: false }, 'widi');
		expect(loadSchedulerPrefs('widi')).toEqual({ collapsed: false });
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true });
		expect(localStorage.getItem('dsi-scheduler')).toBeNull();
	});
});

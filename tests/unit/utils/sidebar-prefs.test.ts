import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	defaultSidebarPrefs,
	loadSidebarPrefs,
	saveSidebarPrefs,
	clampSidebarWidth
} from '$lib/utils/sidebar-prefs';

const KEY = 'dsi-sidebar';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('sidebar-prefs on the createPrefsStore primitive (W2 2.4-T)', () => {
	it('round-trip equality: blob shape byte-stable, no envelope', () => {
		const prefs = { collapsed: true, width: 333 };
		saveSidebarPrefs(prefs);
		expect(localStorage.getItem(KEY)).toBe(JSON.stringify(prefs));
		expect(loadSidebarPrefs()).toEqual(prefs);
	});

	it('profile keys unchanged (dsiKey string stability)', () => {
		saveSidebarPrefs(defaultSidebarPrefs(), 'widi');
		expect(localStorage.getItem('dsi-sidebar_widi')).not.toBe(null);
		expect(localStorage.getItem(KEY)).toBe(null);
	});

	it('SSR defaults + save no-op', () => {
		vi.stubGlobal('localStorage', undefined);
		const d = defaultSidebarPrefs();
		expect(loadSidebarPrefs()).toEqual(d);
		expect(() => saveSidebarPrefs(d)).not.toThrow();
	});

	it('junk → defaults; width clamps after revive; only true collapses', () => {
		localStorage.setItem(KEY, 'not json {');
		expect(loadSidebarPrefs()).toEqual(defaultSidebarPrefs());
		localStorage.setItem(KEY, '{"collapsed":1,"width":99999}');
		const loaded = loadSidebarPrefs();
		expect(loaded.collapsed).toBe(false);
		expect(loaded.width).toBe(clampSidebarWidth(99999));
	});

	it('write failure swallowed', () => {
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full'); } });
		expect(() => saveSidebarPrefs(defaultSidebarPrefs())).not.toThrow();
	});
});

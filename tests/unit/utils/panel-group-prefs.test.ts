import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	defaultPanelGroupPrefs,
	loadPanelGroupPrefs,
	savePanelGroupPrefs
} from '$lib/utils/panel-group-prefs';

const KEY = 'dsi-panel-group';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('panel-group-prefs on the createPrefsStore primitive (W2 2.3-T)', () => {
	it('round-trip equality: blob shape byte-stable, no envelope', () => {
		const prefs = { collapsed: true, unfoldedSessionIds: ['s1', 's2'], subagentsHidden: true };
		savePanelGroupPrefs(prefs);
		expect(localStorage.getItem(KEY)).toBe(JSON.stringify(prefs));
		expect(loadPanelGroupPrefs()).toEqual(prefs);
	});

	it('profile keys unchanged (dsiKey string stability)', () => {
		savePanelGroupPrefs(defaultPanelGroupPrefs(), 'widi');
		expect(localStorage.getItem('dsi-panel-group_widi')).not.toBe(null);
		expect(localStorage.getItem(KEY)).toBe(null);
	});

	it('SSR defaults + save no-op', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(loadPanelGroupPrefs()).toEqual(defaultPanelGroupPrefs());
		expect(() => savePanelGroupPrefs(defaultPanelGroupPrefs())).not.toThrow();
	});

	it('junk blob → defaults; per-field junk rules preserved (only true collapses)', () => {
		localStorage.setItem(KEY, '"just a string"');
		expect(loadPanelGroupPrefs()).toEqual(defaultPanelGroupPrefs());
		localStorage.setItem(KEY, '{"collapsed":"yes","unfoldedSessionIds":[1,"", "s","s"],"subagentsHidden":false}');
		const loaded = loadPanelGroupPrefs();
		expect(loaded.collapsed).toBe(false);
		expect(loaded.unfoldedSessionIds).toEqual(['s']);
	});

	it('write failure swallowed', () => {
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full'); } });
		expect(() => savePanelGroupPrefs(defaultPanelGroupPrefs())).not.toThrow();
	});
});

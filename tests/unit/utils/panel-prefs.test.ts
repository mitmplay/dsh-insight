import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	loadPanelPrefs,
	savePanelPrefs,
	panelPrefsKey,
	PANEL_PREFS_KEY,
	PANEL_DEFAULT_ZOOM,
	clampPanelZoom
} from '$lib/utils/panel-prefs';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('panel-prefs on the createPrefsStore primitive (W2 2.2-T)', () => {
	it('round-trip equality: the stored blob shape is byte-stable (D4 — no envelope)', () => {
		const prefs = loadPanelPrefs();
		savePanelPrefs(prefs);
		expect(localStorage.getItem(PANEL_PREFS_KEY)).toBe(JSON.stringify(prefs));
		expect(loadPanelPrefs()).toEqual(prefs);
	});

	it('profile keys unchanged: panelPrefsKey suffixes exactly like the pre-migration dsiKey', () => {
		expect(panelPrefsKey()).toBe('dsi-panels');
		expect(panelPrefsKey(null)).toBe('dsi-panels');
		expect(panelPrefsKey('widi')).toBe('dsi-panels_widi');
	});

	it('SSR defaults: no localStorage → defaults, save is a no-op', () => {
		vi.stubGlobal('localStorage', undefined);
		const prefs = loadPanelPrefs();
		expect(prefs.panels).toEqual([]);
		expect(prefs.selectedPanelId).toBe(null);
		expect(() => savePanelPrefs(prefs, 'widi')).not.toThrow();
	});

	it('junk blob → defaults (never throws)', () => {
		localStorage.setItem(PANEL_PREFS_KEY, '{"panels": "not-an-array", "zoom": 9}');
		expect(loadPanelPrefs()).toEqual(loadPanelPrefs()); // self-consistent defaults
		expect(loadPanelPrefs().zoom).toBe(PANEL_DEFAULT_ZOOM);
		localStorage.setItem(PANEL_PREFS_KEY, '{truncated');
		expect(loadPanelPrefs().panels).toEqual([]);
	});

	it('zoom clamps on load (clamp applied after revive)', () => {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ panels: [], selectedPanelId: null, panelWidth: 730, zoom: 99 }));
		expect(loadPanelPrefs().zoom).toBe(clampPanelZoom(99));
	});

	it('write failure swallowed', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => { throw new Error('QuotaExceededError'); }
		});
		expect(() => savePanelPrefs(loadPanelPrefs())).not.toThrow();
	});
});

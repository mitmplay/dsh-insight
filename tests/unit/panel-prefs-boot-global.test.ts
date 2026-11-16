/**
 * Unit: panel-prefs boot-global read order (ADR-0067 D3, Tasks 1.2-T).
 * Pins the branch arms of loadPanelPrefs's new pre-paint hand-off. The
 * boot source is the GENERATED container-base script (storage/boot-script.ts):
 * window.__BOOT_PREFS['dsi-panels'] = { profile, raw } — a keyed register.
 *   - register entry present → its raw string WINS even when localStorage differs;
 *   - consume-once — the entry is cleared after the first read;
 *   - entry absent → the existing localStorage read, byte-identical;
 *   - SSR (no window) → defaults, no boot consumption possible;
 *   - junk raw (unparseable / non-array panels) → localStorage fallback with
 *     the same junk defense (defaults), never a throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_PREFS_KEY, defaultPanelPrefs, loadPanelPrefs, type PanelPrefs } from '$lib/utils/panel-prefs';

type BootReg = { __BOOT_PREFS?: Record<string, { profile?: string; raw?: unknown } | undefined> };
const win = () => window as unknown as BootReg & typeof globalThis;
const setBoot = (raw: unknown) => {
	win().__BOOT_PREFS = { [PANEL_PREFS_KEY]: { profile: '', raw } };
};

const SAVED: PanelPrefs = {
	panels: [{ id: 'panel-1', kind: 'conversation', sessionId: 'sess-1', agentPreset: null, width: 700 }],
	selectedPanelId: 'panel-1',
	panelWidth: 555,
	zoom: 1,
	explorerHidden: false,
	termFontSize: 12
};

beforeEach(() => {
	localStorage.clear();
	delete win().__BOOT_PREFS;
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
	delete win().__BOOT_PREFS;
});

describe('loadPanelPrefs — boot-global read order (ADR-0067 D3)', () => {
	it('boot register entry present → its raw string wins even when localStorage differs', () => {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ ...SAVED, panelWidth: 480 }));
		setBoot(JSON.stringify({ ...SAVED, panelWidth: 812 }));
		const loaded = loadPanelPrefs();
		expect(loaded.panelWidth).toBe(812);
		expect(loaded.selectedPanelId).toBe('panel-1');
	});

	it('consume-once: the register entry is cleared after the first read', () => {
		setBoot(JSON.stringify(SAVED));
		loadPanelPrefs();
		expect(win().__BOOT_PREFS?.[PANEL_PREFS_KEY]).toBeUndefined();
		// and the second read falls back to localStorage (empty → defaults)
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
	});

	it('entry absent → the existing localStorage read as today', () => {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ ...SAVED, panelWidth: 640 }));
		const loaded = loadPanelPrefs();
		expect(loaded.panelWidth).toBe(640);
		expect(loaded.panels).toHaveLength(1);
	});

	it('SSR (no window) → defaults, no throw', () => {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(SAVED));
		// SSR has neither window NOR localStorage (store guard, create-prefs-store.ts:68).
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('localStorage', undefined);
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
	});

	it('junk raw (unparseable) → localStorage fallback, never throws', () => {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ ...SAVED, panelWidth: 700 }));
		setBoot('not-json{{{');
		const loaded = loadPanelPrefs();
		expect(loaded.panelWidth).toBe(700);
	});

	it('junk raw shape (non-array panels) → same junk defense as localStorage', () => {
		localStorage.clear();
		setBoot(JSON.stringify({ panels: 'nope', panelWidth: 812 }));
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
	});

	it('non-string raw values (null / number) are ignored → localStorage path', () => {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ ...SAVED, panelWidth: 700 }));
		setBoot(null);
		expect(loadPanelPrefs().panelWidth).toBe(700);
		setBoot(42);
		expect(loadPanelPrefs().panelWidth).toBe(700);
	});
});

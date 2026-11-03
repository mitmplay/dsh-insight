/**
 * Unit: panel-prefs — the persisted workspace state of the panel floor
 * (ADR-0006, 2026-08-24). Behavior under test: defaults when absent/junk/
 * SSR, round-trip, clamp-on-load sanitizing (out-of-range width AND zoom),
 * non-array panels → whole-blob defaults, stored-entry tolerance (missing
 * keys defaulted, unknown keys survive, hard-junk entries dropped), and a
 * selectedPanelId pointing at a missing panel → sanitized to the first
 * panel (null when empty). happy-dom provides localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectTypeOf } from 'vitest';
import type { DsiConversationPanel, DsiPanelEntry } from '$lib/types';
import { loadAppConfig, resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import {
	PANEL_PREFS_KEY,
	PANEL_DEFAULT_WIDTH,
	PANEL_DEFAULT_ZOOM,
	PANEL_MAX_WIDTH,
	PANEL_MAX_ZOOM,
	PANEL_MIN_WIDTH,
	PANEL_MIN_ZOOM,
	PANEL_WORKSPACE_FILE_MAX_WIDTH,
	clampPanelWidth,
	clampPanelZoom,
	shelfPanelWidth,
	clampTreePct,
	TREE_PCT_DEFAULT,
	TREE_PCT_MAX,
	TREE_PCT_MIN,
	defaultPanelPrefs,
	isPanelEntry,
	loadPanelPrefs,
	panelPrefsKey,
	savePanelPrefs,
	type PanelPrefs
} from '$lib/utils/panel-prefs';

const KEY = 'dsi-panels';

function storeBlob(value: unknown): void {
	localStorage.setItem(KEY, JSON.stringify(value));
}

function fullPrefs(): PanelPrefs {
	return {
		panels: [
			{ id: 'panel-1', kind: 'conversation', sessionId: 'sess-1', agentPreset: 'deepseek', width: 640 },
			{ id: 'panel-2', kind: 'conversation', sessionId: 'sess-2', agentPreset: null, width: 720 }
		],
		selectedPanelId: 'panel-2',
		panelWidth: 640,
		zoom: 0.9,
		treePct: TREE_PCT_DEFAULT,
		explorerHidden: false
	};
}

describe('panel-prefs — defaults & SSR', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('returns defaults when nothing is stored', () => {
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
		expect(loadPanelPrefs().panels).toEqual([]);
		expect(loadPanelPrefs().selectedPanelId).toBeNull();
	});

	it('falls back to defaults on junk JSON', () => {
		localStorage.setItem(KEY, '{not json');
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
	});

	it('falls back to defaults on non-object JSON', () => {
		storeBlob('a string');
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
		storeBlob(42);
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
	});

	it('falls back to defaults when panels is not an array (junk entries)', () => {
		storeBlob({ panels: 'not-an-array', selectedPanelId: 'x', panelWidth: 500, zoom: 1 });
		expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
	});

	it('is SSR-safe: no localStorage at all → defaults (vi stub)', () => {
		const original = globalThis.localStorage;
		vi.stubGlobal('localStorage', undefined);
		try {
			expect(loadPanelPrefs()).toEqual(defaultPanelPrefs());
			expect(() => savePanelPrefs(fullPrefs())).not.toThrow();
		} finally {
			vi.unstubAllGlobals();
			void original;
		}
	});
});

describe('panel-prefs — round-trip & clamps', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('round-trips a full workspace state', () => {
		const prefs = fullPrefs();
		savePanelPrefs(prefs);
		expect(loadPanelPrefs()).toEqual(prefs);
	});

	it('clamps a stored width above the max and below the min', () => {
		storeBlob({ panels: [], panelWidth: 9999, zoom: 1 });
		expect(loadPanelPrefs().panelWidth).toBe(PANEL_MAX_WIDTH);
		storeBlob({ panels: [], panelWidth: 1, zoom: 1 });
		expect(loadPanelPrefs().panelWidth).toBe(PANEL_MIN_WIDTH);
	});

	it('clamps a stored zoom above the max and below the min', () => {
		storeBlob({ panels: [], panelWidth: 600, zoom: 4 });
		expect(loadPanelPrefs().zoom).toBe(PANEL_MAX_ZOOM);
		storeBlob({ panels: [], panelWidth: 600, zoom: -2 });
		expect(loadPanelPrefs().zoom).toBe(PANEL_MIN_ZOOM);
	});

	it('clamps out-of-range entry widths on load', () => {
		storeBlob({
			panels: [
				{ id: 'p1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 99999 },
				{ id: 'p2', kind: 'conversation', sessionId: 's2', agentPreset: null, width: 10 }
			],
			selectedPanelId: 'p1',
			panelWidth: 700,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect(loaded.panels[0].width).toBe(PANEL_MAX_WIDTH);
		expect(loaded.panels[1].width).toBe(PANEL_MIN_WIDTH);
	});

	it('defaults non-finite stored width and zoom', () => {
		storeBlob({ panels: [], panelWidth: 'wide', zoom: null });
		const loaded = loadPanelPrefs();
		expect(loaded.panelWidth).toBe(PANEL_DEFAULT_WIDTH);
		expect(loaded.zoom).toBe(PANEL_DEFAULT_ZOOM);
	});

	it('clampPanelWidth and clampPanelZoom bound both ends', () => {
		expect(clampPanelWidth(0)).toBe(PANEL_MIN_WIDTH);
		expect(clampPanelWidth(10000)).toBe(PANEL_MAX_WIDTH);
		expect(clampPanelWidth(640)).toBe(640);
		expect(clampPanelZoom(0.1)).toBe(PANEL_MIN_ZOOM);
		expect(clampPanelZoom(3)).toBe(PANEL_MAX_ZOOM);
		expect(clampPanelZoom(1.2)).toBe(1.2);
	});

	// ── The Explorer Layout (ADR 2026-09-17 D4, Task 2.1-T) ──
	it('treePct defaults to 30 when absent from the blob', () => {
		storeBlob({ panels: [], panelWidth: 600, zoom: 1 });
		const loaded = loadPanelPrefs();
		expect(loaded.treePct).toBe(TREE_PCT_DEFAULT);
		expect(defaultPanelPrefs().treePct).toBe(TREE_PCT_DEFAULT);
	});

	it('treePct clamps out-of-range stored values into 15..70', () => {
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, treePct: 5 });
		expect(loadPanelPrefs().treePct).toBe(TREE_PCT_MIN);
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, treePct: 99 });
		expect(loadPanelPrefs().treePct).toBe(TREE_PCT_MAX);
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, treePct: 44.6 });
		expect(loadPanelPrefs().treePct).toBe(45);
	});

	// ── Explorer hide/show persistence (2026-10-31) ──
	it('explorerHidden defaults to false when absent from the blob', () => {
		storeBlob({ panels: [], panelWidth: 600, zoom: 1 });
		const loaded = loadPanelPrefs();
		expect(loaded.explorerHidden).toBe(false);
		expect(defaultPanelPrefs().explorerHidden).toBe(false);
	});

	it('explorerHidden round-trips true; junk (non-boolean) falls back to false', () => {
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, explorerHidden: true });
		expect(loadPanelPrefs().explorerHidden).toBe(true);
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, explorerHidden: 'yes' });
		expect(loadPanelPrefs().explorerHidden).toBe(false);
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, explorerHidden: null });
		expect(loadPanelPrefs().explorerHidden).toBe(false);
	});

	it('explorerHidden survives a save round-trip', () => {
		const prefs = { ...defaultPanelPrefs(), explorerHidden: true };
		savePanelPrefs(prefs);
		expect(loadPanelPrefs().explorerHidden).toBe(true);
	});

	it('treePct junk (non-finite) falls back to the default', () => {
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, treePct: 'wide' });
		expect(loadPanelPrefs().treePct).toBe(TREE_PCT_DEFAULT);
		storeBlob({ panels: [], panelWidth: 600, zoom: 1, treePct: null });
		expect(loadPanelPrefs().treePct).toBe(TREE_PCT_DEFAULT);
	});

	it('clampTreePct is the single bound site', () => {
		expect(clampTreePct(0)).toBe(TREE_PCT_MIN);
		expect(clampTreePct(100)).toBe(TREE_PCT_MAX);
		expect(clampTreePct(30)).toBe(30);
		expect(clampTreePct(undefined)).toBe(TREE_PCT_DEFAULT);
		expect(clampTreePct(Number.NaN)).toBe(TREE_PCT_DEFAULT);
		expect(clampTreePct('30')).toBe(TREE_PCT_DEFAULT);
	});

	it('treePct round-trips through save/load', () => {
		const prefs = defaultPanelPrefs();
		prefs.treePct = 42;
		savePanelPrefs(prefs);
		expect(loadPanelPrefs().treePct).toBe(42);
	});
});

describe('panel-prefs — DsiPanelEntry type contract (1.3-T)', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('prefs accept DsiPanelEntry[] — imported type flows through PanelPrefs (compile-time)', () => {
		const entries: DsiPanelEntry[] = [
			{ id: 'panel-1', kind: 'conversation', sessionId: 'sess-1', agentPreset: 'deepseek', width: 730 },
			{ id: 'panel-2', kind: 'conversation', sessionId: 'sess-2', agentPreset: null, width: 480 }
		];
		const prefs: PanelPrefs = {
			panels: entries,
			selectedPanelId: 'panel-1',
			panelWidth: 730,
			zoom: 1,
			treePct: TREE_PCT_DEFAULT,
			explorerHidden: false
		};
		expectTypeOf(prefs.panels).toEqualTypeOf<DsiPanelEntry[]>();
		savePanelPrefs(prefs);
		expect(loadPanelPrefs()).toEqual(prefs);
	});

	it('isPanelEntry guards the parse boundary — accepts the full shape, rejects junk', () => {
		const good: DsiPanelEntry = { id: 'p', kind: 'conversation', sessionId: 's', agentPreset: null, width: 600 };
		expect(isPanelEntry(good)).toBe(true);
		expect(isPanelEntry({ id: 'p', kind: 'conversation', sessionId: 's', agentPreset: 'x', width: 600 })).toBe(true);
		// Hard junk — each rejected by the runtime guard.
		expect(isPanelEntry(null)).toBe(false);
		expect(isPanelEntry('entry')).toBe(false);
		expect(isPanelEntry(42)).toBe(false);
		expect(isPanelEntry({ sessionId: 's' })).toBe(false); // missing id
		expect(isPanelEntry({ id: '', kind: 'conversation', sessionId: 's' })).toBe(false); // empty id
		expect(isPanelEntry({ id: 'p' })).toBe(false); // missing sessionId
		expect(isPanelEntry({ id: 'p', kind: 'conversation', sessionId: 's', agentPreset: 7 })).toBe(false); // number preset
		expect(isPanelEntry({ id: 'p', kind: 'conversation', sessionId: 's', width: 'wide' })).toBe(false); // string width
		expect(isPanelEntry({ id: 'p', kind: 'conversation', sessionId: 's', width: Number.NaN })).toBe(false); // NaN width
		expect(isPanelEntry({ id: 'p', kind: 'conversation', sessionId: 's', extra: 'key', width: 600 })).toBe(true); // unknown keys tolerated
	});

	it('a skill-shelf entry survives the save/load round-trip (hard-reload fix)', () => {
		savePanelPrefs({
			panels: [{ id: 'shelf-1', kind: 'skill-shelf', width: 480 }],
			selectedPanelId: 'shelf-1',
			panelWidth: 730,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		// Persisted chrome sanitizes to the panel's own defaults.
		expect(loaded.panels).toEqual([
			{ id: 'shelf-1', kind: 'skill-shelf', tab: 'install', collapsed: [], searchQ: '', reload: null, width: 480 }
		]);
		expect(loaded.selectedPanelId).toBe('shelf-1');
	});

	it('skill-shelf chrome persists: tab, collapsed set, and search text', () => {
		savePanelPrefs({
			panels: [
				{
					id: 'shelf-1',
					kind: 'skill-shelf',
					tab: 'uninstall',
					collapsed: ['src-a'],
					searchQ: 'adr',
					width: 500
				}
			],
			selectedPanelId: 'shelf-1',
			panelWidth: 730,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect(loaded.panels[0]).toEqual({
			id: 'shelf-1',
			kind: 'skill-shelf',
			tab: 'uninstall',
			collapsed: ['src-a'],
			searchQ: 'adr',
			reload: null,
			width: 500
		});
	});

	it('DsiPanelEntry field types are pinned (compile-time)', () => {
		expectTypeOf<DsiPanelEntry['id']>().toEqualTypeOf<string>();
		expectTypeOf<DsiConversationPanel['sessionId']>().toEqualTypeOf<string>();
		expectTypeOf<DsiConversationPanel['agentPreset']>().toEqualTypeOf<string | null>();
		expectTypeOf<DsiPanelEntry['width']>().toEqualTypeOf<number>();
	});
});

describe('panel-prefs — stored-entry tolerance & selection', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('defaults missing entry keys (agentPreset→null, width→default) and keeps unknown keys', () => {
		storeBlob({
			panels: [{ id: 'p1', kind: 'conversation', sessionId: 's1', note: 'future-field' }],
			selectedPanelId: 'p1',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toHaveLength(1);
		expect((loaded.panels[0] as DsiConversationPanel).agentPreset).toBeNull();
		expect(loaded.panels[0].width).toBe(PANEL_DEFAULT_WIDTH);
		// Unknown keys survive sanitizing (forward-compatible blob).
		expect((loaded.panels[0] as unknown as Record<string, unknown>).note).toBe('future-field');
	});

	it('drops hard-junk entries while keeping valid siblings', () => {
		storeBlob({
			panels: [
				{ id: 'p1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 600 },
				'junk-string',
				{ sessionId: 'missing-id' },
				null
			],
			selectedPanelId: 'p1',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toHaveLength(1);
		expect(loaded.panels[0].id).toBe('p1');
	});

	it('sanitizes a selectedPanelId pointing at a missing panel to the first panel', () => {
		storeBlob({
			panels: [
				{ id: 'p1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 600 },
				{ id: 'p2', kind: 'conversation', sessionId: 's2', agentPreset: null, width: 600 }
			],
			selectedPanelId: 'ghost',
			panelWidth: 600,
			zoom: 1
		});
		expect(loadPanelPrefs().selectedPanelId).toBe('p1');
	});

	it('sanitizes selection to null when the stored selection points at a missing panel and no valid panels remain', () => {
		storeBlob({ panels: [null, 'junk'], selectedPanelId: 'ghost', panelWidth: 600, zoom: 1 });
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toEqual([]);
		expect(loaded.selectedPanelId).toBeNull();
	});

	it('save is best-effort — a throwing store does not propagate', () => {
		const setter = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('store full');
		};
		try {
			expect(() => savePanelPrefs(fullPrefs())).not.toThrow();
		} finally {
			localStorage.setItem = setter;
		}
	});
});

describe('panel-prefs — workspace profiles (?profile= → dsi-panels_<profile>)', () => {
	it('panelPrefsKey: null/undefined → base key; a profile suffixes it', () => {
		expect(panelPrefsKey(null)).toBe('dsi-panels');
		expect(panelPrefsKey(undefined)).toBe('dsi-panels');
		expect(panelPrefsKey('widi')).toBe('dsi-panels_widi');
		expect(PANEL_PREFS_KEY).toBe('dsi-panels');
	});

	it('save/load under a profile touch ONLY the profile key — desks are isolated', () => {
		savePanelPrefs(fullPrefs(), 'widi');
		expect(localStorage.getItem('dsi-panels_widi')).toContain('sess-1');
		// The default desk was not created by a profile write.
		expect(localStorage.getItem('dsi-panels')).toBeNull();

		// Different content under the default key.
		savePanelPrefs(defaultPanelPrefs());
		const fromProfile = loadPanelPrefs('widi');
		expect(fromProfile.panels).toHaveLength(2);
		expect(loadPanelPrefs().panels).toHaveLength(0);
	});

	it('a junk profile blob falls back to defaults without touching the default desk', () => {
		localStorage.setItem('dsi-panels_widi', JSON.stringify({ panels: 'not-an-array' }));
		savePanelPrefs(fullPrefs());
		expect(loadPanelPrefs('widi').panels).toEqual([]);
		expect(loadPanelPrefs().panels).toHaveLength(2);
	});
});

// ── Workspace Explorer W1 1.3-T — restore defaults for the new kinds (2026-09-10 ADR D2) ──

describe('panel-prefs — workspace branch restore (Workspace Explorer ADR D2)', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('an older blob WITHOUT the new kinds restores untouched (forward-compatible restore)', () => {
		storeBlob({
			panels: [
				{ id: 'p1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 600 },
				{ id: 'p2', kind: 'prompt-manager', width: 600 }
			],
			selectedPanelId: 'p1',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toHaveLength(2);
		expect(loaded.panels.map((p) => p.kind)).toEqual(['conversation', 'prompt-manager']);
	});

	it('explorer entries round-trip with root + expanded intact; widths clamp', () => {
		storeBlob({
			panels: [
				{
					id: 'w1',
					kind: 'workspace-explorer',
					sessionId: 's1',
					root: '/tmp/ws',
					expanded: ['docs', 'src'],
					width: 99999
				}
			],
			selectedPanelId: 'w1',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		const w1 = loaded.panels[0] as unknown as Record<string, unknown>;
		expect(w1.kind).toBe('workspace-explorer');
		expect(w1.root).toBe('/tmp/ws');
		expect(w1.expanded).toEqual(['docs', 'src']);
		expect(loaded.panels[0].width).toBe(PANEL_WORKSPACE_FILE_MAX_WIDTH); // clamped into the wide lane (Settings Tree D1)
	});

	it('junk expanded members clamp: non-strings drop, duplicates keep first occurrence, non-array defaults', () => {
		storeBlob({
			panels: [
				{
					id: 'w1',
					kind: 'workspace-explorer',
					sessionId: 's1',
					root: '/w',
					expanded: ['a', 7, null, 'a', 'b']
				},
				{
					id: 'w2',
					kind: 'workspace-explorer',
					sessionId: 's2',
					root: '/w',
					expanded: 'not-an-array'
				}
			],
			selectedPanelId: 'w1',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect((loaded.panels[0] as unknown as Record<string, unknown>).expanded).toEqual(['a', 'b']);
		expect((loaded.panels[1] as unknown as Record<string, unknown>).expanded).toEqual([]);
	});

	it('collapsedRepos round-trips (2026-09-13 bug fix): junk members clamp, absent defaults empty', () => {
		storeBlob({
			panels: [
				{
					id: 'w1',
					kind: 'workspace-explorer',
					sessionId: 's1',
					root: '/w',
					expanded: [],
					tab: 'changes',
					collapsedRepos: ['', 'sub/repo']
				},
				{
					id: 'w2',
					kind: 'workspace-explorer',
					sessionId: 's2',
					root: '/w',
					expanded: []
				}
			],
			selectedPanelId: 'w1',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect((loaded.panels[0] as unknown as Record<string, unknown>).collapsedRepos).toEqual(['', 'sub/repo']);
		// Absent on a legacy entry ⇒ all repos expanded (empty collapsed list).
		expect((loaded.panels[1] as unknown as Record<string, unknown>).collapsedRepos).toEqual([]);
	});

	it('hard-junk workspace entries drop while valid siblings survive', () => {
		storeBlob({
			panels: [
				{ id: 'ok', kind: 'workspace-file', sessionId: 's1', path: 'README.md', width: 600 },
				{ id: 'j1', kind: 'workspace-file', sessionId: 's1', path: '', width: 600 },
				{ id: 'j2', kind: 'workspace-file', path: 'README.md', width: 600 },
				{ id: 'j3', kind: 'workspace-explorer', sessionId: 's1', width: 600 }
			],
			selectedPanelId: 'ok',
			panelWidth: 600,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toHaveLength(1);
		expect(loaded.panels[0].id).toBe('ok');
	});
});

// ── Duplicate panel ids — each_key_duplicate crash fix (2026-08-24) ──

describe('panel-prefs — duplicate id dedupe (keyed-each crash fix)', () => {
	it('a blob carrying the same panel-N twice loads ONCE (first occurrence wins)', () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				panels: [
					{ id: 'panel-1', kind: 'conversation', sessionId: 'sess-a', agentPreset: null, width: 0.5 },
					{ id: 'panel-1', kind: 'conversation', sessionId: 'sess-b', agentPreset: null, width: 0.5 },
					{ id: 'panel-2', kind: 'conversation', sessionId: 'sess-c', agentPreset: null, width: 0.5 }
				],
				selectedPanelId: 'panel-2'
			})
		);
		const prefs = loadPanelPrefs();
		expect(prefs.panels).toHaveLength(2);
		expect((prefs.panels[0] as DsiConversationPanel).sessionId).toBe('sess-a'); // first occurrence
		expect(prefs.panels.map((p) => p.id).sort()).toEqual(['panel-1', 'panel-2']);
	});

	it('a selectedPanelId dangling after the dedupe re-sanitizes to a surviving panel', () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				panels: [
					{ id: 'panel-9', kind: 'conversation', sessionId: 'sess-a', agentPreset: null, width: 0.5 },
					{ id: 'panel-9', kind: 'conversation', sessionId: 'sess-b', agentPreset: null, width: 0.5 }
				],
				selectedPanelId: 'panel-9'
			})
		);
		const prefs = loadPanelPrefs();
		expect(prefs.panels).toHaveLength(1);
		expect(prefs.selectedPanelId).toBe('panel-9'); // still valid — it survived
	});

	it('a selectedPanelId pointing ONLY at the dropped duplicate falls back to the first panel', () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				panels: [
					{ id: 'panel-1', kind: 'conversation', sessionId: 'sess-a', agentPreset: null, width: 0.5 },
					{ id: 'panel-2', kind: 'conversation', sessionId: 'sess-b', agentPreset: null, width: 0.5 },
					{ id: 'panel-2', kind: 'conversation', sessionId: 'sess-c', agentPreset: null, width: 0.5 }
				],
				selectedPanelId: 'panel-3' // never existed
			})
		);
		const prefs = loadPanelPrefs();
		expect(prefs.panels).toHaveLength(2);
		expect(prefs.selectedPanelId).toBe('panel-1'); // first panel fallback
	});
});

// ── Workspace Explorer W5 5.1-T — the F5 restore composition: a blob
// holding the LIVE kinds restores with expanded intact; a pre-workspace
// blob is untouched (W1 pin, re-stated as the reload contract). ──

describe('panel-prefs — F5 restore composition (5.1-T)', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('a full floor incl. both live kinds restores with expanded intact', () => {
		const explorer = {
			id: 'w1',
			kind: 'workspace-explorer',
			sessionId: 's1',
			root: '/tmp/ws',
			expanded: ['notes', 'src/lib'],
			width: 600
		};
		const file = {
			id: 'f1',
			kind: 'workspace-file',
			sessionId: 's1',
			path: 'notes/plain.txt',
			width: 600
		};
		storeBlob({
			panels: [
				{ id: 'c1', kind: 'conversation', sessionId: 'sess-1', agentPreset: null, width: 640 },
				explorer,
				file
			],
			selectedPanelId: 'f1',
			panelWidth: 640,
			zoom: 1
		});
		const loaded = loadPanelPrefs();
		// Order (floor truth) survives; the file panel keeps its selection.
		expect(loaded.panels.map((p) => p.id)).toEqual(['c1', 'w1', 'f1']);
		expect(loaded.selectedPanelId).toBe('f1');
		// The tree reopens its folders: expanded round-trips verbatim —
		// the LEVELS do not (the component re-fetches them on mount).
		expect((loaded.panels[1] as unknown as Record<string, unknown>).expanded).toEqual(['notes', 'src/lib']);
		// The file panel keeps the (sessionId, path) pair — its content
		// re-fetches fresh on mount; a dirty draft stays dead by design.
		expect((loaded.panels[2] as unknown as Record<string, unknown>).path).toBe('notes/plain.txt');
	});
});

describe('panel-prefs — workspace-file explorer edge restore (2026-09-10)', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('a stored string edge survives sanitize; a missing edge defaults to null', () => {
		storeBlob({
			panels: [
				{
					id: 'panel-e',
					kind: 'workspace-explorer',
					sessionId: 'sess-1',
					root: '/tmp/w',
					expanded: [],
					width: 600
				},
				{
					id: 'panel-f',
					kind: 'workspace-file',
					sessionId: 'sess-1',
					path: 'README.md',
					explorerPanelId: 'panel-e',
					width: 600
				},
				{
					id: 'panel-g',
					kind: 'workspace-file',
					sessionId: 'sess-1',
					path: 'old.md',
					width: 600
				}
			],
			selectedPanelId: 'panel-f',
			panelWidth: 600,
			zoom: 1
		});
		const prefs = loadPanelPrefs();
		const withEdge = prefs.panels.find((p) => p.id === 'panel-f');
		const withoutEdge = prefs.panels.find((p) => p.id === 'panel-g');
		expect(
			withEdge && withEdge.kind === 'workspace-file' ? withEdge.explorerPanelId : undefined
		).toBe('panel-e');
		expect(
			withoutEdge && withoutEdge.kind === 'workspace-file' ? withoutEdge.explorerPanelId : undefined
		).toBeNull();
	});

	it('a non-string edge value defaults to null (tolerant restore)', () => {
		storeBlob({
			panels: [
				{
					id: 'panel-f',
					kind: 'workspace-file',
					sessionId: 'sess-1',
					path: 'README.md',
					explorerPanelId: 42,
					width: 600
				}
			],
			selectedPanelId: 'panel-f',
			panelWidth: 600,
			zoom: 1
		});
		const prefs = loadPanelPrefs();
		const entry = prefs.panels[0];
		expect(entry && entry.kind === 'workspace-file' ? entry.explorerPanelId : undefined).toBeNull();
	});
});

// ── The Explorer Layout width lane (ADR 2026-09-17 D3/D4, operator bug
// 2026-09-17): in 'explorer' layout the explorer panel HOSTS the reading
// surface — it lives in the WIDE file band, not the 280 tree lane.
describe('panel-prefs — explorer width lane (Settings Tree D1: the wide band is the only lane)', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('the explorer lives in the wide file band — no layout knob left to consult', () => {
		expect(clampPanelWidth(280, 'workspace-explorer')).toBe(520);
		expect(clampPanelWidth(100, 'workspace-explorer')).toBe(520);
		expect(clampPanelWidth(1000, 'workspace-explorer')).toBe(1000);
		expect(clampPanelWidth(5000, 'workspace-explorer')).toBe(1436);
	});

	it('blob sanitize defaults a missing width to the wide lane (850)', () => {
		storeBlob({ panels: [{ id: 'w1', kind: 'workspace-explorer', sessionId: 's1', root: '/r', expanded: [] }], panelWidth: 600, zoom: 1 });
		const loaded = loadPanelPrefs();
		const explorer = loaded.panels[0];
		expect(explorer && explorer.kind === 'workspace-explorer' ? explorer.width : undefined).toBe(850);
	});
});

describe('panel-prefs — the skill shelf pins 480 (The Shelf Chrome D5)', () => {
	beforeEach(() => {
		localStorage.clear();
		resetAppConfigForTests();
		loadAppConfig();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('shelfPanelWidth is 480 regardless of the conversation default width', () => {
		expect(shelfPanelWidth()).toBe(480);
	});
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
	loadPanelPrefs,
	resizeAllByRegistry,
	applyPresetWidthsByRegistry,
	PANEL_KIND_DECLARATIONS
} from '../../src/lib/utils/panel-prefs';
import type { DsiPanelEntry } from '../../src/lib/types';
import type { PanelPrefs } from '../../src/lib/utils/panel-prefs';

/**
 * R4 Wave 3 (ADR-0065) — the per-kind revive table + sweep parity.
 *
 * The dsi-panels revive no longer runs an if/else chain: TEN declarations
 * (nine persisted + browser persisted:false) own the shape gates, the
 * field reconstruction, the lane defaults, and the lazy bands. These
 * tests are the byte-preservation net: one case per declaration, the D7
 * spread boundary, the D6 glass drop, the dedupe rule, the D3 dangling
 * selection — and the resize sweeps touching ONLY flagged kinds.
 */

const UNEXPIRED_DONE = Date.now() + 86_400_000; // done 24h out — survives

/** A mixed real-world blob: all ten kinds, incl. a hand-crafted browser
 *  entry (D6: must drop), a desk mirror, an unexpired skill-shelf reload,
 *  a duplicate id, and a dangling selectedPanelId (D3). */
function mixedBlob(): Record<string, unknown> {
	return {
		panels: [
			{ id: 'p1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 700, mysteryKeeper: 'keep-me' },
			{ id: 'p2', kind: 'prompt-manager', width: 600, extraJunk: true },
			{ id: 'p3', kind: 'settings-editor', target: 'dsh', width: 700 },
			{ id: 'p4', kind: 'injected-doc', sourceSessionId: 'src1', displayPath: '/doc.md', width: 700 },
			{
				id: 'p5',
				kind: 'skill-shelf',
				width: 480,
				tab: 'uninstall',
				collapsed: ['/a'],
				searchQ: 'kv',
				reload: { phase: 'done', startedAt: 1, doneAt: UNEXPIRED_DONE }
			},
			{ id: 'p6', kind: 'plugin-rack', width: 480, tab: 'install' },
			{
				id: 'p7',
				kind: 'workspace-explorer',
				sessionId: null,
				home: 'dsi',
				root: '/w',
				expanded: ['/x'],
				tab: 'changes',
				collapsedRepos: ['/r'],
				openTabs: [],
				activeFile: '/f',
				width: 850
			},
			{ id: 'p8', kind: 'workspace-file', sessionId: 's8', path: '/a.ts', explorerPanelId: 'p7', view: 'diff', width: 900 },
			{ id: 'p9', kind: 'terminal', desk: { tabs: [{ sessionIds: ['t1'] }], selectedTab: 0 }, width: 700 },
			{ id: 'p10', kind: 'browser', width: 500 },
			// duplicate id → drops to first (order is floor truth)
			{ id: 'p1', kind: 'conversation', sessionId: 's1', width: 500 }
		],
		selectedPanelId: 'ghost', // D3: dangling → first surviving panel
		panelWidth: 800,
		zoom: 1.1,
		treePct: 45,
		explorerHidden: true,
		termFontSize: 14
	};
}

/** The byte-exact sanitized output the registry must produce for mixedBlob(). */
function expectedMixedPrefs(): PanelPrefs {
	return {
		panels: [
			{ id: 'p1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 700, mysteryKeeper: 'keep-me' },
			{ id: 'p2', kind: 'prompt-manager', width: 600 },
			{ id: 'p3', kind: 'settings-editor', target: 'dsh', width: 700 },
			{ id: 'p4', kind: 'injected-doc', sourceSessionId: 'src1', displayPath: '/doc.md', width: 700 },
			{
				id: 'p5',
				kind: 'skill-shelf',
				tab: 'uninstall',
				collapsed: ['/a'],
				searchQ: 'kv',
				reload: { phase: 'done', startedAt: 1, doneAt: UNEXPIRED_DONE },
				width: 480
			},
			{ id: 'p6', kind: 'plugin-rack', tab: 'install', width: 480 },
			{
				id: 'p7',
				kind: 'workspace-explorer',
				sessionId: null,
				root: '/w',
				home: 'dsi',
				expanded: ['/x'],
				tab: 'changes',
				collapsedRepos: ['/r'],
				openTabs: [],
				activeFile: '/f',
				width: 850
			},
			{ id: 'p8', kind: 'workspace-file', sessionId: 's8', path: '/a.ts', explorerPanelId: 'p7', view: 'diff', width: 900 },
			{ id: 'p9', kind: 'terminal', desk: { tabs: [{ sessionIds: ['t1'] }], selectedTab: 0 }, width: 700 }
		] as DsiPanelEntry[],
		selectedPanelId: 'p1',
		panelWidth: 800,
		zoom: 1.1,
		treePct: 45,
		explorerHidden: true,
		termFontSize: 14
	};
}

beforeEach(() => {
	localStorage.clear();
});

describe('per-kind revive table (3.1-T, ADR-0065 W3)', () => {
	it('ten declarations exist; browser is the only persisted:false', () => {
		expect(PANEL_KIND_DECLARATIONS).toHaveLength(10);
		expect(PANEL_KIND_DECLARATIONS.filter((d) => !d.persisted).map((d) => d.kind)).toEqual(['browser']);
		expect(PANEL_KIND_DECLARATIONS.filter((d) => d.resizableByPreset).map((d) => d.kind)).toEqual(['conversation']);
	});

	it('junk entry drops; whole junk blob falls to defaults', () => {
		localStorage.setItem('dsi-panels', JSON.stringify({ panels: [{ id: 'x', kind: 'telemetry' }] }));
		const prefs = loadPanelPrefs();
		expect(prefs.panels).toEqual([]);
		localStorage.setItem('dsi-panels', '{junk');
		expect(loadPanelPrefs().panels).toEqual([]);
	});

	it('missing keys default through the lane ladder (width absent)', () => {
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({ panels: [{ id: 'm1', kind: 'prompt-manager' }, { id: 'sh1', kind: 'skill-shelf' }] })
		);
		const [m, s] = loadPanelPrefs().panels;
		expect(m.width).toBe(730); // conversation default lane
		expect(s.width).toBe(480); // the shelf's born lane
	});

	it('conversation spread preserved — unknown extra key survives (D7)', () => {
		localStorage.setItem('dsi-panels', JSON.stringify(mixedBlob()));
		const conv = loadPanelPrefs().panels.find((p) => p.id === 'p1') as unknown as Record<string, unknown>;
		expect(conv['mysteryKeeper']).toBe('keep-me');
	});

	it('non-conversation extras dropped — field-wise reconstruction', () => {
		localStorage.setItem('dsi-panels', JSON.stringify(mixedBlob()));
		const pm = loadPanelPrefs().panels.find((p) => p.id === 'p2') as unknown as Record<string, unknown>;
		expect(pm).toEqual({ id: 'p2', kind: 'prompt-manager', width: 600 });
	});

	it('a hand-crafted browser entry in the blob drops (D6)', () => {
		localStorage.setItem('dsi-panels', JSON.stringify(mixedBlob()));
		const ids = loadPanelPrefs().panels.map((p) => p.id);
		expect(ids).not.toContain('p10');
	});

	it('duplicate ids drop to first — order is floor truth', () => {
		localStorage.setItem('dsi-panels', JSON.stringify(mixedBlob()));
		const p1s = loadPanelPrefs().panels.filter((p) => p.id === 'p1');
		expect(p1s).toHaveLength(1);
		expect((p1s[0] as unknown as Record<string, unknown>).width).toBe(700); // FIRST occurrence kept
	});

	it('selectedPanelId dangling → first surviving panel (D3)', () => {
		localStorage.setItem('dsi-panels', JSON.stringify(mixedBlob()));
		expect(loadPanelPrefs().selectedPanelId).toBe('p1');
	});

	it('junk knobs default; valid knobs survive (panelWidth/zoom/treePct/explorerHidden/termFontSize)', () => {
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [],
				panelWidth: 'wide',
				zoom: Number.NaN,
				treePct: 'half',
				explorerHidden: 'yes',
				termFontSize: 'big'
			})
		);
		const prefs = loadPanelPrefs();
		expect(prefs.panelWidth).toBe(730);
		expect(prefs.zoom).toBe(1);
		expect(prefs.treePct).toBe(30);
		expect(prefs.explorerHidden).toBe(false);
		expect(prefs.termFontSize).toBe(12);
	});

	it('terminal desk mirror clamps field-wise; skill-shelf expired reload clears', () => {
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [
					{ id: 't', kind: 'terminal', desk: { tabs: [{ sessionIds: ['t1', 42] }], selectedTab: 9 } },
					{ id: 's', kind: 'skill-shelf', reload: { phase: 'done', startedAt: 1, doneAt: 1 } } // long expired
				]
			})
		);
		const [t, s] = loadPanelPrefs().panels;
		expect((t as { desk?: { tabs: unknown[]; selectedTab: number } }).desk).toEqual({
			tabs: [{ sessionIds: ['t1'] }],
			selectedTab: 1
		});
		expect((s as { reload: unknown }).reload).toBeNull();
	});
});

describe('3.3 round-trip byte-parity — mixed real-world blob', () => {
	it('sanitized output equals today’s behavior byte-for-byte', () => {
		localStorage.setItem('dsi-panels', JSON.stringify(mixedBlob()));
		const loaded = loadPanelPrefs();
		const expected = expectedMixedPrefs();
		expect(JSON.parse(JSON.stringify(loaded))).toEqual(JSON.parse(JSON.stringify(expected)));
		expect(JSON.stringify(loaded)).toBe(JSON.stringify(expected));
	});
});

describe('sweep parity (3.2-T) — registry loops touch ONLY flagged kinds', () => {
	const mixedRow: DsiPanelEntry[] = [
		{ id: 'c', kind: 'conversation', sessionId: 's', agentPreset: null, width: 600 },
		{ id: 'e', kind: 'workspace-explorer', sessionId: null, home: 'dsi', root: '/w', expanded: [], tab: 'explorer', collapsedRepos: [], openTabs: [], activeFile: null, width: 850 },
		{ id: 't', kind: 'terminal', width: 700 },
		{ id: 'g', kind: 'browser', width: 500 }
	] as DsiPanelEntry[];

	it('resizeAllByRegistry changes ONLY the conversation width', () => {
		const out = resizeAllByRegistry(mixedRow, 820);
		expect(out.map((p) => p.width)).toEqual([820, 850, 700, 500]);
		expect(out[1]).toBe(mixedRow[1]); // untouched panels keep identity
		expect(out[2]).toBe(mixedRow[2]);
		expect(out[3]).toBe(mixedRow[3]);
	});

	it('registry sweep clamps at the flagged kind’s own band', () => {
		const out = resizeAllByRegistry(mixedRow, 9999);
		expect(out[0].width).toBe(860); // conversation ceiling (default band)
	});

	it('applyPresetWidthsByRegistry: agent px → conversation, glass px → browser, lanes untouched', () => {
		const out = applyPresetWidthsByRegistry(mixedRow, 700, 900);
		expect(out.map((p) => p.width)).toEqual([700, 850, 700, 900]);
		expect(out[1]).toBe(mixedRow[1]);
	});

	it('applyPresetWidthsByRegistry: undefined legs leave their kinds untouched', () => {
		const out = applyPresetWidthsByRegistry(mixedRow, undefined, undefined);
		expect(out.map((p) => p.width)).toEqual([600, 850, 700, 500]);
		const agentOnly = applyPresetWidthsByRegistry(mixedRow, 750, undefined);
		expect(agentOnly.map((p) => p.width)).toEqual([750, 850, 700, 500]);
	});
});

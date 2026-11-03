/**
 * Width Preset Chord unit tests (ADR-0006a, Tasks T1.1-T / T2.1-T / T2.2-T):
 * the shared preset gate, the PURE chord reducer, and the floor applier
 * exercised through configureFloorRegistry with fake deps.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_PANEL_PRESETS, applySidebarLane, resolvePanelPresets } from '$lib/config';
import {
	CHORD_WINDOW_MS,
	chordKey,
	chordOptions,
	decideChordKeydown,
	hasAnyPreset,
	IDLE_CHORD,
	isEditableTarget,
	type ChordKey as CKey
} from '$lib/utils/key-chords';
import {
	applyWidthPreset,
	configureFloorRegistry,
	disposeFloorGestures,
	floor,
	initFloor,
	makeBrowserPanel,
	makePanel,
	makeWorkspaceExplorerPanel,
	resetFloorState
} from '$lib/services/panels/floor-registry.svelte';

const key = (k: string, o: Partial<CKey> = {}): CKey => ({ key: k, code: k.length === 1 ? (/[1-9]/.test(k) ? 'Digit' + k : 'Key' + k.toUpperCase()) : undefined, altKey: false, ctrlKey: false, metaKey: false, type: 'keydown', ...o });

describe("resolvePanelPresets (shared gate, T1.1-T)", () => {
	it('parses the operator yaml shape', () => {
		const p = resolvePanelPresets({ agent: { 1: 660, 2: 808 }, glass: { 1: 530, 2: 800 }, sidebar: { state: { 1: 'collapse' }, width: { 2: 340 } }, zoom: { 1: 80, 2: 90 } });
		expect(p.agent[1]).toBe(660);
		expect(p.agent[2]).toBe(808);
		expect(p.glass[2]).toBe(800);
		expect(p.sidebar[1]).toEqual({ state: 'collapse' });
		expect(p.sidebar[2]).toEqual({ width: 340 });
		expect(p.zoom[1]).toBe(80);
		expect(p.zoom[2]).toBe(90);
	});
	it('merges both lane maps into ONE lane per slot (D27)', () => {
		const p = resolvePanelPresets({ sidebar: { state: { 2: 'expand' }, width: { 2: 340 } } });
		expect(p.sidebar[2]).toEqual({ state: 'expand', width: 340 });
	});
	it('drops junk: out-of-band px, slot 0/10, unknown sidebar verbs, non-records', () => {
		const p = resolvePanelPresets({
			agent: { 0: 100, 10: 660, 3: 99, 4: 'x' },
			glass: 'nope',
			sidebar: { state: { 1: 'wide', 0: 'collapse', 10: 'expand' }, width: { 2: 0, 3: -50, 11: 340, 4: 'x' }, 5: 'collapse' }
		});
		expect(p.agent).toEqual({}); // 0/10 out of chord slots; 99 < 200; string px
		expect(p.glass).toEqual({});
		expect(p.sidebar).toEqual({}); // legacy flat shape + every junk dial drops (D29/D4)
	});
	it('drops the legacy flat sidebar shape while the other kinds keep parsing (D29)', () => {
		const p = resolvePanelPresets({ agent: { 1: 660 }, sidebar: { 1: 'collapse', 2: 'expand' } as unknown as Record<string, unknown> });
		expect(p.sidebar).toEqual({});
		expect(p.agent[1]).toBe(660);
	});
	it('re-gates the RESOLVED lane map from the wire (shape-normalized gate)', () => {
		// /api/config carries the server-resolved slot → lane map, not the yaml.
		const wire = resolvePanelPresets({
			agent: { 1: 630 },
			sidebar: { 1: { state: 'collapse' }, 2: { state: 'expand', width: 340 } }
		});
		expect(wire.sidebar[1]).toEqual({ state: 'collapse' });
		expect(wire.sidebar[2]).toEqual({ state: 'expand', width: 340 });
		// resolved-lane junk still drops: bad verb, bad px, legacy verb strings —
		// a lane left with neither dial shrinks the slot away entirely
		const junk = resolvePanelPresets({ sidebar: { 1: { state: 'wide' }, 2: { width: 9_999 }, 3: 'collapse' } });
		expect(junk.sidebar).toEqual({});
	});
	it('defaults stay empty on a missing section (D4: silent absence)', () => {
		expect(resolvePanelPresets(undefined)).toEqual(DEFAULT_PANEL_PRESETS);
		expect(resolvePanelPresets({ agent: { 1: 660 } }).glass).toEqual({});
	});
	it('parses the UNIFORM nested width dial for agent/glass/zoom (ext 6, AC1)', () => {
		const p = resolvePanelPresets({
			agent: { width: { 1: 630, 2: 808 } },
			glass: { width: { 1: 530, 2: 800 } },
			zoom: { width: { 1: 80, 2: 90 } }
		});
		expect(p.agent[1]).toBe(630);
		expect(p.agent[2]).toBe(808);
		expect(p.glass[2]).toBe(800);
		expect(p.zoom[1]).toBe(80);
		expect(p.zoom[2]).toBe(90);
	});
	it('zoom keeps its PERCENT band in the nested dial (AC1/D33)', () => {
		const p = resolvePanelPresets({ zoom: { width: { 1: 25, 2: 300, 3: 20, 4: 301 } } });
		expect(p.zoom).toEqual({ 1: 25, 2: 300 });
	});
	it('the FLAT slot map still parses for agent/glass/zoom (AC2/D32 wire round-trip)', () => {
		const p = resolvePanelPresets({ agent: { 1: 630 }, glass: { 2: 800 }, zoom: { 1: 90 } });
		expect(p.agent[1]).toBe(630);
		expect(p.glass[2]).toBe(800);
		expect(p.zoom[1]).toBe(90);
	});
	it('junk drops in the nested dial: band, slot 0/10, non-record width (AC3)', () => {
		const p = resolvePanelPresets({
			agent: { width: { 0: 100, 10: 660, 3: 99, 4: 'x' } },
			glass: { width: 'nope' },
			zoom: { width: { 1: 500 } }
		});
		expect(p.agent).toEqual({});
		expect(p.glass).toEqual({});
		expect(p.zoom).toEqual({});
	});
	it('mixed shapes in one kind: nested width WINS, flat slots ignored (AC4)', () => {
		const p = resolvePanelPresets({ agent: { width: { 1: 630 }, 2: 808 } });
		expect(p.agent).toEqual({ 1: 630 });
	});
});

describe('applySidebarLane (pure lane writer, T2.1-T, ADR-0006a ext 5)', () => {
	const clamp = (w: number) => Math.min(500, Math.max(200, w)); // clampSidebarWidth stand-in

	it('width-only implies expand (D28) and clamps', () => {
		expect(applySidebarLane({ width: 340 }, clamp)).toEqual({ width: 340, collapsed: false });
		expect(applySidebarLane({ width: 9999 }, clamp)).toEqual({ width: 500, collapsed: false });
		expect(applySidebarLane({ width: 5 }, clamp)).toEqual({ width: 200, collapsed: false });
	});
	it('state-only touches only the collapsed flag; width keeps its current value', () => {
		expect(applySidebarLane({ state: 'collapse' }, clamp)).toEqual({ collapsed: true });
		expect(applySidebarLane({ state: 'expand' }, clamp)).toEqual({ collapsed: false });
	});
	it('a combined lane applies both dials, state winning the flag', () => {
		expect(applySidebarLane({ state: 'collapse', width: 340 }, clamp)).toEqual({ width: 340, collapsed: true });
	});
	it('no lane / a neither-dial lane writes nothing', () => {
		expect(applySidebarLane(undefined, clamp)).toEqual({});
		expect(applySidebarLane({}, clamp)).toEqual({});
	});
});

describe("chordKey (pure reducer, T2.1-T)", () => {
	const armed = { armed: true, since: 1000 };

	it('Alt+S keydown arms only when presets exist; keyup is a pass-through', () => {
		const r1 = chordKey(IDLE_CHORD, key('s', { altKey: true, type: 'keydown' }), true, 1000);
		expect(r1.state.armed).toBe(true);
		expect(r1.action.type).toBe('none');
		const r0 = chordKey(IDLE_CHORD, key('s', { altKey: true, type: 'keyup' }), true, 1000);
		expect(r0.state.armed).toBe(false); // keyup NEVER arms (onkeydown lesson)
		const r2 = chordKey(IDLE_CHORD, key("s", { altKey: true, type: "keydown" }), false, 1000);
		expect(r2.state.armed).toBe(false); // D4: cannot arm
	});

	it('macOS Alt remap: key="ß" with code=KeyS still arms (operator bug 2026-10-29)', () => {
		const r = chordKey(IDLE_CHORD, key('ß', { code: 'KeyS', altKey: true, type: 'keydown' }), true, 1000);
		expect(r.state.armed).toBe(true);
	});

	it('macOS Alt remap: key="ß" WITHOUT a code does not arm (fallback off)', () => {
		const r = chordKey(IDLE_CHORD, { key: 'ß', altKey: true, ctrlKey: false, metaKey: false, type: 'keydown' }, true, 1000);
		expect(r.state.armed).toBe(false);
	});

	it('a digit inside the window fires apply; missing preset slot still applies (caller drops)', () => {
		const r = chordKey(armed, key('1'), true, 1000 + CHORD_WINDOW_MS - 1);
		expect(r.action).toEqual({ type: "apply", n: 1 });
		expect(r.state.armed).toBe(false);
	});

	it('the window expiring disarms without firing', () => {
		const r = chordKey(armed, key("1"), true, 1000 + CHORD_WINDOW_MS + 1);
		expect(r.state.armed).toBe(false);
		expect(r.action.type).toBe('disarm');
	});

	it('any other key disarms; idle state passes non-S keys through untouched', () => {
		const r = chordKey(armed, key("Escape"), true, 1200);
		expect(r.action.type).toBe('disarm');
		const r2 = chordKey(IDLE_CHORD, key("a"), true, 1200);
		expect(r2).toEqual({ state: IDLE_CHORD, action: { type: "none" } });
	});

	it('Alt+S with ctrl/meta never arms (browser verbs own those)', () => {
		const r = chordKey(IDLE_CHORD, key("s", { altKey: true, ctrlKey: true, type: "keyup" }), true, 1000);
		expect(r.state.armed).toBe(false);
	});

	it('Alt+S keydown with ctrl or meta never arms either (browser verbs)', () => {
		const rc = chordKey(IDLE_CHORD, key("s", { altKey: true, ctrlKey: true, type: "keydown" }), true, 1000);
		const rm = chordKey(IDLE_CHORD, key("s", { altKey: true, metaKey: true, type: "keydown" }), true, 1000);
		expect(rc.state.armed).toBe(false);
		expect(rc.action.type).toBe('none');
		expect(rm.state.armed).toBe(false);
	});

	it('a bare digit key with no code still fires via the key fallback', () => {
		const r = chordKey(armed, { key: "7", altKey: false, ctrlKey: false, metaKey: false, type: "keydown" }, true, 1500);
		expect(r.action).toEqual({ type: "apply", n: 7 });
		expect(r.state).toEqual(IDLE_CHORD);
	});

	it('keyup inside the window never fires or disarms the armed chord', () => {
		const r = chordKey(armed, key("1", { type: "keyup" }), true, 1500);
		expect(r).toEqual({ state: armed, action: { type: "none" } });
	});
});

describe("hasAnyPreset (arm gate)", () => {
	it('is true when any single lane carries a preset', () => {
		expect(hasAnyPreset({ agent: { 1: 660 }, glass: {}, sidebar: {} })).toBe(true);
		expect(hasAnyPreset({ agent: {}, glass: { 2: 800 }, sidebar: {} })).toBe(true);
		expect(hasAnyPreset({ agent: {}, glass: {}, sidebar: { 1: { state: 'collapse' } } })).toBe(true);
		expect(hasAnyPreset({ agent: {}, glass: {}, sidebar: {}, zoom: { 1: 80 } })).toBe(true);
	});
	it('is false when every lane is empty and zoom is absent', () => {
		expect(hasAnyPreset({ agent: {}, glass: {}, sidebar: {} })).toBe(false);
		expect(hasAnyPreset({ agent: {}, glass: {}, sidebar: {}, zoom: {} })).toBe(false);
	});
});

describe("isEditableTarget (AC 4)", () => {
	it('gates inputs and contenteditables, passes the floor', () => {
		const input = document.createElement("input");
		const div = document.createElement("div");
		expect(isEditableTarget(input)).toBe(true);
		expect(isEditableTarget(div)).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});
});

describe("chordKey verbs + chordOptions + decideChordKeydown (Chord Palette, 2026-10-31)", () => {
	const armed = { armed: true, since: 1000 };

	it('each verb letter inside the window fires its verb and disarms', () => {
		for (const v of ['a', 'b', 'c', 'g', 'k', 'n', 'p', 's', 't', 'w'] as const) {
			const r = chordKey(armed, key(v), true, 1200);
			expect(r.action).toEqual({ type: 'verb', verb: v });
			expect(r.state).toEqual(IDLE_CHORD);
		}
	});

	it('verb via e.code survives an Alt-style remapped key (physical identity)', () => {
		const r = chordKey(armed, { key: '∫', code: 'KeyB', altKey: true, ctrlKey: false, metaKey: false, type: 'keydown' }, true, 1200);
		expect(r.action).toEqual({ type: 'verb', verb: 'b' });
	});

	it('a dead key disarms; keyup never fires a verb', () => {
		expect(chordKey(armed, key('q'), true, 1200).action).toEqual({ type: 'disarm' });
		expect(chordKey(armed, key('b', { type: 'keyup' }), true, 1200).action).toEqual({ type: 'none' });
	});

	it('digits keep precedence over verbs', () => {
		expect(chordKey(armed, key('1'), true, 1200).action).toEqual({ type: 'apply', n: 1 });
	});

	it('chordOptions: digits only when a preset lane has the slot; verbs only when live', () => {
		const rows = chordOptions({ presets: { agent: { 2: 808 }, glass: {}, sidebar: {} }, panelKinds: ['browser', 'terminal'], subagentCount: 0, focusedConversation: true });
		expect(rows.map((r) => r.key)).toEqual(['2', 'a', 'b', 'g', 'k', 'n', 'p', 's', 't']);
		const none = chordOptions({ presets: { agent: {}, glass: {}, sidebar: {} }, panelKinds: [], subagentCount: 0, focusedConversation: false });
		expect(none.map((r) => r.key)).toEqual(['g', 'k', 'p', 's', 't']); // D4: digits absent; g/k/p/s/t always live; n needs a focused conversation
		const cAll = chordOptions({ presets: { agent: {}, glass: {}, sidebar: {}, zoom: {} }, panelKinds: ['settings-home', 'skill-shelf', 'plugin-rack', 'workspace-explorer'], subagentCount: 2, focusedConversation: true });
		expect(cAll.map((r) => r.key)).toEqual(['a', 'c', 'g', 'k', 'n', 'p', 's', 't', 'w']);
	});

	it('decideChordKeydown: Alt+S on any target preventDefaults and arms (D12/D13)', () => {
		const r = decideChordKeydown(IDLE_CHORD, key('s', { altKey: true }), true, 1000);
		expect(r.preventDefault).toBe(true);
		expect(r.state.armed).toBe(true);
	});

	it('decideChordKeydown: armed next key is swallowed even at an editable target (AC2)', () => {
		const r = decideChordKeydown(armed, key('b'), true, 1200);
		expect(r.preventDefault).toBe(true);
		expect(r.action).toEqual({ type: 'verb', verb: 'b' });
	});

	it('decideChordKeydown: un-armed digit passes untouched (old AC4 preserved)', () => {
		const r = decideChordKeydown(IDLE_CHORD, key('1'), true, 1000);
		expect(r).toEqual({ state: IDLE_CHORD, action: { type: 'none' }, preventDefault: false });
	});

	it('decideChordKeydown: keyup passes through untouched (D1)', () => {
		const r = decideChordKeydown(armed, key('s', { altKey: true, type: 'keyup' }), true, 1000);
		expect(r.preventDefault).toBe(false);
		expect(r.action).toEqual({ type: 'none' });
	});
});

describe("applyWidthPreset (floor applier, T2.2-T)", () => {
	beforeEach(() => resetFloorState());
	afterEach(() => disposeFloorGestures());

	it('snaps every lane by kind, leaves fixed lanes, follows the preset', () => {
		const preset = vi.fn();
		configureFloorRegistry({
			getLineageFacts: () => ({ parentOf: new Map(), childrenByParent: new Map(), depthById: new Map(), runningDescendants: new Map(), subagentIds: new Set(), familyIds: new Set() }),
			getMoveFacts: () => ({ parentOf: new Map() }),
			getWorkspaceFor: () => null,
			ensureCold: async () => {},
			rememberEdge: () => {},
			getPanelWidth: () => 480,
			setPanelWidthPreset: preset,
			setTreePct: () => {},
			getSettingsHomes: () => ({ dsi: "/h/.dsi", dsh: "/h/.dsh" }),
			applyTerminalDeskAction: () => {}
		});
		const agent1 = makePanel("s1", null);
		const agent2 = makePanel("s2", null);
		const glass = makeBrowserPanel(700, "s1");
		const explorer = makeWorkspaceExplorerPanel("s1", "/r");
		initFloor([agent1, agent2, glass, explorer], agent1.id);

		applyWidthPreset(660, 530);
		const conv = floor.panels.filter((p) => p.kind === "conversation");
		const br = floor.panels.filter((p) => p.kind === "browser");
		expect(conv.map((p) => p.width)).toEqual([660, 660]);
		expect(br.map((p) => p.width)).toEqual([530]);
		expect((floor.panels[3] as { width: number }).width).not.toBe(660); // fixed lane
		expect(preset).toHaveBeenCalledWith(660);
	});

	it('an undefined lane keeps its panels untouched (partial presets)', () => {
		configureFloorRegistry({
			getLineageFacts: () => ({ parentOf: new Map(), childrenByParent: new Map(), depthById: new Map(), runningDescendants: new Map(), subagentIds: new Set(), familyIds: new Set() }),
			getMoveFacts: () => ({ parentOf: new Map() }),
			getWorkspaceFor: () => null,
			ensureCold: async () => {},
			rememberEdge: () => {},
			getPanelWidth: () => 480,
			setPanelWidthPreset: () => {},
			setTreePct: () => {},
			getSettingsHomes: () => ({ dsi: "/h/.dsi", dsh: "/h/.dsh" }),
			applyTerminalDeskAction: () => {}
		});
		const agent = makePanel("s1", null);
		const glass = makeBrowserPanel(700, "s1");
		initFloor([agent, glass], agent.id);
		applyWidthPreset(660);
		expect(floor.panels[0].width).toBe(660);
		expect(floor.panels[1].width).toBe(700); // untouched
	});
});

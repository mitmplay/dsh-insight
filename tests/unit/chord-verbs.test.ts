/**
 * Chord verb dispatch against the SEEDED floor registry (Chord Palette
 * 2026-10-31, Tasks 4.1-T / 4.2-T). The route's dispatchChordVerb is a
 * thin switch over these same registry verbs — here the verbs are pinned
 * through the registry exactly as the route calls them (ADR-0006a
 * amendment D15: removePanel / doAdd, never direct mutation).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
	configureFloorRegistry,
	disposeFloorGestures,
	doAdd,
	floor,
	initFloor,
	makeBrowserPanel,
	makeManagerPanel,
	makePanel,
	makePluginRackPanel,
	makeSkillShelfPanel,
	makeTerminalPanel,
	makeWorkspaceExplorerPanel,
	removePanel,
	resetFloorState
} from '$lib/services/panels/floor-registry.svelte';

function configure(subagentIds: Set<string> = new Set()): void {
	configureFloorRegistry({
		getLineageFacts: () => ({ parentOf: new Map(), childrenByParent: new Map(), depthById: new Map(), runningDescendants: new Map(), subagentIds, familyIds: new Set() }),
		getMoveFacts: () => ({ parentOf: new Map() }),
		getWorkspaceFor: () => null,
		ensureCold: async () => {},
		rememberEdge: () => {},
		getPanelWidth: () => 480,
		setPanelWidthPreset: () => {},
		setTreePct: () => {},
		getSettingsHomes: () => ({ dsi: '/h/.dsi', dsh: '/h/.dsh' }),
		applyTerminalDeskAction: () => {}
	});
}
const kinds = () => floor.panels.map((p) => p.kind).sort();
const settingsHome = () => ({ id: 'set-home', kind: 'settings-home', home: 'dsi' } as never);

describe('chord verb dispatch facts (D15)', () => {
	beforeEach(() => resetFloorState());
	afterEach(() => disposeFloorGestures());

	it('verb a: terminals + subagent conversations close; main conversations survive; sub-agent glass dies by cascade', () => {
		const subagents = new Set(['sub1']);
		configure(subagents);
		const main = makePanel('main1', null);
		const sub = makePanel('sub1', null);
		const glass = makeBrowserPanel(530, 'sub1', 'g1'); // openedBy the sub-agent
		const glassMain = makeBrowserPanel(530, 'main1', 'g2'); // openedBy main — survives
		const term = makeTerminalPanel();
		initFloor([main, sub, glass, glassMain, term], main.id);
		// the a sweep: exactly what dispatchChordVerb does
		for (const p of [...floor.panels]) {
			if (p.kind === 'terminal') removePanel(p.id);
			else if (p.kind === 'conversation' && subagents.has(p.sessionId)) removePanel(p.id);
		}
		expect(kinds()).toEqual(['browser', 'conversation']);
		expect(floor.panels.some((p) => p.kind === 'conversation' && p.sessionId === 'main1')).toBe(true);
		expect(floor.panels.some((p) => p.kind === 'browser' && p.browserSessionId === 'g2')).toBe(true);
	});

	// D22 (2026-11-01): the agent-extras sweep also takes the config shelf.
	it('verb a: the sweep takes plugin-rack and skill-shelf alongside terminals and explorers (D22)', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main, makePluginRackPanel(), makeSkillShelfPanel(), makeWorkspaceExplorerPanel('main1', '/r')], main.id);
		for (const p of [...floor.panels]) {
			if (['terminal', 'workspace-explorer', 'plugin-rack', 'skill-shelf'].includes(p.kind)) removePanel(p.id);
		}
		expect(kinds()).toEqual(['conversation']);
	});

	it('verb b: every browser closes, others untouched', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main, makeBrowserPanel(530, 'main1', 'g1'), makeBrowserPanel(530, 'main1', 'g2'), makeTerminalPanel()], main.id);
		for (const p of [...floor.panels]) if (p.kind === 'browser') removePanel(p.id);
		expect(kinds()).toEqual(['conversation', 'terminal']);
	});

	it('verb c: the config-explorer sweep takes settings-home, skill-shelf, plugin-rack', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main, settingsHome(), makeSkillShelfPanel(), makePluginRackPanel(), makeManagerPanel()], main.id);
		for (const p of [...floor.panels]) if (['settings-home', 'skill-shelf', 'plugin-rack'].includes(p.kind)) removePanel(p.id);
		expect(kinds()).toEqual(['conversation', 'prompt-manager']);
	});

	it('verb w: workspace explorers close', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main, makeWorkspaceExplorerPanel('main1', '/r')], main.id);
		for (const p of [...floor.panels]) if (p.kind === 'workspace-explorer') removePanel(p.id);
		expect(kinds()).toEqual(['conversation']);
	});

	it('verbs p and t toggle: close-when-open, add-when-absent (dedupe-to-focus add path)', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main, makeManagerPanel()], main.id);
		// p with a manager open closes it...
		const open = floor.panels.find((p) => p.kind === 'prompt-manager');
		if (open) removePanel(open.id);
		expect(floor.panels.some((p) => p.kind === 'prompt-manager')).toBe(false);
		// ...and p with none open re-adds through the SAME request the route uses
		const spy = vi.spyOn({ doAdd }, 'doAdd');
		const none = floor.panels.find((p) => p.kind === 'prompt-manager');
		if (!none) doAdd({ kind: 'prompt-manager' });
		expect(floor.panels.some((p) => p.kind === 'prompt-manager')).toBe(true);
		spy.mockRestore();
		// t adds a terminal when absent
		for (const p of [...floor.panels]) if (p.kind === 'terminal') removePanel(p.id);
		if (!floor.panels.find((p) => p.kind === 'terminal')) doAdd({ kind: 'terminal' });
		expect(floor.panels.some((p) => p.kind === 'terminal')).toBe(true);
	});

	it('verbs g and k toggle: close-when-open, add-when-absent (D23/D24, dedupe-to-focus add path)', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main], main.id);
		// g with no rack open adds one through the SAME request the route uses
		if (!floor.panels.find((p) => p.kind === 'plugin-rack')) doAdd({ kind: 'plugin-rack' });
		expect(floor.panels.some((p) => p.kind === 'plugin-rack')).toBe(true);
		// ...and g with the rack open closes it
		const rack = floor.panels.find((p) => p.kind === 'plugin-rack');
		if (rack) removePanel(rack.id);
		expect(floor.panels.some((p) => p.kind === 'plugin-rack')).toBe(false);
		// k adds a skill shelf when absent
		if (!floor.panels.find((p) => p.kind === 'skill-shelf')) doAdd({ kind: 'skill-shelf' });
		expect(floor.panels.some((p) => p.kind === 'skill-shelf')).toBe(true);
		const shelf = floor.panels.find((p) => p.kind === 'skill-shelf');
		if (shelf) removePanel(shelf.id);
		expect(floor.panels.some((p) => p.kind === 'skill-shelf')).toBe(false);
	});

	it('a verb with zero live targets is a silent no-op', () => {
		configure();
		const main = makePanel('main1', null);
		initFloor([main], main.id);
		const before = floor.panels.length;
		for (const p of [...floor.panels]) if (p.kind === 'browser') removePanel(p.id);
		expect(floor.panels).toHaveLength(before);
	});
});

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
import { deriveLineage, familyRenderOrder, type FamilyMember } from '$lib/services/lineage/lineage';
import { moveFactsFrom } from '$lib/services/lineage/lineage-move';
import {
	ghostPanelRowsFor,
	openSessionIdsOf,
	panelRowsFor
} from '$lib/services/panels/panel-rows';
import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
import type { DsiSessionSummary } from '$lib/types';

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

/**
 * ADR-0085 (2026-11-25) — the chord's n verb births a STANDALONE session.
 * The route's add request carries NO afterSessionId (D1), so doAdd's plain
 * branch falls through to insertionSlot() — The Focused Slot (2026-08-31),
 * left of the focus, climbing to the family head when a sub-agent is
 * focused (D3) — and never remembers an add-time edge (D2). SC#1, the
 * operator report: the as-built request anchored on the focused session, so
 * the newborn landed BETWEEN a parent and its ghost sub-agent, nested in
 * the roster as that parent's child. Expected values are the planner's
 * probe (ADR-0085 §5.3): B, A roots; S a sub-agent of A; S2 a sub-agent of
 * S; the newborn N parentless on the wire.
 */
describe('verb n — the standalone birth (ADR-0085)', () => {
	const row = (sessionId: string, parent: string | null, subagent = false): DsiSessionSummary => ({
		sessionId,
		title: sessionId,
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 0,
		workspace: '/ws/x',
		turns: null,
		parentSessionId: parent,
		origin: subagent ? 'subagent' : null
	});
	/** B, A roots; S a sub-agent of A; S2 a sub-agent of S when nested. */
	const spine = (nested: boolean): DsiSessionSummary[] => [
		row('B', null),
		row('A', null),
		row('S', 'A', true),
		...(nested ? [row('S2', 'S', true)] : [])
	];
	const sessions = () => floor.panels.map((p) => (p.kind === 'conversation' ? p.sessionId : p.kind));

	/** The registry over REAL lineage facts — the same derivations the
	 *  floor reads feed the roster — plus a rememberEdge spy in the seam. */
	function install(spineRows: DsiSessionSummary[]) {
		const facts = deriveLineage(spineRows);
		const rememberEdge = vi.fn();
		configureFloorRegistry({
			getLineageFacts: () => facts,
			getMoveFacts: () => moveFactsFrom(facts, openSessionIdsOf(floor.panels)),
			getWorkspaceFor: () => null,
			ensureCold: async () => {},
			rememberEdge,
			getPanelWidth: () => 480,
			setPanelWidthPreset: () => {},
			setTreePct: () => {},
			getSettingsHomes: () => ({ dsi: '/h/.dsi', dsh: '/h/.dsh' }),
			applyTerminalDeskAction: () => {}
		});
		return { rememberEdge };
	}

	/** Row facts + ghosts over the current floor, the roster's own inputs
	 *  (edgeCache = what pageFeeds.rememberEdge would have written). */
	function rowInputs(spineRows: DsiSessionSummary[], edgeCache: Record<string, string> = {}) {
		const facts = deriveLineage(spineRows);
		return {
			panels: floor.panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache,
			lineageFacts: facts,
			moveFacts: moveFactsFrom(facts, openSessionIdsOf(floor.panels))
		};
	}
	/** The sidebar's render order, adapted exactly as SidebarSessionOpen does
	 *  (id = sessionId, parent = parentSessionId, order = siblingIndex);
	 *  `~` marks a ghost row. */
	function roster(spineRows: DsiSessionSummary[], edgeCache: Record<string, string> = {}): string[] {
		const input = rowInputs(spineRows, edgeCache);
		const member = (r: PanelRow): FamilyMember => ({
			id: r.panel.kind === 'conversation' ? r.panel.sessionId : r.panel.id,
			parent: r.parentSessionId ?? null,
			order: r.siblingIndex
		});
		return familyRenderOrder(panelRowsFor(input).map(member), ghostPanelRowsFor(input).map(member)).map(
			(e) => (e.kind === 'panel' ? e.member.id : `~${e.member.id}`)
		);
	}

	beforeEach(() => resetFloorState());
	afterEach(() => disposeFloorGestures());

	it('(a) a main session focused: the newborn lands BEFORE it, the ghost stays under its parent, no edge is remembered', () => {
		const { rememberEdge } = install(spine(false));
		const B = makePanel('B', null);
		const A = makePanel('A', null);
		initFloor([B, A], A.id);
		doAdd({ sessionId: 'N', agentPreset: null, focus: true });
		expect(sessions()).toEqual(['B', 'N', 'A']);
		expect(rememberEdge).not.toHaveBeenCalled();
		expect(roster(spine(false))).toEqual(['B', 'N', 'A', '~S']); // ~S nests under A, never under N
		const newborn = panelRowsFor(rowInputs(spine(false))).find((r) => r.panel.id === floor.selectedPanelId);
		expect(newborn?.panel).toMatchObject({ kind: 'conversation', sessionId: 'N' }); // the newcomer is selected
		expect(newborn?.parentSessionId).toBe(null);
		expect(newborn?.fork).toBe(false);
		expect(newborn?.depth).toBe(0);
	});

	it('(b) a sub-agent focused: the newborn lands before the whole family (its head), not between the head and its child', () => {
		const { rememberEdge } = install(spine(false));
		const B = makePanel('B', null);
		const A = makePanel('A', null);
		const S = makePanel('S', null);
		initFloor([B, A, S], S.id);
		doAdd({ sessionId: 'N', agentPreset: null, focus: true });
		expect(sessions()).toEqual(['B', 'N', 'A', 'S']);
		expect(rememberEdge).not.toHaveBeenCalled();
		expect(roster(spine(false))).toEqual(['B', 'N', 'A', 'S']);
	});

	it('(c) a nested sub-agent focused: the climb is to the FAMILY HEAD, not one hop', () => {
		const { rememberEdge } = install(spine(true));
		const B = makePanel('B', null);
		const A = makePanel('A', null);
		const S = makePanel('S', null);
		const S2 = makePanel('S2', null);
		initFloor([B, A, S, S2], S2.id);
		doAdd({ sessionId: 'N', agentPreset: null, focus: true });
		expect(sessions()).toEqual(['B', 'N', 'A', 'S', 'S2']);
		expect(rememberEdge).not.toHaveBeenCalled();
		expect(roster(spine(true))).toEqual(['B', 'N', 'A', 'S', 'S2']);
	});

	it('(d) an orphan sub-agent focused (its spawner off the floor): it is its own head', () => {
		const { rememberEdge } = install(spine(false));
		const B = makePanel('B', null);
		const S = makePanel('S', null);
		initFloor([B, S], S.id);
		doAdd({ sessionId: 'N', agentPreset: null, focus: true });
		expect(sessions()).toEqual(['B', 'N', 'S']);
		expect(rememberEdge).not.toHaveBeenCalled();
		// S's spawner A holds no panel, so no ghost roots under an open panel
		expect(roster(spine(false))).toEqual(['B', 'N', 'S']);
	});

	it("(control) the AS-BUILT anchored request reproduces SC#1 — this is the bug the route's anchor was feeding", () => {
		const { rememberEdge } = install(spine(false));
		const B = makePanel('B', null);
		const A = makePanel('A', null);
		initFloor([B, A], A.id);
		// the pre-ADR-0085 route shape: afterSessionId = the focused session
		doAdd({ sessionId: 'N', agentPreset: null, afterSessionId: 'A', focus: true });
		expect(sessions()).toEqual(['B', 'A', 'N']); // past A's panel unit
		expect(rememberEdge).toHaveBeenCalledExactlyOnceWith('N', 'A'); // a family the host never recorded
		// with that edge in the cache the roster nests N as A's child, ABOVE A's ghost
		expect(roster(spine(false), { N: 'A' })).toEqual(['B', 'A', 'N', '~S']);
		const tied = panelRowsFor(rowInputs(spine(false), { N: 'A' })).find((r) => r.panel.id === floor.selectedPanelId);
		expect(tied?.parentSessionId).toBe('A');
		expect(tied?.fork).toBe(true); // the fake tie paints as a fork
	});
});

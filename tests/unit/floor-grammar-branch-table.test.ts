/**
 * grammar.ts branch-table tests (ADR-0022 sweep coverage mop) — the add /
 * replace / move grammar's remaining arms, table-driven where the shape
 * repeats: every singleton kind's anchor/miss insert ladder, the
 * injected-doc successor-swap, and the doSwapInto freed-slot arms
 * (pinned / adopt-family). Pure module — fake deps via
 * configureFloorRegistry, same fixtures as floor-registry.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	configureFloorRegistry,
	doAdd,
	doReplacePanel,
	doReplacePanelBySession,
	doReplaceSelected,
	doSwapInto,
	floor,
	initFloor,
	makeManagerPanel,
	openLoupe,
	makePanel,
	makePluginRackPanel,
	makeSkillShelfPanel,
	makeTerminalPanel,
	resetFloorState
} from '$lib/services/panels/floor-registry.svelte';
import type { DsiConversationPanel, DsiPanelEntry } from '$lib/types';
import type { LineageFacts } from '$lib/services/lineage/lineage';
import type { MoveFacts } from '$lib/services/lineage/lineage-move';

function lineageOf(children: Record<string, string[]>): LineageFacts {
	return {
		childrenByParent: new Map(
			Object.entries(children).map(([k, v]) => [
				k,
				v.map((sid) => ({
					sessionId: sid,
					title: sid,
					agentPreset: null,
					parentSessionId: k,
					running: false,
					workspace: null
				}))
			])
		),
		depthById: new Map(),
		runningDescendants: new Map(),
		subagentIds: new Set(Object.values(children).flat()),
		familyIds: new Set(Object.values(children).flat())
	} as unknown as LineageFacts;
}

interface DepsOverrides {
	children?: Record<string, string[]>;
	ensureCold?: (sid: string) => Promise<void>;
	rememberEdge?: (child: string, parent: string) => void;
	applyTerminalDeskAction?: (a: 'new-tab' | 'split-down') => void;
}

function installDeps(o: DepsOverrides = {}): void {
	const lineage = lineageOf(o.children ?? {});
	const move: MoveFacts = { parentOf: new Map() };
	configureFloorRegistry({
		getLineageFacts: () => lineage,
		getMoveFacts: () => move,
		getWorkspaceFor: () => null,
		ensureCold: o.ensureCold ?? (async () => {}),
		rememberEdge: o.rememberEdge ?? (() => {}),
		getPanelWidth: () => 480,
		setPanelWidthPreset: () => {},
		setTreePct: () => {},
		getSettingsHomes: () => ({ dsi: '/h/.dsi', dsh: '/h/.dsh' }),
		applyTerminalDeskAction: o.applyTerminalDeskAction ?? (() => {})
	});
}

const conv = (sessionId: string): DsiPanelEntry => makePanel(sessionId, null);

/** sessionId lives only on the conversation branch of the union (D6). */
const sessionIdOf = (p: DsiPanelEntry): string | null | undefined =>
	(p as Partial<DsiConversationPanel>).sessionId;

beforeEach(() => {
	resetFloorState();
	installDeps();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('doAdd — singleton-kind insert ladder (anchor arms)', () => {
	const cases: { name: string; req: () => Record<string, unknown>; expectKind: string }[] = [
		{ name: 'settings-home', req: () => ({ kind: 'settings-home', home: 'dsh' }), expectKind: 'workspace-explorer' },
		{ name: 'terminal', req: () => ({ kind: 'terminal' }), expectKind: 'terminal' },
		{ name: 'prompt-manager', req: () => ({ kind: 'prompt-manager' }), expectKind: 'prompt-manager' },
		{ name: 'skill-shelf', req: () => ({ kind: 'skill-shelf' }), expectKind: 'skill-shelf' },
		{ name: 'plugin-rack', req: () => ({ kind: 'plugin-rack' }), expectKind: 'plugin-rack' }
	];

	for (const c of cases) {
		it(c.name + ': afterSessionId anchor found -> lands directly right of the anchor', () => {
			initFloor([conv('a')], 'panel-1');
			doAdd({ ...c.req(), afterSessionId: 'a' } as never);
			const kinds = floor.panels.map((p) => p.kind);
			expect(kinds).toEqual(['conversation', c.expectKind]);
			expect(floor.selectedPanelId).toBe(floor.panels[1].id);
		});

		it(c.name + ': afterSessionId miss -> focused-slot fallback, BEFORE the focused panel', () => {
			initFloor([conv('a')], 'panel-1');
			doAdd({ ...c.req(), afterSessionId: 'ghost' } as never);
			expect(floor.panels.length).toBe(2);
			expect(floor.panels[0].kind).toBe(c.expectKind);
		});
	}

	it('settings-home: no anchor at all -> focused-slot fallback', () => {
		initFloor([conv('a')], 'panel-1');
		doAdd({ kind: 'settings-home', home: 'dsi' } as never);
		expect(floor.panels.map((p) => p.kind)).toEqual(['workspace-explorer', 'conversation']);
		expect((floor.panels[0] as { home?: string }).home).toBe('dsi');
	});

	it('terminal: action rides to the desk even on the INSERT path (no open desk)', () => {
		const desk = vi.fn();
		installDeps({ applyTerminalDeskAction: desk });
		initFloor([conv('a')], 'panel-1');
		doAdd({ kind: 'terminal', action: 'split-down' } as never);
		expect(desk).toHaveBeenCalledExactlyOnceWith('split-down');
		expect(floor.panels.map((p) => p.kind)).toEqual(['terminal', 'conversation']);
	});
});

describe('doAdd — conversation placement residual arms', () => {
	it('after-source with the source OFF the floor falls back to the default slot', () => {
		const rememberEdge = vi.fn();
		installDeps({ rememberEdge });
		initFloor([conv('a')], 'panel-1');
		doAdd({ kind: 'conversation', sessionId: 'f1', afterSessionId: 'ghost' } as never);
		expect(floor.panels.length).toBe(2);
		expect(rememberEdge).toHaveBeenCalledExactlyOnceWith('f1', 'ghost');
	});

	it('keepSelection with NOTHING selected before the insert keeps nothing (null guard)', () => {
		initFloor([conv('a')], null);
		doAdd({ kind: 'conversation', sessionId: 'b', keepSelection: true, afterSessionId: 'a' } as never);
		// selectionBefore === null -> the guard declines; the newcomer stays selected
		expect(floor.selectedPanelId).toBe(floor.panels[1].id);
	});
});

describe('doReplacePanel — injected-doc successor-swap (Loadinjected D4/D5)', () => {
	it('swap keeps the slot width, mints a fresh id, selects, clears a doomed loupe', () => {
		const a = conv('a');
		initFloor([{ ...a, width: 700 }], a.id);
		openLoupe(a.id);
		doReplacePanel(a.id, { kind: 'injected-doc', sourceSessionId: 'a', displayPath: 'x.md' } as never);
		expect(floor.panels[0].kind).toBe('injected-doc');
		expect(floor.panels[0].width).toBe(700);
		expect(floor.selectedPanelId).toBe(floor.panels[0].id);
		expect(floor.loupePanelId).toBeNull(); // the old id died -> loupe cleared
	});

	it('a second /loadinjected with the SAME (source, path) dedupes to focus', () => {
		const a = conv('a');
		initFloor([a], a.id);
		doReplacePanel(a.id, { kind: 'injected-doc', sourceSessionId: 'a', displayPath: 'x.md' } as never);
		const docId = floor.panels[0].id;
		doReplacePanel(a.id, { kind: 'injected-doc', sourceSessionId: 'a', displayPath: 'x.md' } as never);
		expect(floor.panels[0].id).toBe(docId);
		expect(floor.selectedPanelId).toBe(docId);
	});

	it('every retired successor-swap kind is an honest no-op', () => {
		const a = conv('a');
		initFloor([a], a.id);
		for (const kind of ['terminal', 'prompt-manager', 'settings-home', 'skill-shelf', 'plugin-rack']) {
			doReplacePanel(a.id, { kind } as never);
			expect(floor.panels.map((p) => p.id)).toEqual([a.id]);
		}
	});
});

describe('doReplaceSelected — selection arms', () => {
	it('a null selection with panels on the floor replaces index 0', () => {
		const a = conv('a');
		initFloor([a, conv('b')], null);
		doReplaceSelected({ kind: 'conversation', sessionId: 'c' } as never);
		expect(sessionIdOf(floor.panels[0])).toBe('c');
	});

	it('a live selection replaces the SELECTED panel', () => {
		const a = conv('a');
		const b = conv('b');
		initFloor([a, b], b.id);
		doReplaceSelected({ kind: 'conversation', sessionId: 'c' } as never);
		expect(sessionIdOf(floor.panels[1])).toBe('c');
	});
});

describe('doSwapInto — freed-slot arms', () => {
	it('pinned: freeing a NON-parent slot still pins the child below its spawner', () => {
		const a = conv('a');
		const t = makeTerminalPanel();
		initFloor([a, t], t.id);
		installDeps({ children: { a: ['sub1'] } });
		doSwapInto(t.id, 1, { kind: 'conversation', sessionId: 'sub1', focus: true } as never);
		expect(floor.panels.map((p) => p.kind)).toEqual(['conversation', 'conversation']);
		expect(sessionIdOf(floor.panels[1])).toBe('sub1');
		expect(floor.focusComposerId).toBe(floor.panels[1].id);
	});

	it('adopt-family: replacing with a sub-agent whose spawner is OFF the floor brings the parent in', () => {
		const cold = vi.fn(async () => {});
		installDeps({ children: { ghost: ['sub9'] }, ensureCold: cold });
		const x = conv('x');
		initFloor([{ ...x, width: 700 }], x.id);
		doSwapInto(x.id, 0, { kind: 'conversation', sessionId: 'sub9' } as never);
		expect(floor.panels.map(sessionIdOf)).toEqual(['ghost', 'sub9']);
		expect(floor.panels[0].width).toBe(480); // the parent is MINTED fresh (dep width), slot width not inherited
		expect(cold).toHaveBeenCalledWith('ghost');
		expect(cold).toHaveBeenCalledWith('sub9');
	});
});

describe('doReplacePanelBySession — manager-kind guard table', () => {
	it.each(['terminal', 'prompt-manager', 'settings-home', 'injected-doc', 'skill-shelf', 'plugin-rack'] as const)(
		'%s -> false without touching the floor',
		(kind) => {
			const a = conv('a');
			initFloor([a], a.id);
			expect(doReplacePanelBySession('a', { kind } as never)).toBe(false);
			expect(floor.panels.map((p) => p.id)).toEqual([a.id]);
		}
	);

	it('a conversation successor that EQUALS the addressed session short-circuits true', () => {
		const a = conv('a');
		const m = makeManagerPanel();
		initFloor([a, m], a.id);
		expect(doReplacePanelBySession('a', { kind: 'conversation', sessionId: 'a' } as never)).toBe(true);
		expect(floor.panels.map((p) => p.id)).toEqual([a.id, m.id]);
	});
});

describe('doAdd — shelf/rack reload tokens on the INSERT path', () => {
	it('reload:true with NO open shelf just inserts (nothing to bump)', () => {
		initFloor([conv('a')], 'panel-1');
		doAdd({ kind: 'skill-shelf', reload: true } as never);
		expect(floor.panels[0].kind).toBe('skill-shelf');
		expect((floor.panels[0] as { refresh?: number }).refresh).toBeUndefined();
	});

	it('plugin-rack first insert then reload bumps the token exactly once', () => {
		initFloor([], null);
		doAdd({ kind: 'plugin-rack' } as never);
		doAdd({ kind: 'plugin-rack', reload: true } as never);
		expect(floor.panels.length).toBe(1);
		expect((floor.panels[0] as { refresh?: number }).refresh).toBe(1);
	});

	it('shelf reload:false dedupe focuses without bumping', () => {
		const s = makeSkillShelfPanel();
		initFloor([s], s.id);
		doAdd({ kind: 'skill-shelf', reload: false } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.selectedPanelId).toBe(s.id);
		expect((floor.panels[0] as { refresh?: number }).refresh).toBeUndefined();
	});

	it('rack focus without reload keeps selection and token', () => {
		const r = makePluginRackPanel();
		initFloor([r], r.id);
		doAdd({ kind: 'plugin-rack' } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.selectedPanelId).toBe(r.id);
	});
});

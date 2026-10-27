/**
 * Floor Registry unit tests (ADR-0019 W1, Tasks.md T1.1-T / T1.2-T) —
 * the floor's mutator machine exercised as plain modules with fake
 * deps installed through configureFloorRegistry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	activateExplorerTab,
	clearFocusComposer,
	clearLoupeIfGone,
	closeExplorerTab,
	closeLoupe,
	collapseExplorerPaths,
	collapseExplorerRepos,
	configureFloorRegistry,
	consumeFileIntent,
	disposeFloorGestures,
	doAdd,
	doMovePanel,
	doReplacePanel,
	doReplacePanelBySession,
	doReplaceSelected,
	doStartPanelResize,
	doSwapInto,
	floor,
	initFloor,
	insertPanel,
	makePanel,
	makeSettingsHomePanel,
	makePluginRackPanel,
	makeSkillShelfPanel,
	makeTerminalPanel,
	makeWorkspaceExplorerPanel,
	nextPanelId,
	onPanelWindowMouseMove,
	onPanelWindowMouseMoveCoalesced,
	onPanelWindowMouseUp,
	openExplorerTab,
	openLoupe,
	openFileLinkFromMarkdown,
	fetchColdFromWire,
	openWorkspaceExplorer,
	openWorkspaceFile,
	pinnedSlotIndex,
	publishFileIntent,
	removePanel,
	resetFloorState,
	resizeAll,
	selectPanel,
	sessionWorkspaceExplorer,
	setExplorerTab,
	setExplorerTreePct,
	setFileView,
	setRackTab,
	setShelfCollapsed,
	setShelfReload,
	setShelfSearch,
	setShelfTab,
	syncPanelIdSeq,
	toggleExplorerPath,
	toggleExplorerRepo
} from '$lib/services/panels/floor-registry.svelte';
import type { DsiPanelEntry, DsiWorkspaceExplorerPanel } from '$lib/types';
import type { LineageFacts } from '$lib/services/lineage/lineage';
import type { MoveFacts } from '$lib/services/lineage/lineage-move';

// ── fixtures ─────────────────────────────────────────────────────────
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
		// every listed child is a sub-agent: replaceTarget gates adopt-family
		// on subagentIds (a fork stands alone — the fork amendment).
		subagentIds: new Set(Object.values(children).flat()),
		familyIds: new Set(Object.values(children).flat())
	} as unknown as LineageFacts;
}

interface DepsOverrides {
	children?: Record<string, string[]>;
	parentOf?: Record<string, string>;
	workspaces?: Record<string, string | null>;
	ensureCold?: (sid: string) => Promise<void>;
	rememberEdge?: (child: string, parent: string) => void;
	setPanelWidthPreset?: (w: number) => void;
	setTreePct?: (pct: number) => void;
	applyTerminalDeskAction?: (a: 'new-tab' | 'split-down') => void;
}

function installDeps(o: DepsOverrides = {}): void {
	const lineage = lineageOf(o.children ?? {});
	const move: MoveFacts = { parentOf: new Map(Object.entries(o.parentOf ?? {})) };
	configureFloorRegistry({
		getLineageFacts: () => lineage,
		getMoveFacts: () => move,
		getWorkspaceFor: (sid) => (o.workspaces ? (o.workspaces[sid] ?? null) : null),
		ensureCold: o.ensureCold ?? (async () => {}),
		rememberEdge: o.rememberEdge ?? (() => {}),
		getPanelWidth: () => 480,
		setPanelWidthPreset: o.setPanelWidthPreset ?? (() => {}),
		setTreePct: o.setTreePct ?? (() => {}),
		getSettingsHomes: () => ({ dsi: '/h/.dsi', dsh: '/h/.dsh' }),
		applyTerminalDeskAction: o.applyTerminalDeskAction ?? (() => {})
	});
}

/** A desk with one conversation panel; returns the panel id. */
function seedDesk(entries: DsiPanelEntry[], selectedId: string | null): void {
	initFloor(entries, selectedId);
}

const conv = (sessionId: string): DsiPanelEntry => makePanel(sessionId, null);
const shelf = (): DsiPanelEntry => makeSkillShelfPanel();
const rack = (): DsiPanelEntry => makePluginRackPanel();
const terminal = (): DsiPanelEntry => makeTerminalPanel();
const explorer = (sessionId: string | null, root: string): DsiWorkspaceExplorerPanel =>
	makeWorkspaceExplorerPanel(sessionId ?? 'x', root);

beforeEach(() => {
	resetFloorState();
	installDeps();
});
afterEach(() => {
	disposeFloorGestures();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// ── factories + id sequence ──────────────────────────────────────────
describe('factories and id sequence', () => {
	it('makePanel mints fresh monotonic ids and clamps the dep width', () => {
		const a = makePanel('s1', 'agent-a');
		const b = makePanel('s2', null);
		expect(a.id).toMatch(/^panel-\d+$/);
		expect(Number(a.id.slice(6)) + 1).toBe(Number(b.id.slice(6)));
		expect(a.kind).toBe('conversation');
		expect(a.agentPreset).toBe('agent-a');
		expect(a.width).toBe(480);
	});

	it('syncPanelIdSeq pushes the sequence past every restored id (duplicate-key crash fix)', () => {
		resetFloorState();
		installDeps();
		syncPanelIdSeq([{ id: 'panel-7', kind: 'terminal', width: 480 } as DsiPanelEntry]);
		const minted = nextPanelId();
		expect(minted).toBe('panel-8');
	});

	it('initFloor installs entries + selection and syncs the sequence', () => {
		const p = conv('s1');
		initFloor([p], p.id);
		expect(floor.panels).toEqual([p]);
		expect(floor.selectedPanelId).toBe(p.id);
		expect(nextPanelId()).toBe('panel-2');
	});
});

// ── insert / select / loupe ──────────────────────────────────────────
describe('insert, select, loupe', () => {
	it('insertPanel splices at the clamped index and selects the newcomer', () => {
		const a = conv('a');
		const b = conv('b');
		initFloor([a, b], a.id);
		const c = conv('c');
		insertPanel(c, 99); // clamped to end
		expect(floor.panels.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
		expect(floor.selectedPanelId).toBe(c.id);
	});

	it('selectPanel ignores unknown ids', () => {
		const a = conv('a');
		initFloor([a], a.id);
		selectPanel('panel-999');
		expect(floor.selectedPanelId).toBe(a.id);
		selectPanel(a.id);
		expect(floor.selectedPanelId).toBe(a.id);
	});

	it('openLoupe aims the lens; closeLoupe dismisses; clearLoupeIfGone self-clears a dead id', () => {
		const a = conv('a');
		initFloor([a], a.id);
		openLoupe('panel-999');
		expect(floor.loupePanelId).toBeNull(); // unknown id never aims
		openLoupe(a.id);
		expect(floor.loupePanelId).toBe(a.id);
		closeLoupe();
		expect(floor.loupePanelId).toBeNull();
		openLoupe(a.id);
		removePanel(a.id, { family: false });
		expect(floor.loupePanelId).toBeNull(); // clearLoupeIfGone ran inside remove
	});

	it('clearLoupeIfGone keeps a live loupe', () => {
		const a = conv('a');
		initFloor([a], a.id);
		openLoupe(a.id);
		clearLoupeIfGone();
		expect(floor.loupePanelId).toBe(a.id);
	});

	it('clearFocusComposer resets the swap-focus marker', () => {
		clearFocusComposer(); // no state to observe directly; the swap tests set it
		expect(floor.focusComposerId).toBeNull();
	});
});

// ── shelf / rack chrome intents ──────────────────────────────────────
describe('shelf and rack intents', () => {
	it('setShelfTab/Collapsed/Search/Reload write the persisted entry and guard kinds', () => {
		const s = shelf();
		const c = conv('c');
		initFloor([s, c], s.id);
		setShelfTab(s.id, 'uninstall');
		setShelfCollapsed(s.id, ['a/b']);
		setShelfSearch(s.id, 'kube');
		setShelfReload(s.id, { ok: true } as never);
		const saved = floor.panels[0] as typeof s & Record<string, unknown>;
		expect(saved.tab).toBe('uninstall');
		expect(saved.collapsed).toEqual(['a/b']);
		expect(saved.searchQ).toBe('kube');
		expect(saved.reload).toEqual({ ok: true });
		// kind guard: a conversation id is a no-op
		setShelfTab(c.id, 'uninstall');
		expect((floor.panels[1] as { tab?: string }).tab).toBeUndefined();
		// unknown id: no-op
		setShelfTab('panel-999', 'uninstall');
	});

	it('setRackTab writes the rack entry and guards kinds', () => {
		const r = rack();
		initFloor([r], r.id);
		setRackTab(r.id, 'uninstall');
		expect((floor.panels[0] as { tab?: string }).tab).toBe('uninstall');
		setRackTab('panel-999', 'install');
	});
});

// ── explorer / file intents ──────────────────────────────────────────
describe('explorer and file intents', () => {
	function deskWithExplorer() {
		const c = conv('sess');
		const e = explorer('sess', '/repo');
		initFloor([c, e], e.id);
		return { c, e };
	}

	it('toggleExplorerPath adds then removes a path; collapse empties', () => {
		const { e } = deskWithExplorer();
		toggleExplorerPath(e.id, 'src');
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).expanded).toEqual(['src']);
		toggleExplorerPath(e.id, 'src');
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).expanded).toEqual([]);
		collapseExplorerPaths(e.id);
		toggleExplorerPath(e.id, 'a');
		toggleExplorerPath(e.id, 'b');
		collapseExplorerPaths(e.id);
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).expanded).toEqual([]);
	});

	it('setExplorerTab persists the active git tab', () => {
		const { e } = deskWithExplorer();
		setExplorerTab(e.id, 'changes');
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).tab).toBe('changes');
	});

	it('open/close/activate tab lifecycle', () => {
		const { e } = deskWithExplorer();
		openExplorerTab(e.id, 'f1');
		openExplorerTab(e.id, 'f2');
		openExplorerTab(e.id, 'f1'); // dedupe
		let ex = floor.panels[1] as DsiWorkspaceExplorerPanel;
		expect(ex.openTabs).toEqual(['f1', 'f2']);
		expect(ex.activeFile).toBe('f1');
		activateExplorerTab(e.id, 'f2');
		ex = floor.panels[1] as DsiWorkspaceExplorerPanel;
		expect(ex.activeFile).toBe('f2');
		activateExplorerTab(e.id, 'nope'); // not open → no-op
		ex = floor.panels[1] as DsiWorkspaceExplorerPanel;
		expect(ex.activeFile).toBe('f2');
		closeExplorerTab(e.id, 'f2'); // active closes → neighbor left
		ex = floor.panels[1] as DsiWorkspaceExplorerPanel;
		expect(ex.openTabs).toEqual(['f1']);
		expect(ex.activeFile).toBe('f1');
		closeExplorerTab(e.id, 'f1'); // last tab → null
		ex = floor.panels[1] as DsiWorkspaceExplorerPanel;
		expect(ex.openTabs).toEqual([]);
		expect(ex.activeFile).toBeNull();
		closeExplorerTab(e.id, 'ghost'); // never open → no-op
	});

	it('setExplorerTreePct clamps and writes the desk pref', () => {
		const seen: number[] = [];
		installDeps({ setTreePct: (pct) => seen.push(pct) });
		setExplorerTreePct('panel-1', 500);
		expect(seen.length).toBe(1);
		expect(seen[0]).toBeLessThanOrEqual(100); // clampTreePct bounded
	});

	it('toggleExplorerRepo and collapseExplorerRepos persist the collapsed set', () => {
		const { e } = deskWithExplorer();
		toggleExplorerRepo(e.id, 'repoA');
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).collapsedRepos).toEqual(['repoA']);
		toggleExplorerRepo(e.id, 'repoA'); // toggle off
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).collapsedRepos).toEqual([]);
		collapseExplorerRepos(e.id, ['repoB', 'repoC']);
		collapseExplorerRepos(e.id, ['repoB']); // already collapsed, no dupe
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).collapsedRepos).toEqual(['repoB', 'repoC']);
	});

	it('setFileView writes workspace-file entries and guards kinds', () => {
		const c = conv('s');
		const e = explorer('s', '/repo');
		initFloor([c, e], c.id);
		const file: DsiPanelEntry = {
			id: nextPanelId(),
			kind: 'workspace-file',
			sessionId: 's',
			path: 'f.ts',
			explorerPanelId: e.id,
			width: 480
		};
		insertPanel(file, 99);
		setFileView(file.id, 'diff');
		expect((floor.panels.find((p) => p.id === file.id) as { view?: string }).view).toBe('diff');
		setFileView(e.id, 'diff'); // wrong kind → no-op
		expect((floor.panels[1] as DsiWorkspaceExplorerPanel).tab).toBeUndefined();
	});
});

// ── workspace opens + file-intent mailbox ────────────────────────────
describe('workspace opens and file intents', () => {
	it('openWorkspaceExplorer dedupes to focus by ROOT across sessions', () => {
		installDeps({ workspaces: { s1: '/repo', s2: '/repo' } });
		const c1 = conv('s1');
		initFloor([c1], c1.id);
		openWorkspaceExplorer('s1', '/repo');
		expect(floor.panels.length).toBe(2);
		const firstExplorer = floor.panels.find((q) => q.kind === 'workspace-explorer')!;
		openWorkspaceExplorer('s2', '/repo'); // same root → focus, no insert
		expect(floor.panels.length).toBe(2);
		expect(floor.selectedPanelId).toBe(firstExplorer.id);
	});

	it('sessionWorkspaceExplorer matches by root, not provenance sessionId', () => {
		installDeps({ workspaces: { s1: '/repo' } });
		const c = conv('s1');
		const e = explorer('s9', '/repo'); // provenance differs
		initFloor([c, e], c.id);
		expect(sessionWorkspaceExplorer('s1')?.id).toBe(e.id);
		expect(sessionWorkspaceExplorer('ghost')).toBeUndefined();
	});

	it('publishFileIntent focuses the explorer and stamps a nonce; consume clears exactly that publish', () => {
		const c = conv('s');
		const e = explorer('s', '/repo');
		initFloor([c, e], c.id);
		publishFileIntent(e.id, 'README.md', { start: 3, end: 9 });
		expect(floor.selectedPanelId).toBe(e.id);
		const nonce = floor.pendingFileIntents[e.id]?.nonce;
		expect(nonce).toBeGreaterThan(0);
		consumeFileIntent(e.id, nonce! + 1); // wrong nonce → kept
		expect(floor.pendingFileIntents[e.id]).not.toBeNull();
		consumeFileIntent(e.id, nonce!); // exact nonce → cleared
		expect(floor.pendingFileIntents[e.id]).toBeNull();
	});

	it('openWorkspaceFile drops without an open explorer, publishes with one', () => {
		installDeps({ workspaces: { s1: '/repo' } });
		const c = conv('s1');
		initFloor([c], c.id);
		openWorkspaceFile('s1', 'a.ts'); // no explorer → dropped
		expect(Object.values(floor.pendingFileIntents).every((v) => v === null)).toBe(true);
		openWorkspaceExplorer('s1', '/repo');
		const host = sessionWorkspaceExplorer('s1')!;
		openWorkspaceFile('s1', 'a.ts', { start: 1, end: 2 });
		expect(floor.pendingFileIntents[host.id]?.path).toBe('a.ts');
	});

	it('makeSettingsHomePanel titles the home and carries a null sessionId', () => {
		const h = makeSettingsHomePanel('dsi');
		expect(h.sessionId).toBeNull();
		expect(h.title).toBe('DSI - Settings');
		expect(h.root).toBe('/h/.dsi');
	});
});

// ── removePanel: family closure matrix ───────────────────────────────
describe('removePanel', () => {
	it('unknown id is a no-op', () => {
		const a = conv('a');
		initFloor([a], a.id);
		removePanel('panel-999');
		expect(floor.panels.length).toBe(1);
	});

	it('family close walks the wire lineage transitively (nested included)', () => {
		installDeps({ children: { A: ['sub1'], sub1: ['nested1'] } });
		const A = conv('A');
		const sub1 = conv('sub1');
		const nested1 = conv('nested1');
		const other = conv('other');
		initFloor([A, sub1, nested1, other], A.id);
		removePanel(A.id); // family close
		expect(floor.panels.map((p) => (p as { sessionId?: string }).sessionId)).toEqual(['other']);
	});

	it('Shift+Click (family:false) drops ONLY the panel; children re-root', () => {
		installDeps({ children: { A: ['sub1'] } });
		const A = conv('A');
		const sub1 = conv('sub1');
		initFloor([A, sub1], A.id);
		removePanel(A.id, { family: false });
		expect(floor.panels.map((p) => (p as { sessionId?: string }).sessionId)).toEqual(['sub1']);
	});

	it('closing an explorer dooms its file children by panel id AND the null-edge fallback', () => {
		const c = conv('s');
		const e = explorer('s', '/repo');
		initFloor([c, e], e.id);
		const f1: DsiPanelEntry = { id: nextPanelId(), kind: 'workspace-file', sessionId: 's', path: 'f.ts', explorerPanelId: e.id, width: 480 };
		const f2: DsiPanelEntry = { id: nextPanelId(), kind: 'workspace-file', sessionId: 's', path: 'f.ts', explorerPanelId: null, width: 480 };
		const foreign: DsiPanelEntry = { id: nextPanelId(), kind: 'workspace-file', sessionId: 'other', path: 'g.ts', explorerPanelId: null, width: 480 };
		insertPanel(f1, 99);
		insertPanel(f2, 99);
		insertPanel(foreign, 99);
		removePanel(e.id);
		const kinds = floor.panels.map((p) => (p as { sessionId?: string }).sessionId);
		expect(kinds).toEqual(['s', 'other']); // conversation kept, both file children doomed
	});

	it('a settings-home explorer (sessionId null) dies alone on close', () => {
		const c = conv('s');
		const h = makeSettingsHomePanel('dsh');
		initFloor([c, h], h.id);
		removePanel(h.id);
		expect(floor.panels.length).toBe(1);
		expect(floor.panels[0].kind).toBe('conversation');
	});

	it('selection falls back to the nearest neighbor (Math.min clamp); loupe clears when gone', () => {
		const a = conv('a');
		const b = conv('b');
		initFloor([a, b], b.id);
		openLoupe(b.id);
		removePanel(b.id, { family: false });
		expect(floor.selectedPanelId).toBe(a.id);
		expect(floor.loupePanelId).toBeNull();
	});
});

// ── doMovePanel ──────────────────────────────────────────────────────
describe('doMovePanel', () => {
	it('moves a free root within the row (left≡up, right≡down)', () => {
		const a = conv('a');
		const b = conv('b');
		initFloor([a, b], a.id);
		doMovePanel(b.id, 'left');
		expect(floor.panels.map((p) => p.id)).toEqual([b.id, a.id]);
		doMovePanel(b.id, 'right');
		expect(floor.panels.map((p) => p.id)).toEqual([a.id, b.id]);
	});

	it('an only-child at the edge refuses the move (null from the helper → unchanged)', () => {
		const a = conv('a');
		initFloor([a], a.id);
		doMovePanel(a.id, 'left');
		expect(floor.panels.length).toBe(1);
		expect(floor.panels[0].id).toBe(a.id);
	});
});

// ── pinnedSlotIndex ──────────────────────────────────────────────────
describe('pinnedSlotIndex', () => {
	it('pins after the spawner and after preceding adopted siblings', () => {
		installDeps({ children: { A: ['sub1', 'sub2', 'sub3'] } });
		const A = conv('A');
		const sub2 = conv('sub2');
		initFloor([A, sub2], A.id);
		// adopting sub3: after A, after sub2 → index 2
		expect(pinnedSlotIndex('A', 'sub3')).toBe(2);
		// adopting sub1 (precedes sub2 in wire order): directly after A
		expect(pinnedSlotIndex('A', 'sub1')).toBe(1);
	});
});

// ── doAdd grammar matrix ─────────────────────────────────────────────
describe('doAdd grammar', () => {
	it('conversation dedupe→select (no double panel)', () => {
		const a = conv('a');
		initFloor([a], a.id);
		doAdd({ kind: 'conversation', sessionId: 'a' } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.selectedPanelId).toBe(a.id);
	});

	it('plain insert lands at the focused slot and takes focus', () => {
		const a = conv('a');
		initFloor([a], a.id);
		doAdd({ kind: 'conversation', sessionId: 'b' } as never);
		// insert-before-focused (operator call 2026-08-31): b joins AT a's index
		expect(floor.panels.map((p) => (p as { sessionId?: string }).sessionId)).toEqual(['b', 'a']);
		expect(floor.selectedPanelId).toBe(floor.panels[0].id);
	});

	it('pinned placement: an open spawner keeps the child directly below (lineage order)', () => {
		installDeps({ children: { A: ['sub1'] }, parentOf: { sub1: 'A' } });
		const A = conv('A');
		const x = conv('x');
		initFloor([A, x], x.id); // focus on x
		doAdd({ kind: 'conversation', sessionId: 'sub1' } as never);
		expect(floor.panels.map((p) => (p as { sessionId?: string }).sessionId)).toEqual(['A', 'sub1', 'x']);
	});

	it('adopt-family: clicking a nested ghost brings off-floor ancestors, whole', () => {
		installDeps({
			children: { A: ['sub1'], sub1: ['nested1'] },
			parentOf: { sub1: 'A', nested1: 'sub1' }
		});
		const A = conv('A');
		initFloor([A], A.id);
		const cold: string[] = [];
		installDeps({
			children: { A: ['sub1'], sub1: ['nested1'] },
			parentOf: { sub1: 'A', nested1: 'sub1' },
			ensureCold: async (sid) => void cold.push(sid)
		});
		doAdd({ kind: 'conversation', sessionId: 'nested1' } as never);
		expect(floor.panels.map((p) => (p as { sessionId?: string }).sessionId)).toEqual(['A', 'sub1', 'nested1']);
		expect(cold).toContain('sub1');
		expect(cold).toContain('nested1');
	});

	it('afterSessionId fork slot + rememberEdge + keepSelection', () => {
		const edges: [string, string][] = [];
		installDeps({ rememberEdge: (c, p) => edges.push([c, p]) });
		const a = conv('a');
		const b = conv('b');
		initFloor([a, b], a.id);
		doAdd({ kind: 'conversation', sessionId: 'c', afterSessionId: 'b', keepSelection: true } as never);
		// slot anchored after b (the fork source), selection stays on a
		expect(floor.panels.map((p) => (p as { sessionId?: string }).sessionId)).toEqual(['a', 'b', 'c']);
		expect(floor.selectedPanelId).toBe(a.id);
		expect(edges).toContainEqual(['c', 'b']);
	});

	it('injected-doc: dedupe→focus on the (source, path) pair; fresh lands below the source', () => {
		const src = conv('s');
		initFloor([src], src.id);
		doAdd({ kind: 'injected-doc', sourceSessionId: 's', displayPath: 'x.md' } as never);
		expect(floor.panels.length).toBe(2);
		expect(floor.panels[1].kind).toBe('injected-doc');
		doAdd({ kind: 'injected-doc', sourceSessionId: 's', displayPath: 'x.md' } as never);
		expect(floor.panels.length).toBe(2); // dedupe
		expect(floor.selectedPanelId).toBe(floor.panels[1].id);
	});

	it('settings-home: root dedupe focuses the open home panel', () => {
		doAdd({ kind: 'settings-home', home: 'dsi' } as never);
		expect(floor.panels.length).toBe(1);
		const home = floor.panels[0];
		doAdd({ kind: 'settings-home', home: 'dsi' } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.selectedPanelId).toBe(home.id);
	});

	it('terminal: one live desk takes focus; the action forwards to the desk ref', () => {
		const actions: string[] = [];
		installDeps({ applyTerminalDeskAction: (a) => actions.push(a) });
		doAdd({ kind: 'terminal', action: 'new-tab' } as never);
		expect(floor.panels.length).toBe(1);
		expect(actions).toEqual(['new-tab']); // forwarded even before insert
		const t = floor.panels[0];
		doAdd({ kind: 'terminal', action: 'split-down' } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.selectedPanelId).toBe(t.id);
		expect(actions).toEqual(['new-tab', 'split-down']);
	});

	it('prompt-manager: one live manager, dedupe→focus', () => {
		doAdd({ kind: 'prompt-manager' } as never);
		doAdd({ kind: 'prompt-manager' } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.panels[0].kind).toBe('prompt-manager');
	});

	it('skill-shelf: dedupe→focus; --reload bumps the refresh token', () => {
		doAdd({ kind: 'skill-shelf' } as never);
		const s = floor.panels[0];
		doAdd({ kind: 'skill-shelf' } as never);
		expect((floor.panels[0] as { refresh?: number }).refresh).toBeUndefined();
		doAdd({ kind: 'skill-shelf', reload: true } as never);
		expect(floor.panels.length).toBe(1);
		expect((floor.panels[0] as { refresh?: number }).refresh).toBe(1);
		expect(floor.selectedPanelId).toBe(s.id);
	});

	it('plugin-rack: dedupe→focus; --reload bumps the refresh token', () => {
		doAdd({ kind: 'plugin-rack', reload: true } as never);
		doAdd({ kind: 'plugin-rack', reload: true } as never);
		expect(floor.panels.length).toBe(1);
		expect((floor.panels[0] as { refresh?: number }).refresh).toBe(1);
	});
});

// ── replace / swap family ────────────────────────────────────────────
describe('doReplace family', () => {
	it('doReplaceSelected on an empty floor falls through to doAdd', () => {
		doReplaceSelected({ kind: 'conversation', sessionId: 'a' } as never);
		expect(floor.panels.length).toBe(1);
	});

	it('doReplacePanel: unknown id no-op; guarded kinds no-op', () => {
		const a = conv('a');
		initFloor([a], a.id);
		doReplacePanel('panel-999', { kind: 'conversation', sessionId: 'b' } as never);
		expect(floor.panels.length).toBe(1);
		doReplacePanel(a.id, { kind: 'prompt-manager' } as never);
		expect(floor.panels[0].kind).toBe('conversation');
	});

	it('doReplacePanel keeps the slot width, mints a fresh id, selects the newcomer', () => {
		const a = makePanel('a', null);
		initFloor([{ ...a, width: 700 }], a.id);
		openLoupe(a.id);
		doReplacePanel(a.id, { kind: 'conversation', sessionId: 'b' } as never);
		expect(floor.panels.length).toBe(1);
		expect(floor.panels[0].id).not.toBe(a.id);
		expect(floor.panels[0].width).toBe(700);
		expect((floor.panels[0] as { sessionId?: string }).sessionId).toBe('b');
		expect(floor.selectedPanelId).toBe(floor.panels[0].id);
		expect(floor.loupePanelId).toBeNull(); // the old id died → loupe cleared
	});

	it('same-session replace is an honest no-op', () => {
		const a = conv('a');
		initFloor([a], a.id);
		doReplacePanel(a.id, { kind: 'conversation', sessionId: 'a' } as never);
		expect(floor.panels[0].id).toBe(a.id);
	});

	it('doReplacePanelBySession: miss → false; same session → true; retarget swaps', () => {
		const a = conv('a');
		initFloor([a], a.id);
		expect(doReplacePanelBySession('ghost', { kind: 'conversation', sessionId: 'b' } as never)).toBe(false);
		expect(doReplacePanelBySession('a', { kind: 'conversation', sessionId: 'a' } as never)).toBe(true);
		expect(doReplacePanelBySession('a', { kind: 'terminal' } as never)).toBe(false); // guarded kind
		expect(doReplacePanelBySession('a', { kind: 'conversation', sessionId: 'b' } as never)).toBe(true);
		expect((floor.panels[0] as { sessionId?: string }).sessionId).toBe('b');
	});

	it('doSwapInto plain: width kept, focus flag arms the composer marker', () => {
		const a = conv('a');
		initFloor([{ ...a, width: 640 }], a.id);
		doSwapInto(a.id, 0, { kind: 'conversation', sessionId: 'b', focus: true } as never);
		expect(floor.panels[0].width).toBe(640);
		expect(floor.focusComposerId).toBe(floor.panels[0].id);
		clearFocusComposer();
		expect(floor.focusComposerId).toBeNull();
	});

	it('replacing a spawner with its own child pins the child below (family never orphans)', () => {
		installDeps({ children: { A: ['sub1'] }, parentOf: { sub1: 'A' } });
		const A = conv('A');
		initFloor([A], A.id);
		doReplacePanel(A.id, { kind: 'conversation', sessionId: 'sub1' } as never);
		const sids = floor.panels.map((p) => (p as { sessionId?: string }).sessionId);
		expect(sids).toEqual(['A', 'sub1']);
	});
});

// ── resize gesture ───────────────────────────────────────────────────
describe('resize gesture and resizeAll', () => {
	function desk3() {
		const a = makePanel('a', null);
		const b = makePanel('b', null);
		const c = makePanel('c', null);
		initFloor(
			[a, b, c].map((p) => ({ ...p, width: 500 })),
			a.id
		);
		return { a, b, c };
	}
	const ev = (x: number, shift = false): MouseEvent => {
		// happy-dom ignores MouseEventInit.shiftKey — define it on the instance
		const e = new MouseEvent('mousemove', { clientX: x } as MouseEventInit);
		Object.defineProperty(e, 'shiftKey', { value: shift });
		return e;
	};

	it('plain drag resizes ONLY the dragged panel; badges live while dragging', () => {
		const { b } = desk3();
		doStartPanelResize(ev(0), 1);
		onPanelWindowMouseMove(ev(60));
		expect(floor.panels[1].width).toBe(560);
		expect(floor.panels[0].width).toBe(500);
		expect(floor.drag).not.toBeNull();
		const preset = vi.fn();
		installDeps({ setPanelWidthPreset: preset });
		onPanelWindowMouseUp(); // mixed row → preset untouched
		expect(preset).not.toHaveBeenCalled();
		expect(floor.drag).toBeNull();
		expect(floor.widthBadgeFading).toBe(true);
		expect(floor.widthBadgeIds.has(b.id)).toBe(true);
	});

	it('shift+drag scales the whole row; a uniform landing syncs the preset', () => {
		desk3();
		const preset = vi.fn();
		installDeps({ setPanelWidthPreset: preset });
		doStartPanelResize(ev(0, true), 0); // shift snaps at MOUSEDOWN
		onPanelWindowMouseMove(ev(90));
		onPanelWindowMouseUp();
		for (const p of floor.panels) expect(p.width).toBe(530); // 500 + 90/3
		expect(preset).toHaveBeenCalledWith(530);
	});

	it('a new drag cancels the afterglow; resizeAll touches conversations only', () => {
		const { b } = desk3();
		const e = explorer('s', '/r');
		insertPanel(e, 99);
		doStartPanelResize(ev(0), 0);
		onPanelWindowMouseUp();
		expect(floor.widthBadgeFading).toBe(true);
		doStartPanelResize(ev(0), 0); // cancels afterglow
		expect(floor.widthBadgeFading).toBe(false);
		expect(floor.widthBadgeIds.size).toBe(0);
		const preset = vi.fn();
		installDeps({ setPanelWidthPreset: preset });
		resizeAll(700);
		expect(preset).toHaveBeenCalledWith(700);
		expect(floor.panels[0].width).toBe(700);
		expect(floor.panels[2].width).toBe(700);
		expect((floor.panels[3] as DsiWorkspaceExplorerPanel).width).not.toBe(700); // fixed lane
		// b's ORIGINAL entry object is untouched — the machine replaces entries
		// b's ORIGINAL entry object is untouched — the machine replaces entries
		expect(b.width).toBe(480);
		expect(floor.panels[1].width).not.toBe(480);
	});

	it('coalesced move applies ONE width write per animation frame, using the LATEST event', () => {
		vi.useFakeTimers();
		try {
			desk3();
			const frames: FrameRequestCallback[] = [];
			vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
				frames.push(cb);
				return frames.length;
			});
			vi.stubGlobal('cancelAnimationFrame', () => {});
			doStartPanelResize(ev(0), 1);
			// Three mousemove events inside one frame window: the FIRST applies
			// immediately, one frame is queued, and the frame applies the LAST
			// event's clientX.
			onPanelWindowMouseMoveCoalesced(ev(20));
			onPanelWindowMouseMoveCoalesced(ev(40));
			onPanelWindowMouseMoveCoalesced(ev(60));
			expect(frames.length).toBe(1); // coalesced — no per-event frames
			expect(floor.panels[1].width).toBe(520); // first move applied at once
			frames[0]!(0); // the frame fires
			expect(floor.panels[1].width).toBe(560); // latest event wins
			// A move with no active drag queues no frame.
			onPanelWindowMouseUp();
			onPanelWindowMouseMoveCoalesced(ev(200));
			expect(frames.length).toBe(1);
		} finally {
			vi.unstubAllGlobals();
			vi.useRealTimers();
		}
	});

	it('disposeFloorGestures cancels a pending coalesced frame', () => {
		desk3();
		const frames: FrameRequestCallback[] = [];
		const cancelled: number[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelled.push(id));
		try {
			doStartPanelResize(ev(0), 1);
			onPanelWindowMouseMoveCoalesced(ev(30));
			disposeFloorGestures();
			expect(cancelled).toEqual([1]); // the pending frame was cancelled
			frames[0]!(0); // firing it anyway must NOT resize again (guard)
			expect(floor.panels[1].width).toBe(530); // only the lead apply landed
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ── T1.2-T equivalence: a scripted desk stays coherent ───────────────
describe('fixture-desk equivalence (T1.2-T)', () => {
	it('a scripted seed → add → move → close sequence yields the expected desk + selection', () => {
		installDeps({
			children: { A: ['sub1'] },
			parentOf: { sub1: 'A' },
			workspaces: { A: '/repo' }
		});
		// seed: one panel
		seedDesk([makePanel('A', null)], 'panel-1');
		// add a plain conversation (lands at the focused slot, takes focus)
		doAdd({ kind: 'conversation', sessionId: 'X' } as never);
		// add a pinned child of A (spawner NOT focused; child pins below A)
		doAdd({ kind: 'conversation', sessionId: 'sub1' } as never);
		// open the workspace explorer for A (dedupe key root)
		openWorkspaceExplorer('A', '/repo');
		// close X single (Shift+Click)
		const xPanel = floor.panels.find((p) => (p as { sessionId?: string }).sessionId === 'X')!;
		removePanel(xPanel.id, { family: false });
		// ROUTE-FAITHFUL quirk (mirrored verbatim, flagged for adjudication): the
		// removal filter keeps session-less kinds unconditionally, but a session-
		// keyed non-conversation (the explorer, sessionId 'A') only survives a
		// close when family !== false — so Shift+Click on a conversation ALSO
		// drops open explorers. W1 is a zero-behavior-change mirror: pin the
		// EXISTING contract, not an idealized one.
		const sids = floor.panels.map((p) =>
			p.kind === 'workspace-explorer' ? 'explorer' : (p as { sessionId?: string }).sessionId
		);
		expect(sids).toEqual(['A', 'sub1']);
		// the removed panel sat at index 0 → the Math.min(idx, len-1) fallback
		// selects the panel now AT index 0 (A)
		expect(floor.selectedPanelId).toBe(floor.panels[0].id);
		expect(sessionWorkspaceExplorer('A')).toBeUndefined();
		// persistence view: the save shape equals the live array (identity of data)
		const snapshot = floor.panels.map((p) => ({ ...p }));
		expect(snapshot.map((p) => p.id)).toEqual(floor.panels.map((p) => p.id));
	});
});

// ── W2 T2.3-T: markdown link gate ────────────────────────────────────
describe('openFileLinkFromMarkdown (File Link Intent gate, W2 T2.3-T)', () => {
	function jsonResponse(body: unknown, status = 200): Response {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}
	function stubTree(entries: { name: string; type: string }[]): void {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, listing: { entries } })));
	}

	it('drops an unparseable href without touching the wire', async () => {
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		// '#L3' parses to an EMPTY raw path — the gate's first drop
		await openFileLinkFromMarkdown('s', '#L3');
		expect(f).not.toHaveBeenCalled();
	});

	it('drops when the tree route refuses the file (gate)', async () => {
		installDeps({ workspaces: { s1: '/repo' } });
		const c = conv('s1');
		initFloor([c], c.id);
		const f = vi.fn(async () => jsonResponse({ ok: false }));
		vi.stubGlobal('fetch', f);
		await openFileLinkFromMarkdown('s1', 'README.md');
		expect(floor.panels.length).toBe(1); // no explorer opened
		expect(Object.values(floor.pendingFileIntents).every((v) => v === null)).toBe(true);
	});

	it('opens the explorer, then publishes the intent (the common path)', async () => {
		installDeps({ workspaces: { s1: '/repo' } });
		const c = conv('s1');
		initFloor([c], c.id);
		stubTree([{ name: 'f.ts', type: 'file' }]);
		await openFileLinkFromMarkdown('s1', 'f.ts');
		expect(floor.panels.length).toBe(2); // explorer opened by the LINK
		const host = sessionWorkspaceExplorer('s1')!;
		expect(host).not.toBeUndefined();
		expect(floor.pendingFileIntents[host.id]?.path).toBe('f.ts');
		expect(floor.selectedPanelId).toBe(host.id);
	});

	it('drops when the gate passes but no workspace root exists', async () => {
		installDeps(); // no workspaces
		const c = conv('s1');
		initFloor([c], c.id);
		stubTree([{ name: 'f.ts', type: 'file' }]);
		await openFileLinkFromMarkdown('s1', 'f.ts');
		expect(floor.panels.length).toBe(1);
	});

	it('publishes into the OPEN explorer without opening a second', async () => {
		installDeps({ workspaces: { s1: '/repo' } });
		const c = conv('s1');
		initFloor([c], c.id);
		openWorkspaceExplorer('s1', '/repo');
		const before = floor.panels.length;
		stubTree([{ name: 'f.ts', type: 'file' }]);
		await openFileLinkFromMarkdown('s1', 'f.ts#L3-L9');
		expect(floor.panels.length).toBe(before);
		const host = sessionWorkspaceExplorer('s1')!;
		expect(floor.pendingFileIntents[host.id]?.lines).toEqual({ start: 3, end: 9 });
	});
});

// ── W2 T2.6-T: the cold-load wire read ───────────────────────────────
describe('fetchColdFromWire (dual fetch, W2 T2.6-T)', () => {
	it('resolves events first, then anchors /history under lastSeq; hasMore from entries', async () => {
		const calls: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			if (String(input).includes('/events?full=1')) {
				return jsonResponse({ ok: true, entries: [{ seq: 7 }], lastSeq: 7, running: true });
			}
			return jsonResponse({ ok: true, entries: [{ seq: 6 }], hasMore: false });
		}));
		const cold = await fetchColdFromWire('s1');
		expect(calls[0]).toContain('/events?full=1');
		expect(calls[1]).toContain('/history?beforeSeq=8'); // lastSeq + 1
		expect(cold?.lastSeq).toBe(7);
		expect(cold?.running).toBe(true);
		expect(cold?.hasMore).toBe(true); // an older page exists
		expect(cold?.title).toBeNull(); // the dual fetch carries no session row
	});

	it('empty older history page + hasMore flag respects both signals', async () => {
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).includes('/events?full=1')) {
				return jsonResponse({ ok: true, entries: [], lastSeq: -1, running: false });
			}
			return jsonResponse({ ok: true, entries: [], hasMore: true });
		}));
		const cold = await fetchColdFromWire('s1');
		expect(cold?.hasMore).toBe(true);
		expect(cold?.lastSeq).toBe(-1);
	});

	it('a refused events call returns null without touching /history', async () => {
		const f = vi.fn(async () => jsonResponse({ ok: false }, 500));
		vi.stubGlobal('fetch', f);
		expect(await fetchColdFromWire('s1')).toBeNull();
		expect(f).toHaveBeenCalledTimes(1);
	});
});

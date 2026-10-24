/**
 * panel-placement tests (W7 task 7.1-T) — the floor's placement math,
 * extracted verbatim from the route (KB "The Floor Decomposition" E2).
 * Headless pins for the invariants the route comments own: pinned slot
 * (lineage order, adopted subtree travels whole), the adopt-family chain
 * (nearest open ancestor), the focused-slot family clamp, and orphan-head
 * behavior.
 */
import { describe, expect, it } from 'vitest';
import {
	adoptionChain,
	findInjectedDocPanel,
	findWorkspaceExplorerPanel,
	findWorkspaceFilePanel,
	focusedInsertionSlot,
	glassFirstSlot,
	injectedDocSlot,
	lineagePinnedSlot,
	wireParentOf,
	workspaceExplorerSlot,
	workspaceFileSlot,
	type ChildrenByParent
} from '$lib/services/panels/panel-placement';
import { moveFactsFrom } from '$lib/services/lineage/lineage-move';
import type {
	DsiBrowserPanel,
	DsiConversationPanel,
	DsiInjectedDocPanel,
	DsiSessionSummary,
	DsiWorkspaceExplorerPanel,
	DsiWorkspaceFilePanel
} from '$lib/types';

function conv(id: string, sessionId: string): DsiConversationPanel {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width: 730 };
}

function browser(id: string, openedBy?: string): DsiBrowserPanel {
	return { id, kind: 'browser', width: 730, ...(openedBy !== undefined ? { openedBy } : {}) };
}

function row(sessionId: string, parentSessionId: string | null = null): DsiSessionSummary {
	return {
		sessionId,
		title: sessionId,
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 0,
		workspace: '/w',
		turns: null,
		...(parentSessionId !== null ? { parentSessionId, origin: 'subagent' as const } : {})
	};
}

/** childrenByParent from parent:children pairs (wire order kept). */
function index(pairs: Record<string, string[]>): ChildrenByParent {
	const m = new Map<string, DsiSessionSummary[]>();
	for (const [parent, kids] of Object.entries(pairs)) {
		m.set(parent, kids.map((k) => row(k, parent)));
	}
	return m;
}

describe('lineagePinnedSlot — pinned (7.1-T)', () => {
	it('pins directly below the open spawner; an adopted OLDER sibling keeps the child after it', () => {
		const panels = [conv('p-a', 'A'), conv('p-sub2', 'sub2')];
		const kids = index({ A: ['sub1', 'sub2'] });
		// sub1 precedes sub2 in wire order → the newcomer sub1 lands BEFORE sub2.
		expect(lineagePinnedSlot(panels, kids, 'A', 'sub1')).toBe(1);
		// A LATER sibling lands after the already-adopted sub2.
		expect(lineagePinnedSlot(panels, kids, 'A', 'sub3')).toBe(2);
	});

	it('the adopted subtree travels whole: a preceding sibling with its own child keeps both ahead', () => {
		// Floor: |A|sub1|sub1child| — adopting sub2 lands after the whole block.
		const panels = [conv('p-a', 'A'), conv('p-sub1', 'sub1'), conv('p-gc', 'gc')];
		const kids = index({ A: ['sub1', 'sub2'], sub1: ['gc'] });
		expect(lineagePinnedSlot(panels, kids, 'A', 'sub2')).toBe(3);
	});

	it('a spawner with no panel (unreachable through real callers — pinned placement requires an open spawner) falls to the front-add base 0', () => {
		const panels = [conv('p-x', 'X')];
		const kids = index({ A: ['sub1'] });
		// findIndex misses → base 0 — documented behavior, never exercised
		// by the route (replaceTarget only says 'pinned' when the parent
		// holds a panel; the adopt-family path pins under an OPEN anchor).
		expect(lineagePinnedSlot(panels, kids, 'A', 'sub1')).toBe(0);
	});
});

describe('adoptionChain — adopt-family (7.1-T)', () => {
	it('climbs to the nearest OPEN ancestor; the chain is nearest-first', () => {
		// Wire: A → b → c → d (all off-floor except A).
		const kids = index({ A: ['b'], b: ['c'], c: ['d'] });
		const open = (sid: string) => sid === 'A';
		const { chain, anchor } = adoptionChain(kids, 'c', open);
		expect(chain).toEqual(['c', 'b']);
		expect(anchor).toBe('A');
	});

	it('no open ancestor anywhere: the whole chain climbs to the root, anchor null', () => {
		const kids = index({ A: ['b'], b: ['c'] });
		const { chain, anchor } = adoptionChain(kids, 'c', () => false);
		expect(chain).toEqual(['c', 'b', 'A']);
		expect(anchor).toBeNull();
	});
});

describe('focusedInsertionSlot — family clamp + orphan head (7.1-T)', () => {
	it('a CHILD focus climbs to the family head (never splits a family)', () => {
		// Floor: |A|sub| — focus on sub (index 1) clamps to head A's index 0.
		const panels = [conv('p-a', 'A'), conv('p-sub', 'sub')];
		const parentOf = moveFactsFrom(
			{ childrenByParent: index({ A: ['sub'] }) } as never,
			new Set(['A'])
		).parentOf;
		expect(focusedInsertionSlot(panels, 1, parentOf)).toBe(0);
	});

	it('an ORPHAN child is its own head — its focus slot survives (the §8 free rule)', () => {
		// sub's spawner A holds NO panel → move facts drop the edge.
		const panels = [conv('p-x', 'X'), conv('p-sub', 'sub')];
		const parentOf = moveFactsFrom(
			{ childrenByParent: index({ A: ['sub'] }) } as never,
			new Set([]) // A not open
		).parentOf;
		expect(focusedInsertionSlot(panels, 1, parentOf)).toBe(1);
	});

	it('no selection (empty floor / stale) falls back to the front', () => {
		expect(focusedInsertionSlot([], 0, new Map())).toBe(0);
		expect(focusedInsertionSlot([conv('p-a', 'A')], -3, new Map())).toBe(0);
	});

	// BUG 2026-10-23 (the glass wedge): a focused BROWSER panel gave no
	// family clamp — the insert-before-focused slot was the glass's own
	// index, wedging the newcomer between the opener's family and its
	// sticky glass (ADR-0036 Amendment 2). The move grammar and the
	// sidebar's familyRenderOrder both ride the glass with the family;
	// the focused-slot clamp must resolve the same block.
	it('a GLASS focus riding its opener family clamps to the block head (never splits opener and glass)', () => {
		// Floor: |A|glass| — focus on the glass (index 1) clamps to head A's index 0.
		const panels = [conv('p-a', 'A'), browser('p-glass', 'A')];
		const parentOf = new Map<string, string>(); // a root agent, no edges needed
		expect(focusedInsertionSlot(panels, 1, parentOf)).toBe(0);
	});

	it('a KEYLESS glass (ControlBar open) is its own unit — its focus slot survives', () => {
		const panels = [conv('p-a', 'A'), browser('p-glass')];
		expect(focusedInsertionSlot(panels, 1, new Map())).toBe(1);
	});
});

describe('wireParentOf (7.1-T)', () => {
	it('resolves the direct parent from the children index; null at a root', () => {
		const kids = index({ A: ['b'], b: ['c'] });
		expect(wireParentOf(kids, 'c')).toBe('b');
		expect(wireParentOf(kids, 'A')).toBeNull();
		expect(wireParentOf(kids, 'unknown')).toBeNull();
	});
});

// ── Loadinjected W4 4.3-T — the document child's dedupe lookup + slot ──

function doc(
	id: string,
	sourceSessionId: string,
	displayPath: string
): DsiInjectedDocPanel {
	return { id, kind: 'injected-doc', sourceSessionId, displayPath, width: 600 };
}

describe('findInjectedDocPanel (4.3-T, ADR D5)', () => {
	const panels = [
		conv('p1', 'A'),
		doc('d1', 'A', 'AGENTS.md'),
		doc('d2', 'B', 'AGENTS.md')
	];

	it('matches the EXACT (sourceSessionId, displayPath) pair — the composite key', () => {
		expect(findInjectedDocPanel(panels, 'A', 'AGENTS.md')?.id).toBe('d1');
		expect(findInjectedDocPanel(panels, 'B', 'AGENTS.md')?.id).toBe('d2');
	});

	it('two conversations holding the same file stay distinct — no filename-only dedupe', () => {
		expect(findInjectedDocPanel(panels, 'A', 'NOPE.md')).toBeUndefined();
		expect(findInjectedDocPanel([], 'A', 'AGENTS.md')).toBeUndefined();
	});
});

describe('injectedDocSlot (4.3-T, ADR D3)', () => {
	const panels = [conv('p1', 'A'), conv('p2', 'B'), conv('p3', 'C')];

	it('lands directly BELOW the source conversation panel — the fork-child slot rule', () => {
		expect(injectedDocSlot(panels, 'A', 99)).toBe(1);
		expect(injectedDocSlot(panels, 'B', 99)).toBe(2);
	});

	it('an off-floor source falls back to the caller’s focused-slot default', () => {
		expect(injectedDocSlot(panels, 'Z', 99)).toBe(99);
		expect(injectedDocSlot([], 'A', 0)).toBe(0);
	});
});

// ── Workspace Explorer W1 1.2-T — workspace dedupe + slots (2026-09-10 ADR D3/D4) ──

function explorer(
	id: string,
	sessionId: string,
	root = '/tmp/ws'
): DsiWorkspaceExplorerPanel {
	return { id, kind: 'workspace-explorer', sessionId, root, expanded: [], width: 600 };
}

function file(
	id: string,
	sessionId: string,
	path: string
): DsiWorkspaceFilePanel {
	return { id, kind: 'workspace-file', sessionId, path, explorerPanelId: null, width: 600 };
}

describe('findWorkspaceExplorerPanel (1.1-T, Shared Tree ADR D1)', () => {
	it('dedupes by ROOT — ONE explorer per workspace across all sessions', () => {
		const panels = [
			conv('p1', 'A'),
			explorer('w1', 'A', '/shared'),
			explorer('w2', 'B', '/other')
		];
		expect(findWorkspaceExplorerPanel(panels, '/shared')?.id).toBe('w1');
		expect(findWorkspaceExplorerPanel(panels, '/other')?.id).toBe('w2');
		expect(findWorkspaceExplorerPanel(panels, '/none')).toBeUndefined();
	});

	it('a chip click on the SECOND session of a shared root hits the SAME panel', () => {
		const panels = [explorer('w1', 'A', '/shared'), explorer('w2', 'B', '/shared')];
		expect(findWorkspaceExplorerPanel(panels, '/shared')?.id).toBe('w1');
	});

	it('non-explorer kinds and other fields never match a root', () => {
		const panels = [conv('p1', 'A'), file('f1', 'A', '/shared')];
		expect(findWorkspaceExplorerPanel(panels, '/shared')).toBeUndefined();
	});
});

describe('findWorkspaceFilePanel (1.2-T, ADR D5-analog)', () => {
	const panels = [file('f1', 'A', 'README.md'), file('f2', 'B', 'README.md')];

	it('matches the EXACT (sessionId, path) pair — the composite key', () => {
		expect(findWorkspaceFilePanel(panels, 'A', 'README.md')?.id).toBe('f1');
		expect(findWorkspaceFilePanel(panels, 'B', 'README.md')?.id).toBe('f2');
		expect(findWorkspaceFilePanel(panels, 'A', 'other.md')).toBeUndefined();
	});

	it('two sessions sharing one workspace hold distinct file panels — no path-only dedupe', () => {
		expect(findWorkspaceFilePanel([], 'A', 'README.md')).toBeUndefined();
	});
});

describe('workspaceExplorerSlot (1.2-T, Shared Tree ADR D3 — focused slot, non-lineage)', () => {
	it('an OPEN SOURCE conversation no longer pulls a below-source slot', () => {
		const panels = [conv('p-a', 'A'), conv('p-sub', 'sub')];
		const facts = moveFactsFrom(
			{ childrenByParent: index({ A: ['sub'] }) } as never,
			new Set(['A'])
		);
		// focus on sub (1) → family clamp to A's head (0) — never after-source (2).
		expect(workspaceExplorerSlot(panels, 1, facts)).toBe(0);
		// exact focus, no family: the focus itself.
		expect(workspaceExplorerSlot(panels, 1, { parentOf: new Map() })).toBe(1);
	});

	it('a CHILD focus clamps to the family head; no selection falls back to the front', () => {
		const panels = [conv('p-a', 'A'), conv('p-sub', 'sub')];
		const facts = moveFactsFrom(
			{ childrenByParent: index({ A: ['sub'] }) } as never,
			new Set(['A'])
		);
		expect(workspaceExplorerSlot(panels, 1, facts)).toBe(0);
		expect(workspaceExplorerSlot([], 0, { parentOf: new Map() })).toBe(0);
	});
});

describe('workspaceFileSlot (1.2-T, ADR D3)', () => {
	it('lands directly BELOW its explorer — even when the explorer’s conversation is closed', () => {
		const panels = [conv('p-a', 'A'), explorer('w1', 'A'), conv('p-b', 'B')];
		expect(workspaceFileSlot(panels, 'w1', 99)).toBe(2);
	});

	it('a closed explorer falls back to the caller’s focused-slot default', () => {
		const panels = [conv('p-a', 'A')];
		expect(workspaceFileSlot(panels, 'w-gone', 99)).toBe(99);
		expect(workspaceFileSlot([], 'w-gone', 0)).toBe(0);
	});
});

// ── Loadinjected consolidation (2026-09-07) — insertions respect the doc tail

describe('lineagePinnedSlot — a session child lands BELOW the source’s doc tail', () => {
	it('the source’s document children keep their directly-below slot (ADR D3)', () => {
		const panels = [conv('pA', 'A'), doc('d1', 'A', 'AGENTS.md')];
		const kids = index({ A: ['S'] });
		// base = after A (1) → the doc tail pushes the landing slot to 2 —
		// the new child never wedges between the source and its document.
		expect(lineagePinnedSlot(panels, kids, 'A', 'S')).toBe(2);
	});

	it('without a doc tail the slot is directly below the source (unchanged)', () => {
		const panels = [conv('pA', 'A'), conv('pB', 'B')];
		const kids = index({ A: ['S'] });
		expect(lineagePinnedSlot(panels, kids, 'A', 'S')).toBe(1);
	});
});

// ── Workspace family placement (2026-09-10 parent-first fix) — the floor
// reads Parent → explorer → file; a newcomer never wedges between the
// explorer and its file. ADR: The Workspace Explorer, Amendment C.

function explorerPanel(id: string, sessionId: string, root: string): DsiWorkspaceExplorerPanel {
	return { id, kind: 'workspace-explorer', sessionId, root, expanded: [], width: 600 };
}

function filePanel(
	id: string,
	sessionId: string,
	path: string,
	explorerPanelId: string | null
): DsiWorkspaceFilePanel {
	return { id, kind: 'workspace-file', sessionId, path, explorerPanelId, width: 600 };
}

describe('workspaceExplorerSlot — focused-slot contract (Shared Tree D3)', () => {
	const facts = moveFactsFrom({ childrenByParent: new Map() } as never, new Set());

	it('focus on a stranger conversation keeps the exact focus slot', () => {
		const panels = [conv('p-a', 'A'), conv('p-b', 'B')];
		expect(workspaceExplorerSlot(panels, 1, facts)).toBe(1);
	});

	it('focus on a doc child keeps the exact focus slot — the clamp only fires for conversation and workspace kinds', () => {
		const panels = [conv('p-a', 'A'), doc('d1', 'A', 'AGENTS.md'), conv('p-b', 'B')];
		expect(workspaceExplorerSlot(panels, 1, facts)).toBe(1);
	});

	it('stale out-of-range selection falls back to the front', () => {
		const panels = [conv('p-b', 'B')];
		expect(workspaceExplorerSlot(panels, 0, facts)).toBe(0);
		expect(workspaceExplorerSlot(panels, 5, facts)).toBe(0);
	});
});

describe('focusedInsertionSlot — the workspace family clamp (2026-09-10)', () => {
	it('focus on the FILE: the newcomer joins at the unit head — left of the explorer', () => {
		const panels = [
			explorerPanel('e1', 'A', '/w'),
			filePanel('f1', 'A', 'README.md', 'e1')
		];
		// The observed wedge put the newcomer at index 1 (between e1 and f1).
		expect(focusedInsertionSlot(panels, 1, new Map())).toBe(0);
	});

	it('focus on the EXPLORER with its conversation elsewhere: still the leftmost non-splitting slot', () => {
		const panels = [
			explorerPanel('e1', 'A', '/w'),
			filePanel('f1', 'A', 'README.md', 'e1'),
			conv('p-a', 'A')
		];
		// min(headIndex=2, unitStart=0) — the newcomer joins LEFT of the unit,
		// never between the conversation and its workspace pair.
		expect(focusedInsertionSlot(panels, 0, new Map())).toBe(0);
	});

	it('focus on the EXPLORER without its conversation: still the unit head', () => {
		const panels = [
			conv('p-x', 'X'),
			explorerPanel('e1', 'A', '/w'),
			filePanel('f1', 'A', 'README.md', 'e1')
		];
		expect(focusedInsertionSlot(panels, 1, new Map())).toBe(1);
	});
});

// ── Shared Tree ADR (2026-09-17) 3.1-T — the retired per-session explorer
// contract must not resurface in src: the ONLY permitted mentions are the
// D1/D3 comments quoting the retired rule as history.

describe('retired-phrase sweep (3.1-T, Shared Tree ADR D1/D3)', () => {
	const RETIRED = [
		'Two sessions sharing one workspace hold distinct explorers',
		'two sessions sharing one workspace hold distinct explorers',
		'ONE explorer per sessionId',
		'ONE explorer per session,'
	];

	it('no source file carries the retired per-session dedupe contract outside its retirement citation', async () => {
		const { readdirSync, readFileSync, statSync } = await import('node:fs');
		const { join } = await import('node:path');
		const allowed: Array<[string, number]> = [
			['src/lib/services/panels/panel-placement.ts', 57], // D1 comment quoting the retired rule
			['src/lib/services/panels/panel-placement.ts', 89] // D3 comment quoting the retired rule
		];
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const p = join(dir, entry);
				if (statSync(p).isDirectory()) walk(p);
				else if (/(ts|svelte|js)$/.test(p)) {
					const lines = readFileSync(p, 'utf8').split('\n');
					lines.forEach((line, i) => {
						if (RETIRED.some((phrase) => line.includes(phrase))) {
							const cited = allowed.some(([f, ln]) => f === p && Math.abs(ln - (i + 1)) <= 2);
							if (!cited) offenders.push(p + ':' + (i + 1) + ': ' + line.trim().slice(0, 100));
						}
					});
				}
			}
		};
		walk('src');
		expect(offenders).toEqual([]);
	});
});

// The Glass Close Ladder Amendment 2: the ghost is ALWAYS the first
// child under its opener — glassFirstSlot lands it below the opener
// (past its doc tail) and before every adopted child.
describe('glassFirstSlot — the ghost is the first child (Ladder A2)', () => {
	const panels = [
		conv('p1', 'A'),
		conv('p2', 'sub'),
		conv('p3', 'B')
	];
	it('lands directly below the opener, before adopted children', () => {
		expect(glassFirstSlot(panels, 'A')).toBe(1);
	});
	it('an opener with no floor panel appends at the end', () => {
		expect(glassFirstSlot(panels, 'Z')).toBe(panels.length);
	});
});
// The Glass Close Ladder Amendment 2 (operator bug 2026-10-24): the ghost
// is the FIRST child — a newly pinned sub-agent lands AFTER the glass,
// never between the opener and it.
describe('lineagePinnedSlot — the ghost guards the family head', () => {
	const panels = [
		conv('p1', 'A'),
		{ id: 'g1', kind: 'browser', width: 480, openedBy: 'A' } as DsiPanelEntry,
		conv('p2', 'B')
	];
	const kids = index({ A: ['new1'] });
	it('a new child lands AFTER the glass, never between opener and ghost', () => {
		expect(lineagePinnedSlot(panels, kids, 'A', 'new1')).toBe(2);
	});
	it('a second child lands after the first, still behind the ghost', () => {
		const withChild = [conv('p1', 'A'), conv('p9', 'new1'), { id: 'g1', kind: 'browser', width: 480, openedBy: 'A' } as DsiPanelEntry, conv('p2', 'B')];
		expect(lineagePinnedSlot(withChild, kids, 'A', 'new2')).toBe(3);
	});
});

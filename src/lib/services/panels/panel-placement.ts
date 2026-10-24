/**
 * panel-placement.ts — the floor's placement math, extracted verbatim from
 * the workspace route (KB "The Floor Decomposition" E2, 2026-09-06). PURE
 * functions over plain inputs (S1/S7): the WRITE stays in the route —
 * these compute the slot, the route's insertPanel performs it. Comments
 * carry the contracts they owned in the route.
 */
import type {
	DsiInjectedDocPanel,
	DsiPanelEntry,
	DsiSessionSummary,
	DsiWorkspaceExplorerPanel,
	DsiWorkspaceFilePanel
} from '$lib/types';
import { afterSourceSlot, blockBounds, docTailEnd, type MoveFacts } from '$lib/services/lineage/lineage-move';

/**
 * The open injected-doc panel for a (sourceSessionId, displayPath) pair —
 * D5's composite dedupe key, ONE home: the route's add and bare-swap both
 * prevent the second copy through this lookup.
 */
export function findInjectedDocPanel(
	panels: readonly DsiPanelEntry[],
	sourceSessionId: string,
	displayPath: string
): DsiInjectedDocPanel | undefined {
	return panels.find(
		(p): p is DsiInjectedDocPanel =>
			p.kind === 'injected-doc' &&
			p.sourceSessionId === sourceSessionId &&
			p.displayPath === displayPath
	);
}

/**
 * The document child's slot (Loadinjected ADR D3): directly BELOW the
 * source conversation's panel — the fork-child slot rule, not the
 * manager's right-of rule — else the caller's fallback (the focused-slot
 * default) when no open panel carries the source session.
 */
export function injectedDocSlot(
	panels: readonly DsiPanelEntry[],
	sourceSessionId: string,
	fallback: number
): number {
	const sourceIdx = panels.findIndex(
		(p) => p.kind === 'conversation' && p.sessionId === sourceSessionId
	);
	return sourceIdx >= 0 ? sourceIdx + 1 : fallback;
}

/**
 * The open workspace explorer for a workspace ROOT — The Shared Tree ADR
 * (2026-09-17) D1's dedupe key: ONE explorer per ROOT across ALL sessions,
 * so a chip click on any session sharing the root FOCUSES instead of
 * adding (a duplicate is a bug, not a feature). The retired per-session
 * key ("two sessions sharing one workspace hold distinct explorers",
 * Workspace Explorer D4) produced N byte-identical trees for N sessions.
 */
export function findWorkspaceExplorerPanel(
	panels: readonly DsiPanelEntry[],
	root: string
): DsiWorkspaceExplorerPanel | undefined {
	return panels.find((p): p is DsiWorkspaceExplorerPanel =>
		p.kind === 'workspace-explorer' && p.root === root
	);
}

/**
 * The open workspace-file panel for a (sessionId, path) pair — the same
 * composite-key rule as D5: two sessions sharing a workspace hold distinct
 * file panels, and a repeat file click focuses.
 */
export function findWorkspaceFilePanel(
	panels: readonly DsiPanelEntry[],
	sessionId: string,
	path: string
): DsiWorkspaceFilePanel | undefined {
	return panels.find(
		(p): p is DsiWorkspaceFilePanel =>
			p.kind === 'workspace-file' && p.sessionId === sessionId && p.path === path
	);
}

/**
 * The explorer's slot (The Shared Tree ADR 2026-09-17, D3): the FOCUSED
 * slot — the explorer is NOT a lineage child; a workspace tree has no
 * parent session, only an opener. The retired after-source rule
 * (Workspace Explorer D3, "Parent → explorer → file") interposed the
 * panel inside a conversation's family unit — the family clamp inside
 * focusedInsertionSlot still keeps any real family unsplit.
 */
export function workspaceExplorerSlot(
	panels: readonly DsiPanelEntry[],
	selectedIndex: number,
	facts: MoveFacts
): number {
	return focusedInsertionSlot(panels, selectedIndex, facts.parentOf);
}

/**
 * The file panel's slot (Workspace Explorer D3): directly BELOW its
 * explorer panel — matched by the explorer's panel ID, so the rule holds
 * even when the explorer's conversation panel is closed — else the
 * caller's fallback (the focused-slot default) when the explorer itself
 * is closed.
 */
export function workspaceFileSlot(
	panels: readonly DsiPanelEntry[],
	explorerPanelId: string,
	fallback: number
): number {
	const explorerIdx = panels.findIndex((p) => p.id === explorerPanelId);
	return explorerIdx >= 0 ? explorerIdx + 1 : fallback;
}

/** Children index shape the lineage facts publish (slim structural view). */
export type ChildrenByParent = ReadonlyMap<string, readonly DsiSessionSummary[]>;

/**
 * The glass FIRST slot under its opener (operator ruling 2026-10-24):
 * a summoned/spawned glass lands DIRECTLY below its opener - past the
 * opener document tail, BEFORE every adopted child - matching the
 * spine tree wire order -1 (the ghost always reads as the first
 * child). Supersedes the region-end placement for the glass only.
 */
export function glassFirstSlot(
	panels: readonly DsiPanelEntry[],
	openedBy: string
): number {
	const openerIdx = panels.findIndex(
		(p) => p.kind === "conversation" && p.sessionId === openedBy
	);
	if (openerIdx === -1) return panels.length;
	return docTailEnd(panels, openerIdx, openedBy) + 1;
}

/**
 * Insert-before-focused slot (operator spec, 2026-08-31): a fresh panel
 * lands at the FOCUSED panel's index — immediately before it — and takes
 * focus (the route selects it). 0 when nothing is focused (empty floor,
 * stale selection) — the old front-add stays the fallback. Math.max keeps
 * splice's negative-index semantics out of the no-selection case.
 *
 * Family clamp (lineage I2): a slot strictly inside a family would wedge
 * the newcomer between a spawner and its pinned child — unitOf/blockBounds,
 * the sidebar's familyRenderOrder, and the adoption slot walk all assume
 * families stay contiguous on the floor. When the focus is a family CHILD,
 * the slot climbs to the family head — the nearest non-splitting slot left
 * of the focus (parentOf only carries on-floor parents, so an orphan child
 * is a root here, its own unit). A lone panel or a family head keeps the
 * exact focus slot.
 *
 * Manager focus (ADR D6): no session, no family — the slot is the focus
 * itself.
 *
 * Workspace member focus (2026-09-10): the explorer/file pair is a family
 * unit in the SAME block math (blockBounds — the Loadinjected D3 walk-back
 * grammar), so the clamp is the SAME one: insert at the unit head — the
 * PARENT position, left of the block — never between explorer and file.
 */
export function focusedInsertionSlot(
	panels: readonly DsiPanelEntry[],
	selectedIndex: number,
	parentOf: ReadonlyMap<string, string>
): number {
	const focus = Math.max(0, selectedIndex);
	const focused = panels[focus];
	if (focused === undefined) return 0;
	if (
		focused.kind === 'workspace-explorer' ||
		focused.kind === 'workspace-file' ||
		focused.kind === 'browser'
	) {
		// The glass joins the clamp (BUG 2026-10-23, the glass wedge): a
		// focused browser panel used to fall through as family-less, so the
		// insert-before-focused slot was the glass's OWN index — the newcomer
		// wedged between the opener's family and its sticky glass. blockBounds'
		// browser branch (ADR-0036 Amendment 2) resolves the opener's family
		// block — or the glass itself when keyless (ControlBar, own unit) —
		// the same nearest non-splitting slot the workspace pair gets.
		const block = blockBounds(panels, focus, { parentOf });
		return block === null ? focus : block[0];
	}
	if (focused.kind !== 'conversation') return focus;
	let head = focused.sessionId;
	for (;;) {
		const parent = parentOf.get(head) ?? null;
		if (parent === null) break;
		head = parent;
	}
	if (head === focused.sessionId) return focus;
	const headIndex = panels.findIndex((p) => p.kind === 'conversation' && p.sessionId === head);
	return headIndex >= 0 ? Math.min(headIndex, focus) : focus;
}

/**
 * Lineage-order slot below an OPEN spawner (operator spec, 2026-08-28):
 * after the spawner AND after every already-adopted sibling that PRECEDES
 * the child in wire order — plus those siblings' own panels (an adopted
 * subtree travels whole). Ghost clicks and sub-agent replacements keep the
 * family region in the ghost list's order regardless of arrival sequence:
 * adopting sub2 then sub3 lands |A|sub2|sub3|, a late sub1 slots back to
 * |A|sub1|sub2|sub3|.
 */
export function lineagePinnedSlot(
	panels: readonly DsiPanelEntry[],
	childrenByParent: ChildrenByParent,
	parentSessionId: string,
	childSessionId: string
): number {
	let base =
		panels.findIndex((p) => p.kind === 'conversation' && p.sessionId === parentSessionId) + 1;
	// The source's document children keep their directly-below slot (ADR
	// D3): a new session child lands BELOW the document tail, never
	// between the source and its documents.
	base = docTailEnd(panels, base - 1, parentSessionId) + 1;
	const siblings = childrenByParent.get(parentSessionId) ?? [];
	const mine = siblings.findIndex((s) => s.sessionId === childSessionId);
	const closure = new Set(
		siblings.slice(0, mine < 0 ? siblings.length : mine).map((s) => s.sessionId)
	);
	const stack = [...closure];
	while (stack.length > 0) {
		for (const k of childrenByParent.get(stack.pop()!) ?? []) {
			if (!closure.has(k.sessionId)) {
				closure.add(k.sessionId);
				stack.push(k.sessionId);
			}
		}
	}
	let index = base;
	while (index < panels.length) {
		const at = panels[index];
		// The ghost guards the family head (Ladder Amendment 2, operator
		// 2026-10-24): the glass is the FIRST child — a newly pinned child
		// lands AFTER it, never between the opener and its ghost.
		if (at.kind === 'browser' && at.openedBy === parentSessionId) {
			index++;
			continue;
		}
		if (at.kind !== 'conversation' || !closure.has(at.sessionId)) break;
		index++;
	}
	return index;
}

/** Wire parent of a session from the children index (null at a root or
 *  off-wire id) — the chain-adoption walk's step. */
export function wireParentOf(
	childrenByParent: ChildrenByParent,
	sessionId: string
): string | null {
	for (const [parent, kids] of childrenByParent) {
		if (kids.some((k) => k.sessionId === sessionId)) return parent;
	}
	return null;
}

/**
 * The adopt-family walk (operator spec, 2026-08-28): the off-floor
 * ancestor chain, NEAREST first (the direct spawner leads), climbing from
 * the seed parent until the nearest OPEN ancestor (the anchor) or a root.
 * With an anchor the family pins under it; with none the whole family
 * joins before the focused slot — never a dangling child.
 */
export function adoptionChain(
	childrenByParent: ChildrenByParent,
	seedParent: string,
	hasOpenSession: (sessionId: string) => boolean
): { chain: string[]; anchor: string | null } {
	const chain: string[] = [seedParent];
	let anchor: string | null = null;
	for (;;) {
		const top = chain[chain.length - 1];
		const grand = wireParentOf(childrenByParent, top);
		if (grand === null) break;
		if (hasOpenSession(grand)) {
			anchor = grand;
			break;
		}
		chain.push(grand);
	}
	return { chain, anchor };
}
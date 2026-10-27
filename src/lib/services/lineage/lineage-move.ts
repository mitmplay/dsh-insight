/**
 * lineage-move.ts — unit-aware ordering ops (task 1.2; ADR "The Lineage
 * Pin" D4 + the worked example). PURE like lineage.ts: plain functions
 * over plain arrays; no `$state`, no fetch, no component imports.
 *
 * The pin, encoded as operations:
 * - a child row sits directly below its spawner — ALWAYS (I2); a fork
 *   child is pinned the same way (2026-09-01 amendment — move facts ride
 *   the family edges, not the origin kind)
 * - a parent plus its contiguous children form a family unit; the unit
 *   moves as ONE block (I1, I3)
 * - a child's move is clamped to its sibling range: `null` at the unit's
 *   edges so the caller HIDES the button (unreachable, not merely blocked)
 * - a childless root's move LEAPS the adjacent family block in one step
 *   (never swaps with the unit's last child — that would re-parent by
 *   adjacency)
 * - nothing here ever writes or rewrites parentSessionId (never re-parent)
 */
import type { DsiPanelEntry } from '$lib/types';
import type { LineageFacts } from './lineage';

/** Session id of a floor panel — null for non-conversation kinds (ADR D6:
 *  a manager panel belongs to no family; it is its own unit, never a
 *  descendant, never a matched parent). */
function sessionOf(p: DsiPanelEntry): string | null {
	return p.kind === 'conversation' ? p.sessionId : null;
}

/**
 * The end index of the contiguous injected-doc tail following the index
 * "end" whose documents belong to "sourceSessionId" (Loadinjected ADR
 * D3, consolidated 2026-09-07). DOCUMENTS ONLY — deliberately NOT the
 * workspace tail (2026-09-10 order fix): a session child pinned under
 * this parent lands directly below it (the Lineage Pin) and pushes the
 * explorer/file pair right, keeping the floor order identical to the
 * sidebar's familyRenderOrder. The workspace pair stays contiguous via
 * unitOf/explorerUnit — it does not displace pinned children.
 */
export function docTailEnd(
	panels: readonly DsiPanelEntry[],
	end: number,
	sourceSessionId: string
): number {
	let i = end;
	while (i + 1 < panels.length) {
		const p = panels[i + 1];
		if (p.kind !== 'injected-doc' || p.sourceSessionId !== sourceSessionId) break;
		i++;
	}
	return i;
}

/** Does the file panel's edge name this explorer — directly, or through
 *  the legacy null edge restored before the edge existed (then adjacency
 *  plus the shared session IS the edge; the dedupe keeps one explorer per
 *  session, so the match is unambiguous)? */
function fileBelongsTo(file: DsiPanelEntry, explorer: DsiPanelEntry): boolean {
	return (
		file.kind === 'workspace-file' &&
		explorer.kind === 'workspace-explorer' &&
		(file.explorerPanelId === explorer.id ||
			(file.explorerPanelId === null && file.sessionId === explorer.sessionId))
	);
}

/**
 * The workspace-explorer unit at idx: the explorer plus the contiguous
 * workspace-file children whose edge names it (2026-09-10 lineage fix —
 * the explorer's files travel with it, the same block math that carries
 * an injected-doc with its conversation). Any other index resolves to its
 * own singleton unit.
 */
function explorerUnit(panels: readonly DsiPanelEntry[], idx: number): [number, number] {
	const explorer = panels[idx];
	if (explorer === undefined || explorer.kind !== 'workspace-explorer') return [idx, idx];
	let end = idx;
	while (end + 1 < panels.length) {
		const p = panels[end + 1];
		if (fileBelongsTo(p, explorer)) end++;
		else break;
	}
	return [idx, end];
}

/** Family facts the ops need — a slim view over LineageFacts (kept pure). */
export interface MoveFacts {
	/** sessionId → parent sessionId (absent for roots). */
	parentOf: ReadonlyMap<string, string>;
}

/**
 * Derive MoveFacts from the lineage facts, FLOOR-AWARE: only parent edges
 * whose spawner holds an open panel count. A child whose spawner left the
 * floor (ADR D6 close-parent case) heads its OWN unit and moves freely —
 * ADR §8 control matrix: "Orphan child panel — free (it IS the unit now)".
 * Rendering already degrades such rows to depth 0 + the spawned-by hint;
 * before this filter the move ops still treated them as nailed children,
 * hiding both buttons forever (probe-verified 2026-08-27).
 */
export function moveFactsFrom(
	lineage: LineageFacts,
	openSessionIds: ReadonlySet<string>
): MoveFacts {
	const parentOf = new Map<string, string>();
	for (const [parent, kids] of lineage.childrenByParent) {
		if (!openSessionIds.has(parent)) continue; // off-floor spawner → orphan roots here
		for (const kid of kids) parentOf.set(kid.sessionId, parent);
	}
	return { parentOf };
}

/**
 * Move one panel within the floor order, honoring the pin. Returns the next
 * array, or null when the move is not offered (child at its sibling-range
 * edge; caller hides the button).
 */
export function movePanelLineage(
	panels: readonly DsiPanelEntry[],
	panelId: string,
	dir: 'up' | 'down',
	facts: MoveFacts
): DsiPanelEntry[] | null {
	const index = panels.findIndex((p) => p.id === panelId);
	if (index === -1) return null;

	const sessionId = sessionOf(panels[index]);
	const parent = sessionId !== null ? (facts.parentOf.get(sessionId) ?? null) : null;

	// CHILD: moves its SUB-UNIT (self + its own descendants — the pin is
	// recursive) within the sibling range, swapping with adjacent SIBLING
	// blocks only. The parent above or a stranger below ends the range:
	// null → the caller hides the button (unreachable, not merely blocked).
	if (parent !== null && sessionId !== null) {
		const unit = unitOf(panels, sessionId, facts);
		if (unit === null) return null;
		const [start, end] = unit;
		if (dir === 'up') {
			if (start === 0) return null;
			const aboveSid = sessionOf(panels[start - 1]);
			if (aboveSid === null || (facts.parentOf.get(aboveSid) ?? null) !== parent) return null;
			const neighbor = blockBounds(panels, start - 1, facts);
			if (neighbor === null) return null;
			return [
				...panels.slice(0, neighbor[0]),
				...panels.slice(start, end + 1),
				...panels.slice(neighbor[0], start),
				...panels.slice(end + 1)
			];
		}
		if (end === panels.length - 1) return null;
		const belowSid = sessionOf(panels[end + 1]);
		if (belowSid === null || (facts.parentOf.get(belowSid) ?? null) !== parent) return null;
		const neighbor = blockBounds(panels, end + 1, facts);
		if (neighbor === null) return null;
		return [
			...panels.slice(0, start),
			...panels.slice(end + 1, neighbor[1] + 1),
			...panels.slice(start, end + 1),
			...panels.slice(neighbor[1] + 1)
		];
	}

	// PARENT/ROOT: the unit (self + contiguous children) moves as one block,
	// and the NEIGHBOR it crosses is also treated as a whole block — a
	// childless root adjacent to a family LEAPS the entire family unit in
	// one step (never swaps with the unit's last child: that would strand
	// children below a stranger — the ADR worked example's ✗ outcome).
	// Non-conversation kinds (ADR D6): family-less — the panel is its own
	// unit and moves positionally, crossing neighbors as whole blocks.
	// A workspace panel (explorer or file) moves as its explorer unit —
	// the file never moves independently of its explorer (2026-09-10
	// lineage fix); other family-less kinds move positionally.
	let unit: readonly [number, number] | null;
	if (sessionId === null) {
		const at = panels[index];
		unit =
			at.kind === 'workspace-file' || at.kind === 'workspace-explorer'
				? blockBounds(panels, index, facts)
				: ([index, index] as const);
	} else {
		unit = unitOf(panels, sessionId, facts);
	}
	if (unit === null) return null;
	const [start, end] = unit;
	if (dir === 'up') {
		if (start === 0) return null; // already at the top
		const neighbor = blockBounds(panels, start - 1, facts);
		if (neighbor === null) return null;
		const [neighborStart] = neighbor;
		return [
			...panels.slice(0, neighborStart),
			...panels.slice(start, end + 1),
			...panels.slice(neighborStart, start),
			...panels.slice(end + 1)
		];
	}
	if (end === panels.length - 1) return null; // already at the bottom
	const neighbor = blockBounds(panels, end + 1, facts);
	if (neighbor === null) return null;
	const [, neighborEnd] = neighbor;
	return [
		...panels.slice(0, start),
		...panels.slice(end + 1, neighborEnd + 1),
		...panels.slice(start, end + 1),
		...panels.slice(neighborEnd + 1)
	];
}

/**
 * The block bounds [start, end] of the FAMILY UNIT containing index `idx`:
 * a root's own unit, or — for a child — the unit of its root ancestor
 * (children sit directly below their parent, I2, so walking up the
 * parent chain reaches the family head). Null when idx is out of range.
 */
export function blockBounds(
	panels: readonly DsiPanelEntry[],
	idx: number,
	facts: MoveFacts
): [number, number] | null {
	if (idx < 0 || idx >= panels.length) return null;
	let sessionId = sessionOf(panels[idx]);
	if (sessionId === null) {
		// A document child never moves as its own block: it travels with its
		// source conversation (ADR D3, consolidated grammar). Walk back over
		// the contiguous doc run — the conversation above it heads the
		// block. A workspace panel's block is its EXPLORER UNIT — the
		// explorer plus its contiguous file children (Shared Tree ADR
		// 2026-09-17, D3: the explorer is a non-family panel; the retired
		// family-adjacent walk made it ride its conversation's family).
		// Other family-less kinds — manager, settings — are their own unit.
		const at = panels[idx];
		if (at.kind === 'workspace-file' || at.kind === 'workspace-explorer') {
			let i = idx;
			while (i > 0 && panels[i - 1].kind === 'workspace-file') i--;
			const head = panels[i - 1];
			if (at.kind === 'workspace-explorer') return explorerUnit(panels, idx);
			if (
				head !== undefined &&
				head.kind === 'workspace-explorer' &&
				fileBelongsTo(at, head)
			) {
				return explorerUnit(panels, i - 1);
			}
			return [idx, idx];
		}
		if (at.kind === 'browser') {
			// ADR-0036 Amendment 2 (D5/D6): the glass travels with its opener —
			// back over the contiguous browser run to the family conversation
			// above; the opener must belong to THAT family (D6 pins the glass
			// at the family-region end, so the head may be a sub-agent, not the
			// opener itself — climb openedBy's chain over the move facts).
			let i = idx;
			while (i > 0 && panels[i - 1].kind === 'browser') i--;
			const head = panels[i - 1];
			const inFamily = (id: string | undefined, root: string | undefined): boolean => {
				if (id === undefined || root === undefined) return false;
				let cur: string | null = id;
				for (let guard = 0; guard < panels.length + 1 && cur !== null; guard++) {
					if (cur === root) return true;
					cur = facts.parentOf.get(cur) ?? null;
				}
				return false;
			};
			if (head === undefined || head.kind !== 'conversation' || !inFamily(head.sessionId, at.openedBy)) {
				return [idx, idx];
			}
			sessionId = head.sessionId;
		}
		// The browser branch above already claimed the family (sessionId set):
		// fall through to the climb instead of the family-less return.
		if (at.kind !== 'injected-doc' && sessionId === null) return [idx, idx];
		if (at.kind === 'injected-doc') {
			let i = idx;
			while (i > 0 && panels[i - 1].kind === 'injected-doc') i--;
			const head = panels[i - 1];
			if (head === undefined || head.kind !== 'conversation') return [idx, idx];
			if (head.sessionId !== at.sourceSessionId) {
				return [idx, idx];
			}
			sessionId = head.sessionId;
		}
	}
	// Climb to the family head (root ancestor on the floor). Every
	// sessionId === null path above already returned — this guard only
	// restores the narrowing the branch merge loses.
	if (sessionId === null) return [idx, idx];
	for (let guard = 0; guard < panels.length + 1; guard++) {
		const parent = facts.parentOf.get(sessionId) ?? null;
		if (parent === null) break;
		const parentIdx = panels.findIndex((p) => sessionOf(p) === parent);
		if (parentIdx === -1) break; // parent off-floor: this child heads its block
		const parentSid = sessionOf(panels[parentIdx]);
		if (parentSid === null) break;
		sessionId = parentSid;
	}
	return unitOf(panels, sessionId, facts);
}

/**
 * The contiguous family unit of a parent panel: [startIndex, endIndex]
 * covering the parent and every following child panel whose parent chain
 * roots at it (children of its children included — depth generalizes).
 * Returns null when the session is not on the floor.
 */
function unitOf(
	panels: readonly DsiPanelEntry[],
	sessionId: string,
	facts: MoveFacts
): [number, number] | null {
	const start = panels.findIndex((p) => sessionOf(p) === sessionId);
	if (start === -1) return null;
	/** Is `id` a descendant of `root` (any depth)? */
	const isDescendant = (id: string, root: string): boolean => {
		const parent = facts.parentOf.get(id) ?? null;
		if (parent === null) return false;
		if (parent === root) return true;
		return isDescendant(parent, root);
	};
	// The block walk consumes, contiguously: session descendants (any
	// depth), then each document child whose source is already in the
	// family — nested doc tails included (F's doc between F and A's doc).
	// A workspace-explorer does NOT join the family block (Shared Tree
	// ADR 2026-09-17, D3: the explorer is a non-family panel — moving the
	// conversation never carries it; the retired 2026-09-10 absorption is
	// the lineage costume D3 removes). A stranger of any kind ends the
	// block (ADR D3, consolidated grammar: document children travel with
	// the family, never stranded).
	const familySessions = new Set([sessionId]);
	let end = start;
	for (let i = start + 1; i < panels.length; i++) {
		const p = panels[i];
		const sid = sessionOf(p);
		if (sid !== null && isDescendant(sid, sessionId)) {
			end = i;
			familySessions.add(sid);
			continue;
		}
		if (p.kind === 'injected-doc' && familySessions.has(p.sourceSessionId)) {
			end = i;
			continue;
		}
		// The glass rides the family block too (Amendment 2): a browser whose
		// opener is already in the family is contiguous family — the operator's
		// move of the main agent carries it (the doc-tail pattern, session-keyed).
		if (p.kind === 'browser' && p.openedBy !== undefined && familySessions.has(p.openedBy)) {
			end = i;
			continue;
		}
		break;
	}
	return [start, end];
}

/** Placement decision for adding/replacing a panel with `sessionId`. */
export type Placement =
	/** Ordinary session — today's behavior (replace selected / append). */
	| { kind: 'plain' }
	/** Sub-agent whose spawner is on the floor — pin directly below it. */
	| { kind: 'pinned'; parentSessionId: string; index: number }
	/** Sub-agent whose spawner is OFF the floor — adopt the family: the
	 *  spawner takes the slot, the child pins below it (never travels
	 *  alone — D4). */
	| { kind: 'adopt-family'; parentSessionId: string };

/**
 * Where does a session land when opened/swapped onto the floor? (D4.)
 * A family child NEVER lands in an arbitrary slot: below its parent when
 * the parent holds a panel — sub-agent or fork alike (the fork amendment,
 * 2026-09-01: the fork ADR's "the Lineage Pin files it under its parent").
 * Off the floor, the two kinds part ways: a sub-agent's family comes along
 * (adopt-family — it never travels alone), while a fork stands alone (its
 * parent's presence is a courtesy, not a requirement — adopting a fork's
 * whole ancestry would open sessions the operator never asked for).
 */
export function replaceTarget(
	panels: readonly DsiPanelEntry[],
	sessionId: string,
	lineage: LineageFacts
): Placement {
	const parent = lineageParentOfSession(sessionId, lineage);
	if (parent === null) return { kind: 'plain' }; // no edge, or orphan: root behavior
	const parentIndex = panels.findIndex((p) => sessionOf(p) === parent);
	if (parentIndex === -1) {
		if (!lineage.subagentIds.has(sessionId)) return { kind: 'plain' }; // fork stands alone
		return { kind: 'adopt-family', parentSessionId: parent };
	}
	return { kind: 'pinned', parentSessionId: parent, index: parentIndex + 1 };
}

/** Internal: the direct parent's id from the facts' children index —
 *  sub-agents AND forks (null when the session has no edge in the feed). */
function lineageParentOfSession(sessionId: string, lineage: LineageFacts): string | null {
	for (const [parent, kids] of lineage.childrenByParent) {
		if (kids.some((k) => k.sessionId === sessionId)) return parent;
	}
	return null;
}

/**
 * Insert index for AFTER-SOURCE placement (the fork child, 2026-09-01):
 * directly below the panel showing `sourceSessionId` — the source keeps
 * its slot, the newcomer takes the next one. The family clamp mirrors
 * the Focused Slot's, downward: the slot rides PAST the source's whole
 * family unit, so a fork never wedges between a spawner and its pinned
 * children (I2 — families stay contiguous). Null when the source holds
 * no panel; the caller falls back to its own default placement.
 */
export function afterSourceSlot(
	panels: readonly DsiPanelEntry[],
	sourceSessionId: string,
	facts: MoveFacts
): number | null {
	const unit = unitOf(panels, sourceSessionId, facts);
	return unit === null ? null : unit[1] + 1;
}

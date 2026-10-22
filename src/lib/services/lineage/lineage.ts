/**
 * lineage.ts — the lineage derivation authority (spec: 2026-08-27 DSI
 * Sub-Agent Lineage Sidebar, tasks 1.1/1.2; decisions: ADR "The Lineage
 * Pin" D1-D7).
 *
 * PURE MODULE BY CONTRACT (karpathy Layer 3 Q6): no `$state`, no `fetch`,
 * no component imports, no Svelte reactivity — every export is a plain
 * function over plain data, so any consumer (route, test, future surface)
 * derives identical facts. Lineage is DATA, not layout: nothing here ever
 * WRITES a parentSessionId; every fact is re-derived from the spine feed
 * on each call (ADR §3 — the sidebar rides the state channel, never the
 * one-hop notice channel).
 *
 * Model (host facts, passed through the server boundary task 1.3):
 * - a spawned session carries parentSessionId + origin 'subagent'
 * - a forked session carries parentSessionId with origin null (the fork
 *   button, 2026-09-01 — the host records `parentSession` either way)
 * - parentSessionId null/absent on user-created sessions
 * - absent and null mean the same thing here (boundary normalizes to null)
 *
 * FAMILY EDGES vs ORIGIN KIND (the 2026-09-01 fork amendment): the parent
 * EDGE — parentSessionId whose parent is present in the feed — is the
 * family truth for LAYOUT (childrenByParent, depthById, spine nesting,
 * move units and clamps) regardless of origin; `origin: 'subagent'` keeps
 * governing only SPAWN semantics (ghost rows, suppression, the delegated
 * roll-up, the subagents-hidden toggle). DSH's own web client nests by the
 * raw parentSessionId (flattenLineage) — this module now matches.
 */
import type { DsiConversationPanel, DsiSessionSummary } from '$lib/types';

/** The derivation facts one call produces — read-only views over the feed. */
export interface LineageFacts {
	/** sessionId → direct children (spawn order = spine order). */
	childrenByParent: ReadonlyMap<string, DsiSessionSummary[]>;
	/** sessionId → depth (root 0). Orphans degrade to 0 (I4: never dropped). */
	depthById: ReadonlyMap<string, number>;
	/** sessionId → count of RUNNING descendants (recursive, any depth —
	 * rolls up through idle middles; live-verified 2026-08-27 overlap run). */
	runningDescendants: ReadonlyMap<string, number>;
	/** Every sub-agent-origin session id known to this feed. */
	subagentIds: ReadonlySet<string>;
	/** Every session id with a parent edge in this feed — sub-agents AND
	 *  forks (the layout truth; the spine nesting gate). */
	familyIds: ReadonlySet<string>;
}

/**
 * Derive the family facts from the spine feed.
 * Cycles fail soft: members the walk cannot reach from any root emit as
 * roots (depth 0) so no session is ever lost (I4) — DSH flattenLineage
 * precedent. Orphan (parent absent from the feed) degrades to root.
 */
export function deriveLineage(
	spineRows: readonly DsiSessionSummary[],
	_panels: readonly DsiConversationPanel[] = []
): LineageFacts {
	const byId = new Map<string, DsiSessionSummary>();
	for (const row of spineRows) byId.set(row.sessionId, row);

	const childrenByParent = new Map<string, DsiSessionSummary[]>();
	const subagentIds = new Set<string>();
	const familyIds = new Set<string>();
	for (const row of spineRows) {
		if (subagentOrigin(row)) subagentIds.add(row.sessionId); // origin truth, edge or not
		const parent = row.parentSessionId ?? null;
		if (parent === null || !byId.has(parent)) continue; // root, or orphan → degrades to root (I4)
		familyIds.add(row.sessionId);
		const list = childrenByParent.get(parent) ?? [];
		list.push(row);
		childrenByParent.set(parent, list);
	}

	// Depth: DFS from true roots over child edges (iterative — no recursion
	// limits). Members of a cycle — and anything downstream of one — are
	// unreachable from any root and land at depth 0: fail-soft, never
	// dropped (I4; DSH flattenLineage's fallback-walk precedent).
	const depthById = new Map<string, number>();
	const isRoot = (id: string): boolean => {
		const row = byId.get(id);
		if (row === undefined) return true;
		const parent = row.parentSessionId ?? null;
		return parent === null || !byId.has(parent);
	};
	const stack: Array<[string, number]> = [];
	for (const id of byId.keys()) if (isRoot(id)) stack.push([id, 0]);
	while (stack.length > 0) {
		const next = stack.pop();
		if (next === undefined) break;
		const [id, depth] = next;
		if (depthById.has(id)) continue;
		depthById.set(id, depth);
		for (const kid of childrenByParent.get(id) ?? []) {
			stack.push([kid.sessionId, depth + 1]);
		}
	}
	for (const id of byId.keys()) if (!depthById.has(id)) depthById.set(id, 0);

	// Running roll-up: each sub-agent credits EVERY ancestor up its chain
	// (recursive through idle middles) — indexSubagentDescendants pattern.
	const runningDescendants = new Map<string, number>();
	for (const id of subagentIds) {
		const row = byId.get(id);
		if (row === undefined || !row.running) continue;
		const seen = new Set<string>([id]);
		let parent = row.parentSessionId ?? null;
		while (parent !== null && !seen.has(parent)) {
			seen.add(parent);
			runningDescendants.set(parent, (runningDescendants.get(parent) ?? 0) + 1);
			const parentRow = byId.get(parent);
			parent = parentRow?.parentSessionId ?? null;
		}
	}

	return { childrenByParent, depthById, runningDescendants, subagentIds, familyIds };
}

/** One ghost view row — a sub-agent visible under its OPEN parent (D5). */
export interface GhostRow {
	/** The sub-agent session id (adopt target). */
	sessionId: string;
	/** The parent session id whose panel hosts this ghost. */
	parentSessionId: string;
	/** Depth for indent rendering (parent 0, child 1, grandchild 2 …). */
	depth: number;
	/** Live title/status from the spine (ghosts are views, never panels). */
	running: boolean;
	title: string | null;
}

/** Internal: effective parent map for the GHOST and SUPPRESSION walks —
 *  sub-agent EDGES ONLY. A fork hop must not anchor a ghost: a ghost whose
 *  parent row renders neither as panel nor ghost would emit nowhere (its
 *  cluster hangs under a row the walk never reaches), and suppression
 *  would then hide it from the spine too — an I4 invisibility. Layout
 *  consumers (moves, renders) use childrenByParent/familyIds instead. */
function parentMapOf(lineage: LineageFacts): Map<string, string> {
	const parentOf = new Map<string, string>();
	for (const [parent, kids] of lineage.childrenByParent) {
		for (const kid of kids) if (subagentOrigin(kid)) parentOf.set(kid.sessionId, parent);
	}
	return parentOf;
}

/** Internal: does `id`'s ancestor chain reach any open session? (The
 *  WHOLE subtree under an open panel is family-visible — ADR D5 depth
 *  amendment: ghost nesting is recursive, never only direct children.) */
function rootedUnderOpen(
	id: string,
	openSessionIds: ReadonlySet<string>,
	parentOf: ReadonlyMap<string, string>
): boolean {
	const seen = new Set<string>([id]);
	let node: string | undefined = id;
	for (;;) {
		const parent: string | undefined = parentOf.get(node ?? '');
		if (parent === undefined) return false;
		if (openSessionIds.has(parent)) return true;
		if (seen.has(parent)) return false; // cycle cut
		seen.add(parent);
		node = parent;
	}
}

/**
 * Ghost rows for the panel group (RECURSIVE, ADR D5 depth amendment):
 * every sub-agent whose ANCESTOR CHAIN reaches an open panel and that is
 * not itself an open panel — a grandchild ghost nests under its ghost
 * parent row. Ghosts never open panels on their own (spawn never touches
 * the floor layout — commitment).
 */
export function ghostRowsFor(
	panels: readonly DsiConversationPanel[],
	spineRows: readonly DsiSessionSummary[],
	lineage: LineageFacts
): GhostRow[] {
	const openSessionIds = new Set(panels.map((p) => p.sessionId));
	const byId = new Map(spineRows.map((r) => [r.sessionId, r] as const));
	const parentOf = parentMapOf(lineage);
	const ghosts: GhostRow[] = [];
	for (const id of lineage.subagentIds) {
		const row = byId.get(id);
		if (row === undefined) continue;
		if (openSessionIds.has(id)) continue; // already a real panel
		if (!rootedUnderOpen(id, openSessionIds, parentOf)) continue;
		const parent = row.parentSessionId ?? null;
		if (parent === null) continue;
		ghosts.push({
			sessionId: id,
			parentSessionId: parent,
			depth: lineage.depthById.get(id) ?? 1,
			running: row.running,
			title: row.title
		});
	}
	return ghosts;
}

/** Minimal member view for family render ordering — session id plus the
 *  DIRECT parent's id (null when no parent relation counts here). */
export interface FamilyMember {
	/** The member's session id. */
	id: string;
	/** The direct parent's session id; null when parentless. */
	parent: string | null;
	/** Wire position among the parent's children (lineage order) — the
	 *  sibling-merge key. Present → children keep WIRE order: an adoption
	 *  flips a row's kind IN PLACE (a ghost renders before an adopted
	 *  sibling that follows it in the lineage), panels keep their floor
	 *  order among themselves so moves stay visible. Absent → the legacy
	 *  fallback renders panel children before their ghost siblings. */
	order?: number;
}

/** One entry of the family render order — a panel row at its floor
 *  position, or a ghost row nested in its family. */
export type FamilyRenderEntry<TPanel, TGhost> =
	| { kind: 'panel'; member: TPanel }
	| {
			kind: 'ghost';
			member: TGhost;
			/** Nearest PANEL ancestor hosting this ghost's cluster — the
			 *  fold owner (folding that panel hides this ghost). */
			anchor: string;
	  };

/**
 * The panel group's RENDER ORDER (ADR D4 worked example: a real child
 * panel renders DIRECTLY below its spawner — `s.agent 1 (✕)` above
 * `s.agent 2 (>)` — ghosts never wedge between a parent and its real
 * children). Per panel, in floor order: the panel row, then its REAL
 * child panel rows (floor order, recursively), then its GHOST children
 * (feed order, each with its ghost subtree). A panel whose parent holds
 * no panel (orphan, D6) heads its own block at its floor position.
 *
 * Before this, each panel row rendered its whole ghost cluster directly
 * after itself, so adopting a first child sank the new panel below the
 * parent's remaining ghost siblings (live-reproduced 2026-08-27: adopted
 * child rendered 4th of 4 while the floor array had it at parentIndex+1).
 * Cycle-safe: every member renders at most once.
 */
export function familyRenderOrder<TPanel extends FamilyMember, TGhost extends FamilyMember>(
	panels: readonly TPanel[],
	ghosts: readonly TGhost[]
): Array<FamilyRenderEntry<TPanel, TGhost>> {
	const ghostsByParent = new Map<string, TGhost[]>();
	for (const g of ghosts) {
		const key = g.parent ?? '';
		const list = ghostsByParent.get(key) ?? [];
		list.push(g);
		ghostsByParent.set(key, list);
	}
	// Wire order governs INSIDE a ghost cluster too (ADR-0037 as-built:
	// the folded glass flushes first under its opener). Stable sort by
	// the member's own order — missing sorts last (Infinity).
	for (const [key, list] of ghostsByParent) {
		ghostsByParent.set(
			key,
			[...list].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
		);
	}
	const out: Array<FamilyRenderEntry<TPanel, TGhost>> = [];
	const seenPanels = new Set<string>();
	const seenGhosts = new Set<string>();
	/** One ghost + its nested ghost children (a ghost's children are
	 *  always ghosts — a panel's parent is never a ghost). */
	const renderGhostSubtree = (g: TGhost, anchor: string): void => {
		if (seenGhosts.has(g.id)) return; // cycle cut
		seenGhosts.add(g.id);
		out.push({ kind: 'ghost', member: g, anchor });
		for (const kid of ghostsByParent.get(g.id) ?? []) renderGhostSubtree(kid, anchor);
	};
	const renderPanel = (p: TPanel): void => {
		if (seenPanels.has(p.id)) return;
		seenPanels.add(p.id);
		out.push({ kind: 'panel', member: p });
		// Sibling merge (operator spec, 2026-08-28): WIRE order. Panels in
		// floor order (manual moves stay visible); each ghost flushes before
		// the first adopted sibling that FOLLOWS it in the lineage, the
		// rest render after the last — an adoption flips a row's kind in
		// place, never moves it. Missing order → Infinity → ghosts land
		// after the panels (the legacy fallback).
		const panelKids = panels.filter((c) => c.parent === p.id);
		const ghostKids = ghostsByParent.get(p.id) ?? [];
		let gi = 0;
		for (const c of panelKids) {
			const threshold = c.order ?? Infinity;
			while (gi < ghostKids.length && (ghostKids[gi].order ?? Infinity) < threshold) {
				renderGhostSubtree(ghostKids[gi], p.id);
				gi += 1;
			}
			renderPanel(c);
		}
		while (gi < ghostKids.length) {
			renderGhostSubtree(ghostKids[gi], p.id);
			gi += 1;
		}
	};
	const panelIds = new Set(panels.map((p) => p.id));
	for (const p of panels) {
		const isChild = p.parent !== null && panelIds.has(p.parent);
		if (!isChild) renderPanel(p); // floor roots + orphans render their whole block
	}
	// Cycle members are never reached from a root — degrade to roots
	// themselves (fail-soft, the module's rule; deriveLineage precedent).
	for (const p of panels) {
		if (!seenPanels.has(p.id)) renderPanel(p);
	}
	// Orphan ghost clusters (2026-10-22): a folded glass whose opener holds
	// NO panel — the last panel closed, the glass folded on (ADR-0037 D4:
	// the ghost row owns the bring-back). Without this walk the cluster
	// renders nowhere at all: the roster's rows gate sees no panels and
	// this function never reaches a ghost whose parent is not a panel.
	// The cluster heads its own block, anchored to its (absent) parent —
	// the fold gates treat an off-floor anchor as transparent.
	for (const g of ghosts) {
		if (seenGhosts.has(g.id)) continue; // flushed inside a cluster above
		if (g.parent !== null && panelIds.has(g.parent)) continue; // anchored under its panel
		renderGhostSubtree(g, g.parent || g.id);
	}
	return out;
}

/**
 * Spine suppression (no double-listing, D5 — recursive with ghosts): a
 * SUB-AGENT visible ANYWHERE under an open panel's subtree (as panel row
 * or nested ghost) never renders as a spine row. Remaining sub-agents
 * stay in the list — they nest under their parent when the parent row
 * renders (SidebarSessionsList, task 4.1) or degrade to root.
 *
 * DELIBERATELY spawn-only (2026-09-01): a fork child is never suppressed.
 * A closed fork renders NOWHERE but the spine — it is not a panel row, not
 * a ghost (ghosts are spawn views) — so suppressing it would erase it. An
 * OPEN fork leaves the spine through the paneled-session filter upstream,
 * not here.
 *
 * W4 signature: OPEN SESSION IDS (the sidebar owner holds ids, not panel
 * entries; the route holds both — one shape serves both call sites).
 */
export function suppressFromSpine(
	spineRows: readonly DsiSessionSummary[],
	lineage: LineageFacts,
	openSessionIds: ReadonlySet<string>
): DsiSessionSummary[] {
	const parentOf = parentMapOf(lineage);
	return spineRows.filter((row) => {
		if (!lineage.subagentIds.has(row.sessionId)) return true; // plain row
		return !rootedUnderOpen(row.sessionId, openSessionIds, parentOf);
	});
}

/**
 * Spine nesting (D6 + I1, contiguity in EVERY list): reorder the ranked,
 * filtered spine rows so every FAMILY CHILD renders directly below its
 * family head's block — sub-agents AND forks (the 2026-09-01 amendment:
 * the spine nests by the same edges the panel group renders by, DSH's own
 * flattenLineage precedent). Live-caught 2026-08-28: the spine rendered
 * feed order with an indent only, so a foreign root session
 * (session-85d8e67c) wedged BETWEEN a parent's indented children — the
 * block read as if the stranger belonged inside the family.
 *
 * `flattenLineage` pattern (DSH web client precedent): the input order is
 * authoritative for ROOTS and SIBLINGS — nesting only makes each child
 * adjacent to its head, it never re-sorts. A sub-agent whose head is absent
 * from `rows` (filtered out, current, paneled) degrades to its input
 * position (I4); cycle members the walk cannot reach emit at the end as
 * roots — never dropped, never duplicated.
 *
 * @param rows ranked+filtered spine rows (render candidates, any order).
 * @param lineage facts over the FULL feed — supplies the family-edge truth
 *   (familyIds); only ids present in `rows` actually nest.
 * @returns the same rows, families contiguous (head, then children in
 *   input order, recursive).
 */
export function nestSpineFamilies(
	rows: readonly DsiSessionSummary[],
	lineage: LineageFacts
): DsiSessionSummary[] {
	const present = new Set(rows.map((r) => r.sessionId));
	// Children index over the CANDIDATE rows only (input order = sibling
	// order): a fact-child the filter removed never renders, and a child
	// whose head the filter removed degrades to its input position.
	const kidsByParent = new Map<string, DsiSessionSummary[]>();
	const isNested = new Set<string>();
	for (const row of rows) {
		const parent = row.parentSessionId ?? null;
		if (parent === null || !lineage.familyIds.has(row.sessionId)) continue;
		if (!present.has(parent)) continue; // orphan in this list → root position (I4)
		const list = kidsByParent.get(parent) ?? [];
		list.push(row);
		kidsByParent.set(parent, list);
		isNested.add(row.sessionId);
	}

	const out: DsiSessionSummary[] = [];
	const seen = new Set<string>();
	const emitSubtree = (row: DsiSessionSummary): void => {
		if (seen.has(row.sessionId)) return; // cycle cut — emit once
		seen.add(row.sessionId);
		out.push(row);
		for (const kid of kidsByParent.get(row.sessionId) ?? []) emitSubtree(kid);
	};
	for (const row of rows) if (!isNested.has(row.sessionId)) emitSubtree(row);
	// Cycle members (unreachable from any head): degrade to roots in input
	// order — fail-soft, the module's rule.
	for (const row of rows) if (!seen.has(row.sessionId)) emitSubtree(row);
	return out;
}

/**
 * Insertion index for adopting/opening a session (the Lineage Pin, D4):
 * a sub-agent splices directly below its spawner (parentIndex + 1 — never
 * appended past the family); everything else appends. Returns panels.length
 * when no anchor exists (orphan → root behavior).
 */
export function insertionIndex(
	panels: readonly DsiConversationPanel[],
	sessionId: string,
	lineage?: LineageFacts
): number {
	const row = (lineage?.subagentIds ?? new Set<string>()).has(sessionId);
	if (!row) return panels.length;
	// parent id needed — recover from the feed the caller passed to derive
	const parent = lineageParentOf(sessionId, lineage);
	if (parent === null) return panels.length;
	const parentIndex = panels.findIndex((p) => p.sessionId === parent);
	if (parentIndex === -1) return panels.length;
	return parentIndex + 1;
}

/** Internal: sub-agent origin check — 'subagent' marks a session the
 *  harness SPAWNED. Fork lineage (parentSessionId, origin null) is a
 *  family edge for layout (see the module doc) but never a spawn fact:
 *  no ghost, no suppression, no delegated roll-up. */
function subagentOrigin(row: DsiSessionSummary): boolean {
	return (row.origin ?? null) === 'subagent';
}

/** Internal: parent id from facts (kept local — not exported surface). */
function lineageParentOf(sessionId: string, lineage?: LineageFacts): string | null {
	if (lineage === undefined) return null;
	for (const [parent, kids] of lineage.childrenByParent) {
		if (kids.some((k) => k.sessionId === sessionId)) return parent;
	}
	return null;
}

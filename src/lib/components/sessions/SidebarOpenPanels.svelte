<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * SidebarOpenPanels — the sidebar's pinned PANEL rows (Panel Floor
	 * W4 task 4.1, ADR-0006 R5): one row per OPEN PANEL on the floor,
	 * rendered above the session filter pills — the FIRST block of the
	 * sidebar's session body (SessionsList), moved out of
	 * SidebarSessionContainer 2026-08-26 so the floor's live set stays
	 * visible without scrolling past the filter controls. Click selects
	 * the panel (registry action, leaf→root); the row's X closes the
	 * panel (workspace context state write, root-owned).
	 *
	 * Row grammar (ADR-0005, interior shared since 2026-08-26):
	 * status glyph + workspace chip + label — the SAME WorkspaceRowItem
	 * fragment the spine renders, so the two lists can never drift.
	 * Running sessions show animated stream bars, idle a static dot;
	 * the selected row is a LIGHT accent field (no color inversion —
	 * see the .row.current note for the contrast audit).
	 *
	 * Floor-aware but floor-optional: reads the workspace context; when
	 * no floor is mounted (home page, no route publishing state) zero
	 * rows render — the block disappears, exactly the pre-floor
	 * behavior of "nothing pinned here".
	 *
	 * Group box (2026-08-24): the open panels render as ONE detached
	 * group — alt surface, border, radius — so the floor's live set
	 * never visually blends into the filter pills below it.
	 *
	 * Move up/down (the vertical twin of the panel header's left/right
	 * chevrons): each row carries registry move buttons, hidden at the
	 * list's edges — the row list IS the floor order, so moving here
	 * reorders the panels on the floor and vice versa.
	 *
	 * Scroll pane (2026-08-24): this component's root is a flex pane
	 * in the sidebar's non-scrolling session body (SessionsList, above
	 * the pills) — NATURAL height for as many panels as the floor
	 * holds, hard-capped at HALF that body column (past the cap it
	 * scrolls internally). The spine below absorbs all the remaining
	 * height. No rows → no pane at all, so the pills head the column
	 * (no floor). The rows body — the interleaved panel/ghost sequence
	 * — is SidebarOpenPanelRows (extracted 2026-09-02) and the
	 * title's focused-name chip is SidebarOpenPanelHeader (same
	 * extraction day); this file owns the header row, the collapse
	 * state, and every action's registry/context write.
	 *
	 * Collapse (2026-08-26): the group ships EXPANDED since 2026-09-18
	 * (collapsed before) — the title carries the floor's focus (`Focused -
	 * <selected session name>`) in BOTH states. The
	 * name renders as SidebarOpenPanelHeader's chip; the ` - `
	 * separator stays text (unconditional since 2026-09-03) so the
	 * title's textContent keeps
	 * the exact `Focused - <name>` string the tests pin. The
	 * toggle persists per workspace desk (localStorage
	 * `dsi-panel-group[_<profile>]`, panel-group-prefs.ts), so a hard
	 * reload honors the last choice. Collapsed, the pane is a fixed
	 * header row; the pills and spine below absorb the freed height —
	 * pure sibling flex reflow, no layout changes anywhere else.
	 *
	 * Lineage fold pair (2026-09-03): the header row also carries the
	 * collapse-all / expand-all pair over every session that HAS lineage
	 * on the floor (a depth-0 panel with children, the same gate the
	 * rows' fold chevron renders under) — the seg-group lives in
	 * SidebarOpenPanelTree (extracted same day); this file derives
	 * the two disable facts, owns the actions, and persists every write
	 * through the same fold choke point as the row chevrons. A collapsed
	 * group arms both segments (nothing visible, no extreme is truth),
	 * and either click expands the group with the fold — a fold command
	 * must show its result.
	 */
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { loadPanelGroupPrefs, savePanelGroupPrefs } from '$lib/utils/panel-group-prefs';
	import {
		addPanelFromSidebar,
		movePanelFromRegistry,
		selectPanelFromRegistry,
		summonGlassFromRegistry
	} from '$lib/services/panels/panel-registry';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { familyRenderOrder } from '$lib/services/lineage/lineage';
	import type { DsiWorkspaceSummary } from '$lib/types';
	import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
	import SidebarOpenPanelHeader from './SidebarOpenPanelHeader.svelte';
	import SidebarOpenPanelRows from './SidebarOpenPanelRows.svelte';
	import SidebarOpenPanelTree from './SidebarOpenPanelTree.svelte';

	let {
		workspaces
	}: {
		/** Host workspace registry — the authority for chip ghost styling. */
		workspaces: DsiWorkspaceSummary[];
	} = $props();

	const ws = $derived(getWorkspaceState());
	const rows = $derived(ws?.rows ?? []);
	const profile = $derived(ws?.profile ?? null);

	/** The focused panel's row — the header title's subject. */
	const selectedRow = $derived(rows.find((r) => r.panel.id === ws?.selectedPanelId) ?? null);

	/** Header name — session title, id when unknown (the row-label grammar). */
	// Manager rows (ADR D6/D10) carry no session id — the title ('Prompt Manager')
	// is always set for them, so the id fallback never fires.
	// Zero-panel fallback (2026-10-22): the roster survives on folded-glass
	// ghosts alone after the last panel closes — the header names the first
	// ghost so the group never reads as an empty "Focused -".
	const headName = $derived(
		selectedRow
			? (selectedRow.title ??
				(selectedRow.panel.kind === 'conversation' ? selectedRow.panel.sessionId : null))
			: (ws?.ghosts ?? [])[0]?.title ?? null
	);

	// EXPANDED by default (2026-09-18 change; collapsed 2026-08-26); the
	// desk's stored choice wins. The effect re-reads on a profile change,
	// so a desk switch re-arms its OWN memory instead of inheriting the
	// previous desk's.
	let collapsed = $state(false);
	$effect(() => {
		collapsed = loadPanelGroupPrefs(profile).collapsed;
	});

	/** Toggle — persist on every flip so a hard reload honors the desk.
	 *  The write carries the fold half (`foldSessionIds()`) so the blob
	 *  never loses the desk's fold map to a collapse flip. */
	function toggle(): void {
		collapsed = !collapsed;
		savePanelGroupPrefs({ collapsed, unfoldedSessionIds: foldSessionIds() }, profile);
	}

	/** Row click — select via the registry (leaf→root action, commitment 2). */
	function onSelect(row: PanelRow): void {
		if (!selectPanelFromRegistry(row.panel.id)) {
			// No floor mounted — the row is inert (it only ever renders
			// from published workspace state, so this is belt-and-braces).
			return;
		}
	}

	/** Move chevron — registry invoke (no floor → false → no-op). */
	function onMove(panelId: string, dir: 'up' | 'down'): void {
		movePanelFromRegistry(panelId, dir);
	}

	// ── Lineage render (2026-08-27 W3 task 3.1 + W6b, ADR D4/D5) ────────
	// The component renders DERIVED facts only — grouping, clamping, and
	// hints arrive on the rows; no lineage computation lives here. The one
	// ordering computation (family interleaving) lives in the pure module
	// (familyRenderOrder); this component only adapts the published rows
	// to its member shape.

	/** Family members over the published rows + ghosts — id + direct
	 *  parent + WIRE ORDER (siblingIndex), the shape familyRenderOrder
	 *  walks and merges by. */
	const panelMembers = $derived(
		rows.map((r) => ({
			id: r.panel.kind === 'conversation' ? r.panel.sessionId : r.panel.id,
			parent: r.parentSessionId ?? null,
			order: r.siblingIndex,
			depth: r.depth ?? 0,
			row: r
		}))
	);
	const ghostMembers = $derived(
		(ws?.ghosts ?? []).map((g) => ({
			id: g.panel.kind === 'conversation' ? g.panel.sessionId : g.panel.id,
			parent: g.parentSessionId ?? '',
			order: g.siblingIndex,
			depth: g.depth ?? 0,
			row: g
		}))
	);
	/** The render sequence: panel rows at floor positions with their real
	 *  children DIRECTLY below them (never below ghost siblings — the
	 *  2026-08-27 adopt-order bug) and ghost clusters after real ones. */
	const renderList = $derived(familyRenderOrder(panelMembers, ghostMembers));
	/** Members by id — the fold walk's membership test (depth decides
	 *  root-ness: a depth-0 panel is a family head or an orphan). */
	const memberById = $derived.by(() => {
		const map = new Map<string, { id: string; parent: string | null; depth: number }>();
		for (const m of [...panelMembers, ...ghostMembers]) map.set(m.id, m);
		return map;
	});
	/** PANEL member ids — the fold gates. Ghost members are TRANSPARENT:
	 *  a nested ghost cluster folds as one unit with its anchor (ghost
	 *  rows carry no chevron — they are adopt views, not controls). */
	const panelSessionIds = $derived(new Set(panelMembers.map((m) => m.id)));
	/** Direct children per session — BOTH kinds, panel or ghost (no
	 *  discrimination by the child's panel-ness, 2026-08-28): the
	 *  chevron renders whenever this is ≥1. */
	const directChildren = $derived.by(() => {
		const map = new Map<string, number>();
		for (const m of [...panelMembers, ...ghostMembers]) {
			const key = m.parent ?? '';
			if (key === '' || !memberById.has(key)) continue; // off-floor spawner
			map.set(key, (map.get(key) ?? 0) + 1);
		}
		return map;
	});
	/** Descendants per session — the chevron's honest N: every row that
	 *  hides when this session folds (children of both kinds, nested). */
	const subtreeCount = $derived.by(() => {
		const childrenOf = new Map<string, string[]>();
		for (const m of [...panelMembers, ...ghostMembers]) {
			if (m.parent === null || m.parent === '') continue;
			const list = childrenOf.get(m.parent) ?? [];
			list.push(m.id);
			childrenOf.set(m.parent, list);
		}
		const countOf = (id: string, seen: Set<string>): number => {
			let n = 0;
			for (const c of childrenOf.get(id) ?? []) {
				if (seen.has(c)) continue; // cycle cut (the module's fail-soft rule)
				seen.add(c);
				n += 1 + countOf(c, seen);
			}
			return n;
		};
		const map = new Map<string, number>();
		for (const m of [...panelMembers, ...ghostMembers]) {
			map.set(m.id, countOf(m.id, new Set()));
		}
		return map;
	});
	/** Fold state (default FOLDED, 2026-08-28): UNFOLDED sessions keyed
	 *  by session id — absent = folded, children ship hidden. Keyed by
	 *  session (not panel) so re-adopting panels keeps the choice. The
	 *  default covers what the floor RESTORES — mount-time rows and a
	 *  desk switch; a panel ADDED while mounted reveals instead (the
	 *  fold-on-add effect below). */
	let unfoldedParents = $state<Record<string, boolean>>({});

	// Hydrate (2026-09-03, ADR The Tree That Remembers D5/D6): the desk's
	// stored fold field seeds the map VERBATIM — once per mount and again
	// on every profile change (a desk switch swaps the map wholesale, no
	// merge). Plain assignment, never a reveal walk, and never a write:
	// the effect's only reactive read is `profile`, so floor changes never
	// re-seed the live map and localStorage only ever receives from the
	// save paths below.
	$effect(() => {
		const stored = loadPanelGroupPrefs(profile).unfoldedSessionIds;
		unfoldedParents = Object.fromEntries(stored.map((id) => [id, true]));
	});
	// ADR-0037 D4 — the glass fold must SHOW its result: the moment a
	// folded-glass ghost exists, its opener's family reveals (the same
	// 'you acted, you must see it' rule the adoption reveal encodes).
	// One write per glass; a later explicit fold by the operator wins.
	$effect(() => {
		for (const g of ws?.ghosts ?? []) {
			if (g.panel.id.startsWith('glass-') && g.parentSessionId && unfoldedParents[g.parentSessionId] !== true) {
				unfoldedParents[g.parentSessionId] = true;
			}
		}
	});

	/** The desk blob's fold half (D4): the live map's `true` entries pruned
	 *  to current floor members (panel or ghost — `memberById` is the
	 *  derived member set, so cycle safety stays upstream). Save-time
	 *  pruning only: a dead id leaves at the NEXT save, never at load. */
	function foldSessionIds(): string[] {
		const ids: string[] = [];
		for (const [id, unfolded] of Object.entries(unfoldedParents)) {
			if (unfolded === true && memberById.has(id)) ids.push(id);
		}
		return ids;
	}

	/** The fold-write choke point (D2/D4): both mutation paths end here —
	 *  the chevron AND the reveals persist, provenance-free, so the
	 *  post-reload tree matches the pre-reload screen. */
	function persistFold(): void {
		savePanelGroupPrefs({ collapsed, unfoldedSessionIds: foldSessionIds() }, profile);
	}

	function toggleFold(parentSessionId: string): void {
		unfoldedParents[parentSessionId] = !unfoldedParents[parentSessionId];
		persistFold();
	}

	// ── Lineage fold pair (2026-09-03) ──────────────────────────────────
	// Sessions that HAVE lineage on the floor: the depth-0 panels holding
	// at least one child (panel or ghost) — the exact gate the rows'
	// fold chevron renders under, so this pair and the row chevrons can
	// never disagree about who owns a fold.

	/** The lineage sessions' ids, in floor order. */
	const foldOwners = $derived(
		panelMembers
			.filter((m) => m.depth === 0 && (directChildren.get(m.id) ?? 0) > 0)
			.map((m) => m.id)
	);
	/** The pair's disable facts: collapse is dead only when EVERY lineage
	 *  session already ships folded; expand only when EVERY one stands
	 *  unfolded. No families at all → both facts hold → both disabled. */
	const allFamiliesFolded = $derived(foldOwners.every((id) => unfoldedParents[id] !== true));
	const allFamiliesUnfolded = $derived(foldOwners.every((id) => unfoldedParents[id] === true));

	/** Collapse every lineage session — and, if the group ships
	 *  collapsed, expand it: a click on the pair demands to SEE the
	 *  families, so the header-only group must not swallow the result.
	 *  Entries for depth>0 sessions ride along untouched: they gate
	 *  nothing (the family head owns the fold), so only owner entries
	 *  flip; one persist covers the fold write and the group flip. */
	function collapseAllFamilies(): void {
		for (const id of foldOwners) unfoldedParents[id] = false;
		collapsed = false;
		persistFold();
	}

	/** Expand every lineage session — the same group-expansion promise:
	 *  the result shows even when the click landed on a collapsed group. */
	function expandAllFamilies(): void {
		for (const id of foldOwners) unfoldedParents[id] = true;
		collapsed = false;
		persistFold();
	}

	/** Fold visibility (operator spec, 2026-08-28): the FAMILY HEAD owns
	 *  the fold — an entry shows iff every ROOT ancestor (depth-0 panel)
	 *  on its chain is unfolded; child PANELS and ghosts hide alike
	 *  under a folded head. SUB-AGENT panels are TRANSPARENT (their rows
	 *  carry no chevron — close-only, 2026-08-28): the family folds and
	 *  unfolds as one unit. A toggle never REORDERS anything (a pure
	 *  filter); an off-floor spawner ends the walk — an orphan gates
	 *  nothing (it IS its own root). */
	function ancestryUnfolded(parentId: string | null): boolean {
		let cursor = parentId;
		while (cursor !== null && cursor !== '') {
			const member = memberById.get(cursor);
			if (member === undefined) break; // spawner off the floor
			if (
				panelSessionIds.has(cursor) &&
				member.depth === 0 &&
				unfoldedParents[cursor] !== true
			) {
				return false;
			}
			cursor = member.parent;
		}
		return true;
	}

	const visibleRender = $derived(renderList.filter((e) => ancestryUnfolded(e.member.parent)));
	/** Panel index in floor order — the canMove fallback's i. */
	const panelIndex = $derived(new Map(rows.map((r, i) => [r.panel.id, i] as const)));

	/** Pending reveal (2026-08-28): a ghost-click adoption keeps the
	 *  clicked child VISIBLE — its panel ancestors auto-unfold once the
	 *  route creates them (the fold default stays for everything else;
	 *  you clicked it, you must see it — a nested adoption must not
	 *  hide its own row behind the freshly adopted parent's fold). */
	let revealSessionId = $state<string | null>(null);

	/** Ghost click — ADOPT as a real panel (registry add; the route's
	 *  chain-aware doAdd pins the off-floor ancestors under the open
	 *  head) and ask the tree to reveal the clicked row. */
	function onAdopt(ghost: PanelRow): void {
		if (ghost.panel.kind !== 'conversation') return; // ghosts are always conversation-shaped
		// ADR-0037 D4: a folded GLASS ghost summons — openBrowserPanel
		// re-binds the surviving session; never addPanelFromSidebar.
		if (ghost.panel.id.startsWith('glass-')) {
			summonGlassFromRegistry(
				{ sessionId: ghost.panel.sessionId, openedBy: ghost.parentSessionId ?? undefined },
				{ replace: false }
			);
			return;
		}
		revealSessionId = ghost.panel.sessionId;
		addPanelFromSidebar({ sessionId: ghost.panel.sessionId, agentPreset: null });
	}

	// Reveal walk (shared): unfold `sessionId` itself (an adoption or add
	// with children must not swallow their rows) and every PANEL ancestor
	// in its chain. Reads the reactive member maps; writes only settle.
	// Ends at persistFold (D2): a reveal is a map mutation, so the desk
	// keeps it — the forked family is still open after a reload.
	function revealFamily(sessionId: string): void {
		let cursor: string | null = sessionId;
		while (cursor !== null && cursor !== '') {
			if (panelSessionIds.has(cursor) && unfoldedParents[cursor] !== true) {
				unfoldedParents = { ...unfoldedParents, [cursor]: true };
			}
			cursor = memberById.get(cursor)?.parent ?? null;
		}
		persistFold();
	}

	// Reveal effect: once the adopted child renders as a PANEL member
	// (the ghost member also matches memberById — the ask must survive
	// until adoption actually lands), run the walk for the CLICKED row,
	// then clear. Reads the member maps (reactive) so the route's
	// post-adoption state drives it.
	$effect(() => {
		if (revealSessionId === null) return;
		const target = revealSessionId;
		if (!panelSessionIds.has(target)) return; // not adopted yet
		revealFamily(target);
		revealSessionId = null;
	});

	// Fold-on-add (2026-09-02): a panel the operator ADDS while this list
	// is mounted — spine click, paste-add, fork — reveals its family the
	// way an adoption does; you added it, you must see it. Only the
	// floor's RESTORED set keeps the shipped folded default: the first
	// run (and a desk switch) snapshots the rows silently.
	// Floor-APPEARANCE diff (2026-09-10 fix): the reveal fires on every
	// transition onto the floor, NOT on first-sight-ever — the old
	// seen-session set survived CLOSE, so re-adding a family head kept a
	// fold choice the operator never made and shipped the newcomer's
	// children hidden (the reported parent-arrives-folded bug). A manual
	// fold AFTER the reveal still persists and governs until the panel
	// leaves the floor.
	let seenProfile: string | null | undefined = undefined;
	let prevFloorSessionIds = new Set<string>();
	$effect(() => {
		if (seenProfile !== profile) {
			seenProfile = profile;
			prevFloorSessionIds = new Set(
				rows
					.filter((r) => r.panel.kind === 'conversation')
					.map((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : ''))
			);
			return;
		}
		const current = new Set(
			rows
				.filter((r) => r.panel.kind === 'conversation')
				.map((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : ''))
		);
		for (const r of rows) {
			if (r.panel.kind !== 'conversation') continue; // manager rows join no family
			if (prevFloorSessionIds.has(r.panel.sessionId)) continue; // was on the floor — not an add
			revealFamily(r.panel.sessionId);
		}
		prevFloorSessionIds = current;
	});

	// Reveal-on-focus (2026-09-03): the FOCUSED panel never hides behind
	// its own fold when focus CHANGES. PanelColumn fires select on
	// pointerdown/focusin, and a close can move the selection onto a
	// family member — every source lands on the same `selectedPanelId`
	// write. A RESTORED focus observes silently (mount, desk switch):
	// the restored floor keeps its restored folds, the same snapshot
	// rule the fold-on-add effect runs on. The gate is exactly the
	// render filter's (ancestryUnfolded over the selected row's parent
	// chain), so the effect settles at a fixpoint: once the walk
	// unfolds the chain the gate passes and nothing writes again. A
	// COLLAPSED group stays collapsed — the reveal fixes the fold map
	// (persisted, like every reveal), not the group box.
	let focusedProfile: string | null | undefined = undefined;
	let focusedPanelId: string | null = null;
	$effect(() => {
		const selectedPanelId = ws?.selectedPanelId ?? null;
		if (focusedProfile !== profile) {
			// First sight (mount, desk switch): observe, never act.
			focusedProfile = profile;
			focusedPanelId = selectedPanelId;
			return;
		}
		if (selectedPanelId === focusedPanelId) return; // same focus, or row-fact republish
		focusedPanelId = selectedPanelId;
		const selected = rows.find((r) => r.panel.id === selectedPanelId);
		if (selected === undefined) return;
		if (ancestryUnfolded(selected.parentSessionId ?? null)) return; // already visible
		// The reveal target is the MEMBER id — a document child (Loadinjected
		// ADR D3) hides behind its source's fold exactly like a session
		// child, and the focused panel must be visible. (The pre-doc guard
		// skipped non-conversation panels because they had no parent to
		// hide behind; the injected-doc kind gave them one.)
		const memberId =
			selected.panel.kind === 'conversation' ? selected.panel.sessionId : selected.panel.id;
		revealFamily(memberId);
	});
</script>

{#if rows.length > 0 || (ws?.ghosts ?? []).length > 0}
	<div class="pane" data-testid="sidebar-panel-pane">
		<div class="panel-group" data-testid="sidebar-panel-group">
			<div class="group-head-row">
				<button
					type="button"
					class="group-head"
					data-testid="sidebar-panel-group-toggle"
					aria-expanded={!collapsed}
					aria-controls="sidebar-panel-group-rows"
					onclick={toggle}
				>
					{#if collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown size={12} aria-hidden="true" />{/if}
					<!-- Title: `Focused - ` stem, then the focused name chip — the
					     chip is SidebarOpenPanelHeader (extracted 2026-09-02);
					     the ` - ` separator stays text and rides unconditionally
					     (2026-09-03) so the string contract survives. -->
					<span class="head-title" data-testid="sidebar-panel-group-title"
						>{t(m.focused)}{' - '}<SidebarOpenPanelHeader
							name={headName}
							dead={selectedRow?.dead ?? false}
							running={selectedRow?.running ?? false}
						/></span
					>
				</button>
				<!-- Lineage fold pair (SidebarOpenPanelTree, extracted
				     2026-09-03): collapse-all / expand-all over every session
				     with lineage; a seg at its extreme disables. -->
				<SidebarOpenPanelTree
					{collapsed}
					allFolded={allFamiliesFolded}
					allUnfolded={allFamiliesUnfolded}
					oncollapseall={collapseAllFamilies}
					onexpandall={expandAllFamilies}
				/>
			</div>
			{#if !collapsed}
				<!-- The rows body (SidebarOpenPanelRows): the interleaved
				     panel/ghost sequence. All state arrives as props; every
				     action returns as a callback — this component owns the
				     registry, the fold state, and the workspace context. -->
				<div class="panel-container" data-testid="sidebar-panel-rows-scroll">
					<SidebarOpenPanelRows
						{visibleRender}
						{panelIndex}
						{subtreeCount}
						{directChildren}
						rowsLength={rows.length}
						selectedPanelId={ws?.selectedPanelId}
						{unfoldedParents}
						{workspaces}
						onselect={onSelect}
						onmove={onMove}
						ontogglefold={toggleFold}
						onclose={(panelId) => ws?.remove(panelId)}
						onadopt={onAdopt}
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Scroll pane (2026-08-24): this component's root inside the
	   sidebar's session body column (SessionsList, above the pills) —
	   NATURAL height for as many panels as it has (grow 0, SHRINK 0:
	   never stretches, never squeezed by the column's flex), hard-
	   capped at half the column; past the cap it scrolls INTERNALLY.
	   Everything below (pills, spine) absorbs whatever height this
	   pane does not take — never a shared scrollbar. No rows → no pane
	   (the pills head the column). NOTE: no margins inside this pane
	   — a scroll container turns a child's bottom margin into
	   scrollable overflow (a phantom scrollbar on a fitting box). */
	.pane {
		flex: 0 0 auto;
		/* The HALF-COLUMN cap lives HERE, not on the rows container below:
		   a percentage max-height resolves only against a DEFINITE
		   containing-block height. As a flex item of the session body
		   column (definite: flex 1 + min-height 0 under the full-height
		   rail) 50% resolves; on .panel-container — every ancestor of
		   which is content-sized — it computed to `none` and the group
		   grew unbounded (the 2026-09-02 regression: no cap, no scroll). */
		display: flex;
		max-height: 50%;
		margin-top: 0.125rem;
		flex-direction: column;
	}

	/* Group box (2026-08-24, restyled 2026-08-26): the open panels
	   render as ONE detached group — tinted surface + border + radius —
	   so the floor's live set never visually blends into the recency
	   spine below the separator. The catchier field is an accent-blue
	   WASH (14% → 7% down the box) instead of the old quiet grey —
	   readable, not loud. WCAG: the wash stays light enough that the
	   darkest text below (accent-deep, 5.17:1 worst-case at the top of
	   the gradient) clears AA for the box's small text sizes. */
	.panel-group {
		/* Fill the capped pane (and shrink to it) so the rows container
		   below can scroll internally; uncapped, basis auto keeps the
		   natural content height. */
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		border-radius: 0.5rem;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, var(--color-surface-elevated)),
			color-mix(in srgb, var(--color-accent-blue, #3b82f6) 7%, var(--color-surface-elevated))
		);
		/* NO bottom margin — the parent column's gap spaces this box
		   from the separator; a margin here would count as scrollable
		   overflow inside the capped pane (phantom scrollbar). */
	}

	/* The rows scroll pane (inside the capped group): flex 1 + min-height
	   0 lets it shrink under the pane's cap; past the cap the ROWS scroll
	   and the group header stays pinned (the spine group's 2026-09-01
	   structure). */
	.panel-container {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}

	/* Group header row: the collapse toggle (flex 1) + the lineage fold
	   pair beside it — siblings under one flex row, the fold pair never
	   squeezed (shrink 0) while the title ellipsizes inside its button. */
	.group-head-row {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}

	/* Group header (2026-08-26): the collapse/expand toggle — full-width
	   button in the group's own grammar (radius, hover field), chevron
	   leading. Always rendered while panels exist: collapsed, it IS the
	   group, and the title carries the floor's focus. Never shrinks —
	   when the pane hits its half-column cap the rows container below
	   absorbs the shortage (the spine group's pinned-header rule). */
	.group-head {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.375rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		font-size: 0.6875rem;
		line-height: 1.25;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.group-head:hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, var(--color-surface-elevated));
	}

	/* Keyboard focus gets a RING, not just the hover field — a visible
	   focus indicator (WCAG 2.4.7) in NAVY: 8.86:1 on the wash (the
	   50% accent-deep mix measured 3.98:1 — under the 3:1 an indicator
	   needs to pop reliably at the ring's thin stroke). */
	.group-head:focus-visible {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, var(--color-surface-elevated));
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -2px;
	}

	.group-head :global(svg) {
		flex-shrink: 0;
		color: var(--color-navy-focus);
	}

	/* Title — `Focused - <selected session name>`, exactly the row-label
	   grammar for the name half (title ?? sessionId). One span so the
	   string tests pin is the string users read. NAVY (2026-08-26 audit):
	   11px text needs AA 4.5:1 — navy holds 8.86:1 on the wash where the
	   accent-deep mix managed 3.98:1 — same hue family (the accent's own
	   darkened anchor), honest contrast + weight 600 for the floor's
	   focus cue. Flex row (2026-09-02): the span claims the header row's
	   free width and hands it to the chip, which grows to fill it; the
	   chip's label ellipsizes inside, so this span only clips. */
	.head-title {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: nowrap;
		font-weight: 600;
		color: var(--color-navy-focus);
	}
</style>

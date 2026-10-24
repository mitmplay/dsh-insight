/**
 * floor-registry/chrome — panel chrome intents + explorer + file-intent
 * mailbox + removal (ADR-0022 W3).
 *
 * Moved WHOLE from the state home (floor-registry.svelte.ts): the
 * skill-shelf / plugin-rack chrome setters, the ONE-explorer-per-workspace
 * open grammar, the explorer tree/tab/git intents, the file-intent
 * publish/consume mailbox, and family-close removal. Plain module: every
 * write goes through the state home's reactive `st` hub and its
 * primitives (ADR-0019 D2: exactly ONE writer home for floor state).
 * Sibling rule: factories/slots are reached through the state home's
 * re-export hub, never by importing another sibling directly.
 */
import { SvelteSet } from 'svelte/reactivity';
import { clampTreePct } from '$lib/utils/panel-prefs';
import {
	findWorkspaceExplorerPanel,
	glassFirstSlot,
	workspaceExplorerSlot
} from '$lib/services/panels/panel-placement';
import type { ReloadFeedback } from '$lib/utils/skill-shelf-reload-machine';
import type {
	DsiBrowserPanel,
	DsiPanelEntry,
	DsiPluginRackPanel,
	DsiSkillShelfPanel,
	DsiWorkspaceExplorerPanel,
	DsiWorkspaceFilePanel
} from '$lib/types';
import {
	st,
	floorSeam,
	clearLoupeIfGone,
	selectedIndex_,
	insertPanel,
	insertionSlot,
	pinnedSlotIndex,
	makeWorkspaceExplorerPanel,
	makeBrowserPanel
} from '$lib/services/panels/floor-registry.svelte';

const d = floorSeam;

/** Skill-shelf chrome intents (hard-reload survival, the
 * explorer-tab pattern): the shelf emits tab / collapsed-set /
 * search changes; the owner writes them onto the persisted entry
 * — panel-prefs saves the blob, a reload restores all three. */
export function setShelfTab(panelId: string, tab: 'install' | 'uninstall'): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'skill-shelf') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiSkillShelfPanel), tab });
}

/** The rack's tab intent (The Plugin Rack ADR, 2026-09-27): same
 * persisted-entry write as the shelf's - panel-prefs saves the blob,
 * a hard reload restores the active tab. */
export function setRackTab(panelId: string, tab: 'install' | 'uninstall'): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'plugin-rack') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiPluginRackPanel), tab });
}

export function setShelfCollapsed(panelId: string, collapsed: string[]): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'skill-shelf') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiSkillShelfPanel), collapsed });
}

export function setShelfSearch(panelId: string, q: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'skill-shelf') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiSkillShelfPanel), searchQ: q });
}

export function setShelfReload(panelId: string, reload: ReloadFeedback | null): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'skill-shelf') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiSkillShelfPanel), reload });
}

/** The glass reports its resolved browser-session id (Amendment 3): the
 *  slot persistence reads it off the ENTRY so N glasses each re-bind to
 *  their OWN session at boot. The panel component stays the resolver —
 *  this is only the write-back. */
export function setBrowserSessionId(panelId: string, sessionId: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'browser') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiBrowserPanel), browserSessionId: sessionId });
}

// ── Workspace opens (The Shared Tree ADR 2026-09-17, D2) ─────────────
/** Chip click action: ONE explorer per WORKSPACE root across ALL
 * sessions — a click on any session sharing the root FOCUSES the open
 * explorer (dedupe key = root, D1); a fresh root lands at the focused
 * slot (D3, non-lineage — the explorer is not a lineage child).
 * sessionId rides the fresh panel as PROVENANCE (D4), never identity. */
export function openWorkspaceExplorer(sessionId: string, workspace: string): void {
	const open = findWorkspaceExplorerPanel(st.panels, workspace);
	if (open) {
		st.selectedPanelId = open.id; // dedupe-to-focus (D2, root key)
		return;
	}
	insertPanel(
		makeWorkspaceExplorerPanel(sessionId, workspace),
		workspaceExplorerSlot(st.panels, selectedIndex_(), d().getMoveFacts())
	);
}

/** Chip click action (The Glass Browser spec W2, ADR-0029 D4): ONE live
 *  browser panel across the floor — the terminal singleton rule (Terminal
 *  Desk ADR D2). A click on an open browser FOCUSES it; a miss inserts at
 *  the focused slot. */
export function openBrowserPanel(index?: number, keepSelection = false, width?: number, openedBy?: string, sessionId?: string): void {
	// Amendment 3: ONE glass PER OPENER — the dedupe key is openedBy (the
	// workspace-explorer per-root precedent). A second opener's chip spawns
	// its OWN glass; the same opener's click focuses. The keyless
		// ControlBar open remains the lone keyless singleton.
	const open = st.panels.find((p) => p.kind === 'browser' && p.openedBy === openedBy);
	if (open) {
		st.selectedPanelId = open.id;
		return;
	}
	// The Sticky Glass: the boot auto-restore pins the panel at its PERSISTED
	// floor slot — the focused-slot fallback would drift every reload (what
	// is selected at boot decides the position). Chip clicks (index absent)
	// keep the focused-slot behavior.
	// keepSelection: insertPanel selects the newcomer — right for a chip
	// click, wrong for a restore (the operator's focus must survive the
	// reload too). The exception: the browser panel ITSELF was focused
	// before the reload — then the restore legitimately refocuses it.
	const prevSelected = st.selectedPanelId;
	// D6 (Amendment 2): a chip spawn pins the glass RIGHT of its opener's
	// family region — the same grammar a sub-agent gets (lineagePinnedSlot:
	// opener index + 1, past the doc tail and earlier siblings' subtrees;
	// the browser is never in childrenByParent, so it lands at the region's
	// end). Reload restore keeps the persisted slot index instead.
	const slot =
		index !== undefined
			? Math.max(0, Math.min(index, st.panels.length))
			: openedBy !== undefined
				? glassFirstSlot(st.panels, openedBy) // Amendment 2: FIRST under the opener, before adopted children
				: insertionSlot(); // fail-soft: no lineage table, focused slot
	insertPanel(
		// openedBy rides the INSERT path only — the per-opener early-return
		// above is D2: the same opener's click focuses, never rewrites.
		makeBrowserPanel(width, openedBy, sessionId),
		slot
	);
	if (keepSelection && prevSelected !== null && prevSelected !== undefined) {
		// The previous selection is a blob-restored panel (the browser was
		// never on the floor before this insert) — put focus back exactly
		// where the reload left it.
		if (st.panels.some((p) => p.id === prevSelected)) st.selectedPanelId = prevSelected;
	}
}

/** The open explorer for a session's workspace (The Shared Tree D1):
 * matched by ROOT across sessions — the panel's provenance sessionId
 * is not the key. */
export function sessionWorkspaceExplorer(sessionId: string): DsiWorkspaceExplorerPanel | undefined {
	const root = d().getWorkspaceFor(sessionId);
	return root === null ? undefined : findWorkspaceExplorerPanel(st.panels, root);
}

// ── Explorer tree / git intents ──────────────────────────────────────
/** Explorer tree intents: the panel emits toggle/open-file; the owner
 * mutates expanded (the persisted part) — the levels cache stays
 * component-local. */
export function toggleExplorerPath(panelId: string, path: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	const explorer = st.panels[idx] as DsiWorkspaceExplorerPanel;
	const next = explorer.expanded.includes(path)
		? explorer.expanded.filter((p) => p !== path)
		: [...explorer.expanded, path];
	st.panels = st.panels.with(idx, { ...explorer, expanded: next });
}

/** Explorer collapse-all intent: the panel emits; the owner empties the
 * expanded list (the persisted part). */
export function collapseExplorerPaths(panelId: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiWorkspaceExplorerPanel), expanded: [] });
}

/** Git Eye tab intent (2026-09-12): the active tab is PERSISTED on the
 * entry — a hard reload restores it. */
export function setExplorerTab(panelId: string, tab: 'explorer' | 'changes'): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiWorkspaceExplorerPanel), tab });
}

/** Explorer Layout tabs (amendment 2026-09-16): the tab list and the
 * active tab are OWNER-PERSISTED entry facts. The file tabs die with
 * the panel (D5). */
export function openExplorerTab(panelId: string, path: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	const ex = st.panels[idx] as DsiWorkspaceExplorerPanel;
	const tabs = ex.openTabs ?? [];
	const openTabs = tabs.includes(path) ? tabs : [...tabs, path];
	st.panels = st.panels.with(idx, { ...ex, openTabs, activeFile: path });
}

export function closeExplorerTab(panelId: string, path: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	const ex = st.panels[idx] as DsiWorkspaceExplorerPanel;
	const tabs = ex.openTabs ?? [];
	const closedAt = tabs.indexOf(path);
	if (closedAt === -1) return;
	const openTabs = tabs.filter((p) => p !== path);
	const activeFile =
		ex.activeFile === path
			? (openTabs.length === 0 ? null : openTabs[Math.max(0, closedAt - 1)])
			: (ex.activeFile ?? null);
	st.panels = st.panels.with(idx, { ...ex, openTabs, activeFile });
}

export function activateExplorerTab(panelId: string, path: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	const ex = st.panels[idx] as DsiWorkspaceExplorerPanel;
	if (!(ex.openTabs ?? []).includes(path)) return;
	st.panels = st.panels.with(idx, { ...ex, activeFile: path });
}

/** The Explorer Layout drag settle (ADR D4): one DESK fact — the split
 * is desk state, persisted with the floor blob, NOT per entry. The
 * panel already clamped; clamp again at the single bound site. */
export function setExplorerTreePct(_panelId: string, pct: number): void {
	d().setTreePct(clampTreePct(pct));
}

/** Git Eye repo-collapse intent (2026-09-13): the collapsed repo set is
 * PERSISTED on the entry. Default is EXPANDED. */
export function toggleExplorerRepo(panelId: string, repoRel: string): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	const explorer = st.panels[idx] as DsiWorkspaceExplorerPanel;
	const prev = explorer.collapsedRepos ?? [];
	const next = prev.includes(repoRel) ? prev.filter((r) => r !== repoRel) : [...prev, repoRel];
	st.panels = st.panels.with(idx, { ...explorer, collapsedRepos: next });
}

/** Git Eye collapse-all-repos intent (2026-09-13): collapses EVERY known
 * repo — persisted like the single-repo toggle. */
export function collapseExplorerRepos(panelId: string, repos: readonly string[]): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-explorer') return;
	const explorer = st.panels[idx] as DsiWorkspaceExplorerPanel;
	const prev = explorer.collapsedRepos ?? [];
	const next = [...prev, ...repos.filter((r) => !prev.includes(r))];
	st.panels = st.panels.with(idx, { ...explorer, collapsedRepos: next });
}

// ── File intents ─────────────────────────────────────────────────────
/** File Eye view intent (2026-09-13): diff vs edit is PERSISTED on the
 * entry. */
export function setFileView(panelId: string, view: 'edit' | 'diff'): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0 || st.panels[idx].kind !== 'workspace-file') return;
	st.panels = st.panels.with(idx, { ...(st.panels[idx] as DsiWorkspaceFilePanel), view });
}

/** Tree file-click action (The Settings Tree ADR 2026-09-18 D1): the
 * intent publishes to the session's explorer, which opens/focuses a
 * tab. No open explorer ⇒ the intent drops. */
export function openWorkspaceFile(
	sessionId: string,
	path: string,
	lines?: { start: number; end: number } | null
): void {
	const host = sessionWorkspaceExplorer(sessionId); // Shared Tree D1: the root key
	if (host) publishFileIntent(host.id, path, lines);
}

/** Publish a file intent to an explorer panel and focus it. `lines` is
 * the optional #L anchor target — display metadata, not persisted. */
export function publishFileIntent(
	explorerId: string,
	path: string,
	lines?: { start: number; end: number } | null
): void {
	st.pendingFileIntents[explorerId] = { path, nonce: ++st.fileIntentSeq, lines: lines ?? null };
	st.selectedPanelId = explorerId;
}

/** The panel consumed intent nonce N — clear exactly that publish. */
export function consumeFileIntent(explorerId: string, nonce: number): void {
	if (st.pendingFileIntents[explorerId]?.nonce === nonce) {
		st.pendingFileIntents[explorerId] = null;
	}
}

// ── Selection / removal ──────────────────────────────────────────────
/** Remove a panel; family close walks the wire lineage transitively
 * (every descendant sub-agent goes with it, nested included). The
 * Shift+Click amendment (2026-09-01): family === false opts OUT — only
 * THAT panel drops, the children re-root as orphan family heads.
 *
 * The session's workspace pair closes with it (2026-09-10); closing an
 * EXPLORER dooms its file children BY PANEL ID — the stored
 * explorerPanelId edge, with the legacy null-edge fallback. A
 * settings-home explorer (sessionId null) dies with the close. */
export function removePanel(panelId: string, opts: { family?: boolean } = {}): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx < 0) return;
	const root = st.panels[idx];
	// Manager close (ADR D6): no session, no family walk — the slot
	// drops alone (the subtree walk below skips session-less kinds).
	const rootSessionId = root.kind === 'conversation' ? root.sessionId : null;
	const doomed = new SvelteSet<string>(rootSessionId !== null ? [rootSessionId] : []);
	if (opts.family !== false && rootSessionId !== null) {
		const stack = [rootSessionId];
		while (stack.length > 0) {
			for (const kid of d().getLineageFacts().childrenByParent.get(stack.pop()!) ?? []) {
				if (!doomed.has(kid.sessionId)) {
					doomed.add(kid.sessionId);
					stack.push(kid.sessionId);
				}
			}
		}
	}
	const doomedPanelIds = new SvelteSet<string>();
	// D5 REVISED (Amendment 2) — and RE-SCOPED by the operator ruling of
	// 2026-10-24 (Glass Close Ladder Amendment 2): a cascade dooms the
	// browser PANEL only. The wire session SURVIVES the opener close — the
	// slot tick folds it and the lineage-tree ghost nests it under the
	// opener family in SidebarSessionsList. The ONLY wire killers are the
	// header trash (the route's onclose → releaseGlasses) and the reaper.
	// A browser with no provenance (ControlBar open) has no family and
	// survives every cascade.
	if (opts.family !== false && rootSessionId !== null) {
		for (const p of st.panels) {
			if (p.kind === 'browser' && p.openedBy !== undefined && doomed.has(p.openedBy)) {
				doomedPanelIds.add(p.id);
			}
		}
	}
	if (opts.family !== false && root.kind === 'workspace-explorer') {
		for (const p of st.panels) {
			if (
				p.kind === 'workspace-file' &&
				(p.explorerPanelId === root.id ||
					(p.explorerPanelId === null && p.sessionId === root.sessionId))
			) {
				doomedPanelIds.add(p.id);
			}
		}
	}
	st.panels = st.panels.filter(
		(p: DsiPanelEntry) =>
			p.id !== root.id &&
			!doomedPanelIds.has(p.id) &&
			(p.kind === 'conversation'
				? !doomed.has(p.sessionId)
				: !('sessionId' in p) ||
					p.sessionId === null ||
					(opts.family !== false && !doomed.has(p.sessionId)))
	);
	if (st.selectedPanelId !== null && !st.panels.some((p) => p.id === st.selectedPanelId)) {
		st.selectedPanelId = st.panels[Math.min(idx, st.panels.length - 1)]?.id ?? null;
	}
	clearLoupeIfGone();
}
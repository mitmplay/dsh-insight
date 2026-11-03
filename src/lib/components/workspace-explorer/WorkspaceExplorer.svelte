<script lang="ts">
	/**
	 * WorkspaceExplorer — the explorer/changes tab strip + scroll body
	 * (extracted 2026-09-13 from WorkspaceExplorerPanel's markup, same
	 * extraction series as Tree and Changes). Presentation only: every
	 * value arrives as a prop, every intent leaves as a callback — the
	 * panel keeps all state, fetches, and persistence.
	 *
	 * Layout contract: .explorer is the toolbar's absolute ANCHOR and must
	 * never scroll itself; the scroll lives on .tree-scroll so the toolbar
	 * stays pinned (the toolbar-scrolls-away bug).
	 */
	import WorkspaceExplorerToolbar from './WorkspaceExplorerToolbar.svelte';
	import WorkspaceExplorerTree from './WorkspaceExplorerTree.svelte';
	import type { Level } from './workspace-explorer-tree-types';
	import WorkspaceExplorerChanges from './WorkspaceExplorerChanges.svelte';
	import type { ChangeStatus } from './WorkspaceExplorerRepo.svelte';

	let {
		root,
		activeTab,
		onTabChange,
		onRefresh,
		onCollapseAll,
		onCollapseAllRepos,
		levels,
		expanded,
		onToggle,
		repoMaps,
		changedPaths,
		changedDirs,
		onOpenFile,
		/** File Link Intent (2026-09-25): the open file's rel path — threaded
		 *  to the tree so its row highlights. */
		activeFile = null,
		changesRepos,
		changesStatuses,
		collapsedRepos,
		onToggleRepo
	}: {
		/** Verbatim workspace root — passed through to both tab bodies. */
		root: string;
		/** The resolved active tab (owner's persisted tab + local override). */
		activeTab: 'explorer' | 'changes';
		/** Tab-switch intent — forwarded to the panel, which owns the override. */
		onTabChange: (tab: 'explorer' | 'changes') => void;
		/** Refresh intent — re-runs the panel's level + git fetches. */
		onRefresh: () => void;
		/** Collapse-all intent — the owner empties the expanded list. */
		onCollapseAll: () => void;
		/** Collapse-all-repos intent (Changes tab variant). */
		onCollapseAllRepos?: (repos: readonly string[]) => void;
		/** Rel path → level state (panel-owned cache). */
		levels: Record<string, Level>;
		/** Root-relative directory paths currently expanded (owner-owned). */
		expanded: readonly string[];
		/** Expand/collapse intent — the owner mutates the expanded list. */
		onToggle: (path: string) => void;
		/** Repo-root maps keyed by rel path ('' = the workspace root). */
		repoMaps: Record<string, { rootIsRepo: boolean; repos: Record<string, boolean> }>;
		/** Root-relative paths reported changed by git-status. */
		changedPaths: ReadonlySet<string>;
		/** Root-relative directories containing changed files. */
		changedDirs: ReadonlySet<string>;
		/** File click intent — the owner dedupes and slots the file panel. */
		onOpenFile: (path: string) => void;
		activeFile?: string | null;
		/** Repos under the workspace root, as rel paths ('' first when the root is one). */
		changesRepos: readonly string[];
		/** Per-repo git status, keyed by repo rel path. */
		changesStatuses: Record<string, ChangeStatus>;
		/** The PERSISTED collapsed repo rel paths (owner-owned). */
		collapsedRepos?: readonly string[];
		/** Repo collapse-toggle intent — the owner PERSISTS it on the entry. */
		onToggleRepo?: (repoRel: string) => void;
	} = $props();
</script>

<div class="explorer">
	<!-- Full-width in-flow toolbar (Git Eye ADR D4): refresh + collapse-all
	     on the first row; the tree scrolls below. The workspace TITLE and
	     the full-path copy live in the column's PanelHeader (PanelColumn
	     labels the explorer variant via panelHeaderLabel) — not here. -->
	<WorkspaceExplorerToolbar
		onRefresh={onRefresh}
		onCollapseAll={activeTab === 'changes' ? () => onCollapseAllRepos?.([...changesRepos]) : onCollapseAll}
		{activeTab}
		{onTabChange}
	/>
	{#if activeTab === 'changes'}
		<div class="changes" data-testid="git-changes">
			<div class="tree-scroll">
				<WorkspaceExplorerChanges
					{root}
					{changesRepos}
					{changesStatuses}
					collapsedRepos={collapsedRepos ?? []}
					onToggleRepo={(repoRel) => onToggleRepo?.(repoRel)}
					{onOpenFile}
				/>
			</div>
		</div>
	{:else}
		<!-- The tree scrolls in its OWN box below the header: .explorer is the
		     header's absolute ANCHOR and must never scroll itself — an
		     absolutely-positioned child of a scroll container is laid out in
		     the scrolled content and travels with it (the toolbar-scrolls-away
		     bug). The scroll lives on .tree-scroll; the header stays pinned. -->
		<div class="tree-scroll">
			<WorkspaceExplorerTree
				{root}
				{levels}
				{expanded}
				{repoMaps}
				{changedPaths}
				{changedDirs}
				{onToggle}
				{onOpenFile}
				{activeFile}
			/>
		</div>
	{/if}
</div>

<style>
	.explorer {
		position: relative; /* the header toolbar's absolute anchor */
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		height: 100%;
		overflow: hidden; /* the SCROLL lives on .tree-scroll — the anchor must not scroll */
		padding: 0.1rem 0.1rem 0 0.2rem;
		font-size: 0.8125rem;
	}
	.tree-scroll {
		flex: 1;
		min-height: 0; /* allow the flex child to shrink and scroll */
		overflow: auto;
	}
	/* The Changes view (ADR D5): one group per repo, rows per changed file. */
	.changes {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
</style>

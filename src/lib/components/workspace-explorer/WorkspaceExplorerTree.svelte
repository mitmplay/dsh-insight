<script lang="ts">
	/**
	 * WorkspaceExplorerTree — the Explorer tab's directory tree, extracted
	 * from WorkspaceExplorerPanel (2026-09-13): renders the root level and
	 * every expanded level recursively over the SAME presentation contract
	 * (dirs first, natural name order; failure / truncated / empty rows,
	 * never a blank region; Git Eye tints for repo / hot / changed rows).
	 *
	 * PRESENTATION ONLY (Module Communication Map): the panel owner keeps
	 * the levels cache, the fetches, and the git state — this component
	 * reads them as props and emits toggle / open-file intents back.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
import * as m from '$lib/paraglide/messages';
	import FileTypeIcon from '../common/file-icons/FileTypeIcon.svelte';
	import type { DirEntry, Level } from './workspace-explorer-tree-types';

	let {
		root,
		levels,
		expanded,
		repoMaps,
		changedPaths,
		changedDirs,
		onToggle,
		onOpenFile,
		/** File Link Intent (2026-09-25): the open file's rel path — its row
		 *  renders highlighted so the operator sees WHERE the file lives. */
		activeFile = null
	}: {
		/** Verbatim workspace root — the tree's aria-label. */
		root: string;
		/** The owner's rel → level state map ('' is the root level). */
		levels: Record<string, Level>;
		/** Root-relative directory paths currently expanded (owner-owned). */
		expanded: readonly string[];
		/** The owner's per-level git-map answers (repo-row tint). */
		repoMaps: Record<string, { rootIsRepo: boolean; repos: Record<string, boolean> }>;
		/** Rel paths of changed files (red tint) — owner-derived. */
		changedPaths: ReadonlySet<string>;
		/** Ancestors of changed paths (hot-dir tint) — owner-derived. */
		changedDirs: ReadonlySet<string>;
		/** Expand/collapse intent — the owner mutates the expanded list. */
		onToggle: (path: string) => void;
		/** File click intent — the owner dedupes and slots the file panel. */
		onOpenFile: (path: string) => void;
		activeFile?: string | null;
	} = $props();

	/** The row's child rel path (the listing's names are basenames). */
	function childRel(rel: string, name: string): string {
		return rel === '' ? name : rel + '/' + name;
	}

	/** Dirs first, then natural name order — the host's TYPE is the truth. */
	function sorted(entries: DirEntry[]): DirEntry[] {
		return [...entries].sort((a, b) => {
			const aDir = a.type === 'directory';
			const bDir = b.type === 'directory';
			if (aDir !== bDir) return aDir ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { numeric: true });
		});
	}
</script>

<ul class="tree" role="tree" aria-label={`${t(m.workspaceExplorerTitle)}: ${root}`} data-active-file={activeFile ?? ''}>
			{#each sorted(levels['']?.kind === 'ready' ? levels[''].entries : []) as entry (entry.name)}
				{@render row(entry, '', 0)}
			{/each}
			{#if levels['']?.kind === 'loading'}
				<li class="note">{t(m.workspaceExplorerLoading)}</li>
			{:else if levels['']?.kind === 'failed'}
				<li class="note fail" data-testid="explorer-failed">{t(m.workspaceExplorerLoadFailed)}{levels['']?.kind === 'failed' ? ` — ${levels[''].reason}` : ''}</li>
			{/if}
		</ul>

{#snippet row(entry: DirEntry, rel: string, depth: number)}
	{@const child = childRel(rel, entry.name)}
	{@const dir = entry.type === 'directory'}
	{@const isOpen = expanded.includes(child)}
	{@const isRepoChild = dir && repoMaps[rel]?.repos?.[entry.name] === true}
	{@const isChanged = !dir && changedPaths.has(childRel(rel, entry.name))}
	{@const isHotDir = dir && changedDirs.has(childRel(rel, entry.name))}
	{@const isActive = activeFile !== null && activeFile === child}
	<li role="treeitem" aria-selected={isActive} aria-expanded={dir ? isOpen : undefined} class="row-line" class:active={isActive}>
		{#if dir}
			<button class="row dir" class:repo={isRepoChild} class:hot={isHotDir} data-repo={isRepoChild ? 'true' : undefined} data-hot={isHotDir ? 'true' : undefined} data-testid="tree-dir" onclick={() => onToggle(child)}>
				<span class="caret">{#if isOpen}<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor" /></svg>{:else}<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z" fill="currentColor" /></svg>{/if}</span><span class="entry-icon">{#if isRepoChild}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 4.5C1.5 3.39543 2.39543 2.5 3.5 2.5H6.10037C6.61616 2.5 7.10411 2.74917 7.41295 3.17044L8.1 4.1H12.5C13.6046 4.1 14.5 4.99543 14.5 6.1V11.5C14.5 12.6046 13.6046 13.5 12.5 13.5H3.5C2.39543 13.5 1.5 12.6046 1.5 11.5V4.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>{:else}{#if isOpen}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z" fill="currentColor" /><path opacity="0.2" d="M13.6602 7.75525C13.9618 7.7556 14.1815 8.04179 14.1045 8.33337L13.0508 12.3031C12.9304 12.7567 12.5191 13.0725 12.0498 13.0726H2.91701C2.23744 13.0725 1.7417 12.4287 1.91603 11.7719L2.77834 8.52478C2.89898 8.07146 3.31018 7.75532 3.77931 7.75525H13.6602ZM5.1963 2.95154C5.34985 2.95159 5.49377 3.02803 5.57912 3.15564L6.0508 3.86365C6.39205 4.37553 6.96685 4.68385 7.58205 4.68396H12.1699C12.7416 4.68396 13.2049 5.14754 13.2051 5.71912V6.37439H3.77931C3.02267 6.37444 2.33067 6.72671 1.88283 7.29333V3.98669C1.88299 3.4152 2.34649 2.95168 2.91798 2.95154H5.1963Z" fill="currentColor" /></svg>{:else}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path transform="translate(1.5 2.429)" d="M5.05582 0.518756L4.50669 0.86654L5.05582 0.518756ZM13 9.4837L13.65 9.4837L13.65 3.53962L13 3.53962L12.35 3.53962L12.35 9.4837L13 9.4837ZM11.3264 1.86603L11.3264 1.21603L6.52313 1.21603L6.52313 1.86603L6.52313 2.51603L11.3264 2.51603L11.3264 1.86603ZM5.58054 1.34727L6.12968 0.999489L5.60495 0.170972L5.05582 0.518756L4.50669 0.86654L5.03141 1.69506L5.58054 1.34727ZM4.11323 1.23058e-13L4.11323 -0.65L1.67359 -0.65L1.67359 5.00699e-14L1.67359 0.65L4.11323 0.65L4.11323 1.23058e-13ZM0 1.67359L-0.65 1.67359L-0.65 9.4837L0 9.4837L0.65 9.4837L0.65 1.67359L0 1.67359ZM11.3264 11.1573L11.3264 10.5073L1.67359 10.5073L1.67359 11.1573L1.67359 11.8073L11.3264 11.8073L11.3264 11.1573ZM0 9.4837L-0.65 9.4837C-0.65 10.767 0.390308 11.8073 1.67359 11.8073L1.67359 11.1573L1.67359 10.5073C1.10828 10.5073 0.65 10.049 0.65 9.4837L0 9.4837ZM1.67359 5.00699e-14L1.67359 -0.65C0.390307 -0.65 -0.65 0.390309 -0.65 1.67359L0 1.67359L0.65 1.67359C0.65 1.10828 1.10828 0.65 1.67359 0.65L1.67359 5.00699e-14ZM5.05582 0.518756L5.60495 0.170972C5.28121 -0.340193 4.71829 -0.65 4.11323 -0.65L4.11323 1.23058e-13L4.11323 0.65C4.27282 0.65 4.4213 0.731715 4.50669 0.86654L5.05582 0.518756ZM6.52313 1.86603L6.52313 1.21603C6.36354 1.21603 6.21507 1.13431 6.12968 0.999489L5.58054 1.34727L5.03141 1.69506C5.35515 2.20622 5.91808 2.51603 6.52313 2.51603L6.52313 1.86603ZM13 3.53962L13.65 3.53962C13.65 2.25634 12.6097 1.21603 11.3264 1.21603L11.3264 1.86603L11.3264 2.51603C11.8917 2.51603 12.35 2.97431 12.35 3.53962L13 3.53962ZM13 9.4837L12.35 9.4837C12.35 10.049 11.8917 10.5073 11.3264 10.5073L11.3264 11.1573L11.3264 11.8073C12.6097 11.8073 13.65 10.767 13.65 9.4837L13 9.4837Z" fill="currentColor" /></svg>{/if}{/if}</span><span class="entry-name">{entry.name}</span>
			</button>
		{:else}
			<button class="row file" class:changed={isChanged} data-changed={isChanged ? 'true' : undefined} data-testid="tree-file" onclick={() => onOpenFile(child)} title={child}>
				<span class="caret" aria-hidden="true"></span><span class="entry-icon"><FileTypeIcon name={entry.name} size={14} /></span><span class="entry-name">{entry.name}</span>
			</button>
{/if}
		{#if dir && isOpen}
			{#if levels[child]?.kind === 'loading'}
				<ul class="tree"><li class="note">{t(m.workspaceExplorerLoading)}</li></ul>
			{:else if levels[child]?.kind === 'failed'}
				<ul class="tree"><li class="note fail">{t(m.workspaceExplorerLoadFailed)}{levels[child]?.kind === 'failed' ? ` — ${levels[child].reason}` : ''}</li></ul>
			{:else if levels[child]?.kind === 'ready'}
				{#if levels[child].entries.length === 0}
					<ul class="tree"><li class="note">{t(m.workspaceExplorerEmpty)}</li></ul>
				{:else}
					<ul class="tree">
						{#each sorted(levels[child].entries) as sub (sub.name)}
							{@render row(sub, child, depth + 1)}
						{/each}
						{#if levels[child].truncated}
							<li class="note">{t(m.workspaceExplorerTruncated).trim()}</li>
						{/if}
					</ul>
				{/if}
			{/if}
		{/if}
	</li>
{/snippet}
<style>
	.tree {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* One indent step per nesting level — the nested ul is the ONLY indenter.
	   Indenting rows too compounded quadratically (parent li padding shifts the
	   child list inside it) and pushed depth-4 names off the panel. */
	.tree ul {
		list-style: none;
		margin: 0;
		padding: 0 0 0 0.75rem;
	}
	.row-line {
		min-width: 0;
	}
	/* The open file's row (File Link Intent 2026-09-25): accent wash + accent
	   text so the operator sees WHERE the linked file lives in the tree. */
	li.active > .row {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, transparent);
		color: var(--wsc-fg, color-mix(in srgb, var(--color-accent-blue, #3b82f6) 60%, var(--color-navy-focus)));
	}
	.row {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: none;
		background: transparent;
		padding: 0.1rem 0.25rem;
		font: inherit;
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.caret {
		flex-shrink: 0;
		width: 0.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.entry-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
	}
	/* app.css @layer base sets svg { color: var(--color-accent-purple) } — a
	   direct rule that beats inherited color, so every folder icon painted
	   accent-purple regardless of the tint below. Icons here must inherit
	   the span's color (amber plain, var(--color-accent-deep) repo). */
	.entry-icon :global(svg) {
		color: inherit;
	}
	/* Icon tint swap (user, 2026-09-12): plain folders carry the purple
	   accent; .git repo folders keep the amber of the DSH FileTypeIcon
	   folder (dsw static-amber-400) with their distinct stroked shape. */
	.dir .entry-icon {
		color: var(--color-accent-deep);
	}
	/* Git Eye repo rows (ADR D3): bold red name + amber stroked icon. */
	.row.repo .entry-icon {
		color: var(--color-tree-amber);
	}
	.row.repo .entry-name {
		font-weight: 600;
		color: var(--color-tree-repo); /* orangered */
	}
	/* A directory on the ancestor chain of a changed file: chocolate, bold —
	   distinct from the orangered repo rows it may coexist with. */
	.row.hot .entry-name {
		font-weight: 600;
		color: var(--color-tree-child); /* chocolate */
	}
	/* Identified-as-changed files (ADR D5 rows): chocolate + bold. */
	.row.changed .entry-name {
		color: var(--color-tree-child); /* chocolate */
		font-weight: 600;
	}
	.entry-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note {
		color: var(--color-text-muted, #6b7280);
		font-size: 0.75rem;
		padding: 0.1rem 0.25rem;
	}
	.note.fail {
		color: var(--si-run);
	}
</style>

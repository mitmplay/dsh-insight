<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * WorkspaceFileTabs — the Explorer Layout's tab strip + file container
	 * (ADR 2026-09-17 D3/D5, extracted from day one per the ADR's §7
	 * give-up: the panel must not grow into the new monolith).
	 *
	 * PRESENTATION ONLY (Module Communication Map): the open-tab list, the
	 * active path, and every fetch arrive as PROPS from the owning
	 * WorkspaceExplorerPanel; the only things leaving are INTENT callbacks
	 * — onActivate (focus an open tab), onClose (the per-tab [x]), and
	 * onClearAll (handed to the WorkspaceFileTabsClear child — the sticky
	 * clear's blanket confirm, ADR D5c amendment 2026-11-03). The content region is the parent's children snippet, so
	 * the panel hosts WorkspaceFile itself and this component never fetches.
	 *
	 * A closed panel drops the tabs with it (D5) — nothing here persists.
	 */
	import type { Snippet } from 'svelte';
	import WorkspaceFileTabsClear from './WorkspaceFileTabsClear.svelte';

	/** One open file tab — the panel's component state, deduped by path. */
	export interface WorkspaceFileTab {
		/** Root-relative path — identity within the panel's tab list. */
		path: string;
		/** Unsaved edit-buffer flag — the panel computes it from its
		 *  baseline (ADR D5d amendment 2026-11-03); drives the tint. */
		dirty?: boolean;
	}

	let {
		tabs,
		activePath,
		onActivate,
		onClose,
		onClearAll,
		children
	}: {
		/** Open tabs, in open order — the panel owns the list. */
		tabs: readonly WorkspaceFileTab[];
		/** The focused tab's path; null when no tab is open. */
		activePath: string | null;
		/** Focus intent — the panel flips its activePath. */
		onActivate: (path: string) => void;
		/** Per-tab close intent — the panel frees exactly that file (D5). */
		onClose: (path: string) => void;
		/** Clear-all intent with scope (ADR D5c amendment 2026-11-03) —
		 *  'all' closes every tab, 'non-dirty' keeps dirty drafts. Absent
		 *  renders no clear control (standalone tab surfaces). */
		onClearAll?: (scope: 'all' | 'non-dirty' | 'other') => void;
		/** The file body region — the parent renders WorkspaceFile here. */
		children: Snippet;
	} = $props();

	/** Tab label — the leaf name; the full root-relative path rides the
	 *  title attribute (ADR D5). */
	function leaf(path: string): string {
		const idx = path.lastIndexOf('/');
		return idx === -1 ? path : path.slice(idx + 1);
	}

	// D5a (2026-11-03): scroll the ACTIVE tab into view. Every opener —
	// tree click on a new file, focus of an already-open file, tab click —
	// funnels through activePath, so one watcher covers them all. 'nearest'
	// keeps an in-view tab from jumping the scroll position.
	let activeBtn = $state<HTMLButtonElement | null>(null);
	/** The action form of the active-button reference: the CLI autofixer's
	 *  compiler rejects a bind:this arrow on the tab, so the element rides
	 *  in through an action instead (same fact, no bind). */
	function trackActive(el: HTMLButtonElement) {
		$effect(() => {
			if (el.getAttribute('aria-selected') === 'true') activeBtn = el;
		});
	}
	$effect(() => {
		// read activePath so the effect reruns on every focus move; the
		// optional call keeps jsdom (no scrollIntoView) honest in tests
		void activePath;
		activeBtn?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
	});

	</script>

<div class="file-tabs" data-testid="workspace-file-tabs">
	{#if tabs.length > 0}
		<!-- D5b: the clear control sits in a fixed slot OUTSIDE the
		     scrolling strip — it never scrolls away or overlaps a tab. -->
		<div class="strip-row">
			<div class="strip" role="tablist" data-testid="workspace-file-tabstrip">
				{#each tabs as tab (tab.path)}
					<button
						type="button"
						role="tab"
						class="tab"
						class:active={tab.path === activePath}
						class:dirty={tab.dirty === true}
						data-testid="workspace-file-tab-{tab.path}"
						title={tab.path}
						aria-selected={tab.path === activePath}
						use:trackActive
						onclick={() => onActivate(tab.path)}
					>
						<span class="label">{leaf(tab.path)}</span>
						<!-- stopPropagation: the [x] must never double as an activate -->
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<span
							role="button"
							tabindex="-1"
							class="close"
							data-testid="workspace-file-tabclose-{tab.path}"
							aria-label={t(m.close)}
							title={t(m.close)}
							onclick={(e) => {
								e.stopPropagation();
								onClose(tab.path);
							}}
						>×</span>
					</button>
				{/each}
			</div>
			{#if onClearAll}
				<WorkspaceFileTabsClear onClear={onClearAll} />
			{/if}
		</div>
		<div class="body">{@render children()}</div>
	{:else}
		<!-- An honest empty region — never a blank area (the FilesBody rule). -->
		<div class="empty" data-testid="workspace-file-tabs-empty"></div>
	{/if}
</div>

<style>
	.file-tabs {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.strip-row {
		display: flex;
		align-items: stretch;
		flex: 0 0 auto;
		min-width: 0;
		border-bottom: 1px solid var(--color-border, #ddd);
	}
	.strip {
		display: flex;
		flex: 1 1 auto;
		gap: 2px;
		overflow-x: auto; /* the strip scrolls when crowded (ADR D5) */
		padding: 2px 4px 0;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 180px;
		padding: 3px 6px;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		background: transparent;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab.active {
		border-color: var(--color-border, #ddd);
		background: var(--color-surface, var(--color-surface-elevated));
		font-weight: 600;
	}
	/* D5d: the dirty tint — a signature accent wash so the operator reads
	   what Clear non-dirty will KEEP before choosing. Presentation only. */
	.tab.dirty {
		background: var(--color-accent-amber-soft, rgba(255, 171, 0, 0.18));
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		font-size: 0.7rem;
		line-height: 1;
		color: var(--color-text-muted, #888);
	}
	.close:hover {
		background: var(--color-border, #ddd);
		color: var(--color-text-primary);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.empty {
		flex: 1;
	}
	/* The hosted file component (WorkspaceFilePanel) must fill the body's
	   remaining height — its own .file-panel height contract only works
	   when the direct parent chain gives it a definite box (operator bug
	   2026-09-17: the editor collapsed to content height). */
	.body :global(> *) {
		flex: 1;
		min-height: 0;
		height: auto;
	}
</style>

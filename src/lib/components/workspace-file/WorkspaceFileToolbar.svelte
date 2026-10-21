<script lang="ts">
	/**
	 * WorkspaceFileToolbar — the workspace-file body's toolbar row
	 * (extracted from WorkspaceFilePanel's .file-toolbar): the FULL-path
	 * readout on the left (the SettingsHomeToolbar pattern), and the
	 * delegated Save verb, the dirty / stale indicators, the preview/edit
	 * tabs (markdown + html kinds only), the File Eye toggle
	 * (WorkspaceFileTabGroup), and the column capture button
	 * right-aligned on the right.
	 *
	 * Presentational (Module Communication Map): the panel owns the edit
	 * buffer, the baseline, and the save turn — the toolbar receives the
	 * flags, emits the save intent, and binds the tab choice back up
	 * ($bindable — the panel's render ladder reads it).
	 */
		import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import WorkspaceFileTabGroup from './WorkspaceFileTabGroup.svelte';

	// The canvas-copy capture target: the owning PanelColumn. The toolbar
	// is a deeply nested child of the column, and the column element is
	// page-owned (the route's PanelColumn), so the toolbar walks UP from
	// its own root to the nearest ancestor carrying the column's
	// data-testid marker — no new prop threading through
	// WorkspaceFilePanel just to name an ancestor.
	let toolbarEl = $state<HTMLDivElement>();
	let columnEl = $state<HTMLElement | null>(null);
	$effect.pre(() => {
		columnEl = toolbarEl?.closest<HTMLElement>('[data-testid="panel-column"]') ?? null;
	});

	let {
		/** Dirty = the edit buffer differs from the baseline (owner-owned). */
		dirty,
		/** The delegated save's progress — gates the Save verb, drives the
		 *  stale note. */
		saveState = 'idle',
		/** Index Pulse: an external change arrived while a draft exists —
		 *  the visible note (panel supplies the catalog string). */
		stale = false,
		staleNote = '',
		/** Whether the file kind shows preview/edit tabs (md/html only). */
		hasTabs = false,
		/** The active tab — two-way: the panel's render ladder reads it. */
		tab = $bindable('preview'),
		/** The File Eye view — the panel's derived authority (ADR D6). */
		view = 'edit',
		/** The toggle renders only when the file is changed on an open gate. */
		showToggle = false,
		/** A dirty buffer locks the Diff segment (ADR D3). */
		diffDisabled = false,
		/** A closed gate removes the Save verb entirely (ADR D4). */
		readonly = false,
		/** View intent — the panel bridges it to the owner. */
		onviewchange,
		/** Save intent — the panel POSTs the save. */
		onsave,
		/** The FULL display path (root + relative path, owner-composed) —
		 *  the left-side readout; everything else right-aligns after it. */
		path
	}: {
		dirty: boolean;
		saveState?: 'idle' | 'saving' | 'saved' | 'failed';
		stale?: boolean;
		staleNote?: string;
		hasTabs?: boolean;
		tab?: 'preview' | 'edit';
		view?: 'edit' | 'diff';
		showToggle?: boolean;
		diffDisabled?: boolean;
		readonly?: boolean;
		onviewchange?: (view: 'edit' | 'diff') => void;
		onsave: () => void;
		path: string;
	} = $props();
</script>

<div class="file-toolbar" bind:this={toolbarEl}>
	<!-- Left side: the full-path readout (flex:1) — every control to
	     its right (save, File Eye, chips, tabs, capture) right-aligns. -->
	<span class="path" title={path}>{path}</span>
	{#if showToggle}
		<WorkspaceFileTabGroup {view} {diffDisabled} {onviewchange} />
	{/if}
	{#if !readonly}
		<button
			type="button"
			class="save-btn"
			data-testid="file-save"
			disabled={!dirty || saveState === 'saving' || view === 'diff'}
			onclick={onsave}
		>{saveState === 'saving' ? t(m.workspaceFileSaving) : t(m.workspaceFileSave)}</button>
	{/if}
	{#if dirty}
		<span class="dirty" data-testid="file-dirty">{t(m.workspaceFileDirty)}</span>
	{/if}
	{#if saveState === 'saved' && !dirty}
		<span class="stale" data-testid="file-stale">{t(m.workspaceFileStale)}</span>
	{/if}
	{#if stale}
		<span class="stale" data-testid="file-stale-external">{staleNote}</span>
	{/if}
	{#if hasTabs}
		<div class="tabs" role="tablist">
			<button role="tab" aria-selected={tab === 'preview'} class:active={tab === 'preview'} data-testid="tab-preview" onclick={() => (tab = 'preview')}>{t(m.workspaceFilePreview)}</button>
			<button role="tab" aria-selected={tab === 'edit'} class:active={tab === 'edit'} data-testid="tab-edit" onclick={() => (tab = 'edit')}>{t(m.workspaceFileEdit)}</button>
		</div>
	{/if}
	<!-- Capture the whole panel column (the toolbar's nearest
	     data-testid="panel-column" ancestor) as a PNG: click copies,
	     Shift+Click saves. Null container before mount = no-op. The
	     path readout's flex:1 does the right-aligning. -->
	<span class="copy-slot">
		<CanvasCopyButton
			container={columnEl}
			title={t(m.workspacePanelCommonCopyColumn)}
			size={18}
			class="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text-secondary"
		/>
	</span>
</div>

<style>
	.file-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* The left-side full-path readout: fills the slack so every control
	   right-aligns (the SettingsHomeToolbar pattern). */
	.path {
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.dirty {
		flex-shrink: 0;
		color: var(--color-accent-amber-ink-deep);
		font-size: 0.6875rem;
	}
	/* The delegated save's verb: same chip grammar as the tabs; disabled
	   while clean or in-flight (ADR D4 — save is explicit, never automatic). */
	.save-btn {
		flex-shrink: 0;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		padding: 0.1rem 0.5rem;
		font-size: 0.6875rem;
		cursor: pointer;
	}
	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.stale {
		flex-shrink: 0;
		color: var(--color-text-muted, #6b7280);
		font-size: 0.6875rem;
	}
	.copy-slot {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	.tabs {
		display: inline-flex;
		gap: 0.125rem;
	}
	.tabs button {
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		padding: 0.1rem 0.5rem;
		font-size: 0.6875rem;
		cursor: pointer;
	}
	.tabs button.active {
		background: var(--color-accent-blue, #3b82f6);
		border-color: var(--color-accent-blue, #3b82f6);
		color: #fff;
	}
</style>

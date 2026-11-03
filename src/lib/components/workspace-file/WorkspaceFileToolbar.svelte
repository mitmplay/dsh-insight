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
	import ReloadButton from '$lib/components/common/buttons/ReloadButton.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import WorkspaceFileTabGroup from './WorkspaceFileTabGroup.svelte';
	import PreviewTab from './toolbar/PreviewTab.svelte';
	import EditTab from './toolbar/EditTab.svelte';
	import FileEdit from './toolbar/FileEdit.svelte';
	import FileSave from './toolbar/FileSave.svelte';
	import HeadChip from './toolbar/HeadChip.svelte';

	// The canvas-copy capture target: the owning PanelColumn. The toolbar
	// is a deeply nested child of the column, and the column element is
	// page-owned (the route's PanelColumn), so the toolbar walks UP from
	// its own root to the nearest ancestor carrying the column's
	// data-testid marker — no new prop threading through
	// WorkspaceFilePanel just to name an ancestor.
	let toolbarEl = $state<HTMLDivElement>();
	/** The reload icon's feedback state — the CanvasCopyButton machine
	 *  (idle → busy spinner → done check → idle), mirrored per the 2026-10-27
	 *  UX-parity operator request: a click that shows nothing happening "sucks". */
	let reloadState = $state<'idle' | 'busy' | 'done'>('idle');
	async function handleReload(): Promise<void> {
		if (reloadState === 'busy' || !onreload) return;
		reloadState = 'busy';
		try {
			await onreload();
			reloadState = 'done';
			setTimeout(() => (reloadState = 'idle'), 2000);
		} catch {
			reloadState = 'idle';
		}
	}
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
		/** The Single Edit (ADR D2): the operator-facing edit mode — the
		 *  Edit verb flipped it on; the raw editor is writable only now. */
		editing = false,
		/** Edit-mode intent — toggles the verb between Edit and Cancel. */
		ontoggledit,
		/** A closed gate removes the Save verb entirely (ADR D4). */
		readonly = false,
		/** View intent — the panel bridges it to the owner. */
		onviewchange,
		/** Save intent — the panel POSTs the save. */
		onsave,
		onreload,
		ontoggleexplorer,
		explorerHidden = false,
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
		editing?: boolean;
		ontoggledit?: (next: boolean) => void;
		readonly?: boolean;
		onviewchange?: (view: 'edit' | 'diff') => void;
		onsave: () => void;
		/** Reload intent (2026-10-27 operator request): silently refetch the
		 *  current file (draft-safe — the panel's refreshFile). Optional;
		 *  absent renders nothing. */
		onreload?: () => void | Promise<void>;
		/** Explorer hide/show intent (2026-10-31): OPTIONAL — absent renders
		 *  no toggle icon (standalone file surfaces). Present, the button
		 *  flips the workspace-explorer tree lane (WorkspaceExplorerPanel). */
		ontoggleexplorer?: () => void;
		/** The lane's current visibility — flips the glyph + label. */
		explorerHidden?: boolean;
		path: string;
	} = $props();
</script>

<div class="file-toolbar" data-testid="file-toolbar" bind:this={toolbarEl}>
	<!-- Left side: the full-path readout (flex:1) — every control to
	     its right (save, File Eye, chips, tabs, capture) right-aligns. -->
	<span class="path" title={path}>{path}</span>
	{#if showToggle}
		<WorkspaceFileTabGroup {view} {onviewchange} />
	{/if}
	{#if hasTabs}
		<!-- RCA fix D (2026-10-31): the view pair leads, actions follow —
		     the uncommon Save|Preview|Edit read is gone. -->
		<div class="tabs" role="tablist">
			<!-- Icon-only tabs: the paraglide label rides aria-label + title —
			     the accessible name survives, the row loses two words. -->
			<PreviewTab active={tab === 'preview'} onselect={() => (tab = 'preview')} />
			<EditTab active={tab === 'edit'} onselect={() => (tab = 'edit')} />
		</div>
	{/if}
	{#if !readonly}
		<!-- The Single Edit (ADR D2/D6): the mode verb — renders whenever
		     the gate is open, flips Edit → Cancel while editing. The ONE
		     word "Edit" on this row. -->
		<FileEdit {editing} {ontoggledit} />
	{/if}
	{#if !readonly && editing && dirty}
		<!-- The Single Edit (ADR D3): Save renders ONLY while a draft
		     exists — no permanent disabled ghost. -->
		<FileSave saving={saveState === 'saving'} {onsave} />
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
	{#if onreload}
		<!-- Manual reload (2026-10-27): the freshness valve for surfaces the
		     Index Pulse cannot see (gateless desk, non-repo files) — the
		     panel's refreshFile is draft-safe and silent. Placed BEFORE the
		     capture button per operator decision. -->
		<ReloadButton
			state={reloadState}
			onclick={handleReload}
			label={t(m.refresh)}
			testid="file-reload"
			class="reload-btn"
		/>
	{/if}
	{#if ontoggleexplorer}
		<!-- Explorer hide/show (2026-10-31): handler-gated — sits AFTER the
		     reload button per operator decision; the glyph reflects state. -->
		<HeadChip hidden={explorerHidden} ontoggle={ontoggleexplorer} />
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
		gap: 0.25rem;
	}
	/* The left-side full-path readout: fills the slack so every control
	   right-aligns (the SettingsHomeToolbar pattern). */
	.path {
		font-size: 0.75rem;
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
		font-size: 0.75rem;
	}
	/* The reload icon: same right-aligned chip grammar as the capture
	   button beside it — ghost until hover, never steals flex slack. */
	/* :global — the button element now lives inside ReloadButton
	   (2026-10-28 extraction); a plain scoped selector would not reach it. */
	.file-toolbar :global(.reload-btn) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		/* Same bordered-chip grammar as the tabs / Save verb (2026-10-27
		   operator request: the borderless ghost icons read as uneven
		   against the bordered chips beside them). */
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
	}
	.file-toolbar :global(.reload-btn:hover) {
		background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
		color: var(--color-text-primary, #212529);
	}
	.stale {
		flex-shrink: 0;
		color: var(--color-text-muted, #6b7280);
		font-size: 0.75rem;
	}
	.copy-slot {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		height: 1.5rem;
		box-sizing: border-box;
		/* The capture button's bordered chip shell — same grammar and
		   uniform height as the reload button beside it (2026-10-27
		   operator request). */
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
	}
	.copy-slot :global(button) {
		height: 100%;
		display: inline-flex;
		align-items: center;
	}
	.tabs {
		display: inline-flex;
		/* Same gap as the toolbar row: flex gap does not inherit, so the
		   tab chips must restate it — uniform spacing across Save / tabs /
		   reload / capture (2026-10-27 operator request — inconsistent
		   gaps between buttons; tightened to 0.25rem same day). */
		gap: 0.25rem;
	}
</style>

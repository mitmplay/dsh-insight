<script lang="ts">
	/**
	 * WorkspaceFile — the file body's view switch (extracted 2026-09-13
	 * from WorkspaceFilePanel's markup, same extraction series as the
	 * explorer components). Presentation only: every value arrives as a
	 * prop, every intent leaves as a callback — the panel keeps the text
	 * state, the Monaco lifecycle, and the save logic.
	 *
	 * Layout contract (the height fix that shipped with this extraction):
	 * .file-panel fills its column (height: 100%) and NEVER scrolls
	 * itself (overflow: hidden) — the scroll lives on .file-scroll for
	 * the content views that need it (image, markdown preview). The
	 * editor/iframe hosts take flex: 1 with min-height: 0 so the Monaco
	 * editor sizes to the remaining space and scrolls INTERNALLY; the
	 * old overflow:auto container made the hosts content-sized and the
	 * page-level scrollbar stole the height.
	 */
	import WorkspaceFileToolbar from './WorkspaceFileToolbar.svelte';
	import MarkdownPanel from '../panels/MarkdownPanel.svelte';

	let {
		tab = $bindable(),
		dirty,
		fullPath,
		saveState,
		fileStale,
		staleNote,
		hasTabs,
		activeView,
		showToggle,
		diffDisabled,
		readonly,
		onViewChange,
		onSave,
		onReload,
		saveError,
		saveFailedNote,
		loadingNote,
		loadFailedNote,
		truncatedNote,
		newFileNote,
		phase,
		errorCode,
		title,
		isImage,
		bytesSrc,
		isHtml,
		text,
		isMarkdown,
		noHead,
		eof,
		editorHost = $bindable(null),
		diffHost = $bindable(null)
	}: {
		/** The active body tab — the panel owns it; bindable so the toolbar flips it. */
		tab?: 'preview' | 'edit';
		/** The FULL display path (root + relative path) — the toolbar's left readout. */
		fullPath: string;
		/** Unsaved-buffer flag — drives the toolbar's dirty chip and diff lock. */
		dirty: boolean;
		/** Save lifecycle: idle | saving | saved | failed. */
		saveState: 'idle' | 'saving' | 'saved' | 'failed';
		/** External-change flag — the toolbar's stale chip. */
		fileStale: boolean;
		/** The stale chip's copy (owner-translated). */
		staleNote: string;
		/** Whether the toolbar shows the tab strip at all. */
		hasTabs: boolean;
		/** The File Eye view: editor vs diff. */
		activeView: 'edit' | 'diff';
		/** Whether the diff/editor toggle renders (gate open AND changed). */
		showToggle: boolean;
		/** Diff toggle disabled while the buffer is dirty. */
		diffDisabled: boolean;
		/** Read-only gate — the toolbar's RO chip. */
		readonly: boolean;
		/** View-switch intent. */
		onViewChange: (view: 'edit' | 'diff') => void;
		/** Save intent — the panel POSTs the buffer. */
		onSave: () => void;
		/** Reload intent (2026-10-27): the panel's draft-safe refreshFile. */
		onReload?: () => void;
		/** The failed save's error detail, when any. */
		saveError: string | null;
		/** The save-failed note's copy (owner-translated). */
		saveFailedNote: string;
		/** The loading note's copy (owner-translated). */
		loadingNote: string;
		/** The load-failed note's copy (owner-translated). */
		loadFailedNote: string;
		/** The truncated-file note's copy (owner-translated). */
		truncatedNote: string;
		/** The diff new-file note's copy (owner-translated). */
		newFileNote: string;
		/** Load lifecycle: loading | ready | failed. */
		phase: 'loading' | 'ready' | 'failed';
		/** The failure's wire code, shown beside the failed note. */
		errorCode: string | null;
		/** File title — the image alt / iframe title. */
		title: string;
		/** Image file — render the preview instead of text. */
		isImage: boolean;
		/** Data/blob URL for the image preview. */
		bytesSrc: string;
		/** HTML file — the preview tab renders a sandboxed iframe. */
		isHtml: boolean;
		/** The file text (null until loaded). */
		text: string | null;
		/** Markdown file — the preview tab renders MarkdownPanel. */
		isMarkdown: boolean;
		/** No HEAD blob — the honest new-file note in diff view. */
		noHead: boolean;
		/** The listing was truncated by the byte cap. */
		eof: boolean;
		/** Monaco editor mount point — the panel creates the editor in it. */
		editorHost?: HTMLElement | null;
		/** Monaco diff mount point — same lifecycle as editorHost. */
		diffHost?: HTMLElement | null;
	} = $props();
</script>

<div class="file-panel">
	<WorkspaceFileToolbar
		bind:tab
		{dirty}
		path={fullPath}
		{saveState}
		stale={fileStale}
		{staleNote}
		{hasTabs}
		view={activeView}
		{showToggle}
		{diffDisabled}
		{readonly}
		onviewchange={onViewChange}
		onsave={onSave}
		onreload={onReload}
	/>
	{#if saveState === 'failed'}
		<p class="note fail" data-testid="file-save-failed">{saveFailedNote}{saveError ? ' — ' + saveError : ''}</p>
	{/if}
	{#if phase === 'loading'}
		<p class="note">{loadingNote}</p>
	{:else if phase === 'failed'}
		<p class="note fail" data-testid="file-failed">{loadFailedNote} ({errorCode})</p>
	{:else if isImage}
		<div class="file-scroll">
			<img class="img-preview" data-testid="file-image" src={bytesSrc} alt={title} />
		</div>
	{:else if isHtml && tab === 'preview'}
		<iframe class="html-frame" data-testid="file-html-frame" sandbox="" srcdoc={text ?? ''} title={title}></iframe>
	{:else if activeView === 'diff'}
		<!-- The File Eye diff view (ADR D2; Shared Tree amendment 2026-09-16):
		     HEAD beside the live content — and for an UNTRACKED file the
		     original is EMPTY, so every line reads as added. The note stays
		     as a caption above the surface. -->
		{#if noHead}
			<p class="note" data-testid="file-diff-new-file">{newFileNote}</p>
		{/if}
		<div class="file-editor-host" data-testid="file-diff-view" bind:this={diffHost}></div>
	{:else if isMarkdown && tab === 'preview'}
		<div class="file-scroll">
			<MarkdownPanel content={text ?? ''} />
		</div>
	{:else}
		{#if !eof}<p class="note">{truncatedNote}</p>{/if}
		<div class="file-editor-host" bind:this={editorHost}></div>
	{/if}
</div>

<style>
	.file-panel {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		height: 100%;
		overflow: hidden; /* the SCROLL lives on .file-scroll / the hosts — the panel must not scroll */
		padding: 0.25rem;
		font-size: 0.8125rem;
	}
	.note {
		color: var(--color-text-muted, #6b7280);
		font-size: 0.75rem;
	}
	.note.fail {
		color: var(--si-run);
	}
	.file-editor-host {
		flex: 1;
		min-height: 0; /* the editor fills the remaining space and scrolls internally */
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		/* Scaled down (13px base → ~11px effective): zoom (not transform)
		   reflows layout, so Monaco's automaticLayout still fills the
		   box and internal scrolling math stays correct. */
		zoom: 0.85;
	}
	.file-scroll {
		flex: 1;
		min-height: 0; /* the scrollable content views take the remaining space */
		overflow: auto;
		display: flex;
		flex-direction: column;
	}
	.img-preview {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		background: repeating-conic-gradient(var(--color-surface-alt) 0% 25%, var(--color-surface-elevated) 0% 50%) 50% / 16px 16px;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
	}
	.html-frame {
		flex: 1;
		min-height: 0; /* was min-height: 12rem — the frame takes the space it has and scrolls internally */
		width: 100%;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: var(--color-surface-elevated);
	}
</style>

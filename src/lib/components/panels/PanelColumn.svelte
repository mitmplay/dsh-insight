<script lang="ts">
	/**
	 * PanelColumn — the DSI RENDERER over the package's PaneBase shell
	 * (ADR-0062 W4, D8): the generic column chrome (width lock, selection
	 * ring, narrow query, activate/loupe gestures) lives in
	 * @deepseek-insight/container-base; THIS file supplies DSI's own
	 * vocabulary as snippets — the PanelHeader floor chrome with its
	 * paraglide labels and panel-rows title, the WidthBadge chip, the
	 * keyed conversation body from the route, and the ResizeGutter seam
	 * after the column.
	 *
	 * Width badge (2026-08-28): a `widthBadge` phase prop ('live' during
	 * a gutter drag that moves this panel's width, 'fading' through the
	 * 10s afterglow) floats the CURRENT width at the column's top right,
	 * below the header's controls, pointer-transparent — the route owns
	 * the membership rule (changed-from-snapshot) and the fade timer.
	 */
	import { panelHeaderLabel } from '$lib/services/panels/panel-rows';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { PaneBase } from '@deepseek-insight/container-base';
	import PanelHeader from './PanelHeader.svelte';
	import ResizeGutter from './ResizeGutter.svelte';
	import { WidthBadge } from '@deepseek-insight/container-base';

	let {
		panel,
		index,
		selected,
		widthBadge = null,
		copyValue,
		canMoveLeft = false,
		canMoveRight = false,
		onremove,
		onactivate,
		onloupe,
		children
	}: {
		/** The panel entry — id, sessionId, width (from the route's panels). */
		panel: import('$lib/types').DsiPanelEntry;
		/** Column index — the gutter's registry payload. */
		index: number;
		/** Selection cue — ring on the selected column. */
		selected: boolean;
		/** Width-badge phase — 'live' (dragging), 'fading' (10s
		 *  afterglow), or null (no badge). Route-owned lifecycle. */
		widthBadge?: 'live' | 'fading' | null;
		/** Header copy value override (the workspace-FILE variant): the
		 *  composed full path — the column cannot see the route's root
		 *  fallback (spine/cold), so the route computes and threads it. The
		 *  explorer kind derives its own (panel.root) below. */
		copyValue?: string;
		/** Header move chevron gating — false hides the button (first/last). */
		canMoveLeft?: boolean;
		canMoveRight?: boolean;
		/** Close this panel — route-owned mutation. The opts carry the
		 *  event modifiers the route needs (Shift+Click = close only this
		 *  panel, the family stays). */
		onremove: (opts?: { shiftKey?: boolean }) => void;
		/** Activate (select) this panel — fired on pointerdown/focusin
		 *  anywhere INSIDE the column (2026-08-25: interacting with a
		 *  conversation focuses its floor panel; the sidebar follows). */
		onactivate?: () => void;
		/** Open the loupe on this panel (The Panel Loupe ADR D1,
		 *  2026-09-04; modifier and kind scope widened by The Loupe for
		 *  Every Panel, 2026-09-08). Optional — absent, the Alt+Click is
		 *  a safe no-op. The gesture lives in PaneBase (the package shell). */
		onloupe?: () => void;
		/** Snippet: the conversation body (the route's keyed ConversationPanel). */
		children: import('svelte').Snippet;
	} = $props();

	// The header/toolbar snippets are declared below ({#snippet}) and
	// handed to PaneBase — DSI's floor chrome renders INSIDE the generic
	// shell (the explorer/file variants: the label is the workspace /
	// file name and the copy-id prefix button copies the FULL PATH —
	// panel bodies render NO second header).
</script>

{#snippet headerSnippet()}
	<PanelHeader
		panelId={panel.id}
		sessionId={panel.kind === 'conversation' ? panel.sessionId : ''}
		label={panelHeaderLabel(panel)}
		copyValue={panel.kind === 'workspace-explorer' ? panel.root : panel.kind === 'workspace-file' ? copyValue : undefined}
		copyLabel={panel.kind === 'workspace-explorer' ? t(m.workspaceExplorerCopyWorkspace) : panel.kind === 'workspace-file' ? t(m.workspaceFileCopyFilename) : undefined}
		labelTestId={panel.kind === 'workspace-explorer' ? 'explorer-title' : panel.kind === 'workspace-file' ? 'file-title' : undefined}
		{selected}
		{canMoveLeft}
		{canMoveRight}
		{onremove}
	/>
{/snippet}

{#snippet toolbarSnippet()}
	{#if widthBadge !== null}
		<!-- Width badge (extracted 2026-10-30, Movable Rail ADR D1): the
		     shared chip — same markup, styles and testid as the inline
		     version it replaced (pixel-identical). -->
		<WidthBadge phase={widthBadge} width={panel.width} />
	{/if}
{/snippet}

<PaneBase
	width={panel.width}
	paneId={panel.id}
	sessionTag={panel.kind === 'conversation' ? panel.sessionId : null}
	{selected}
	{onactivate}
	{onloupe}
	header={headerSnippet}
	toolbar={toolbarSnippet}
	{children}
/>

<ResizeGutter {index} />

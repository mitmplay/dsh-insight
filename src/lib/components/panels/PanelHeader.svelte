<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * PanelHeader — a panel column's header strip (Panel Floor W3 task
	 * 3.2, ADR-0006). The panel's CONVERSATION header (rename, workspace
	 * chip, status) stays inside ConversationPanel — this is the floor
	 * chrome strip above it: which session the column holds, the move
	 * chevrons (OCI ColumnHeader precedent: swap with the neighbor
	 * through the registry, hidden at the row's edges), and the close
	 * button. Presentational except the move invoke, which is a registry
	 * action (leaf→root); close reports upward via onremove.
	 *
	 * Session-id label (2026-08-25): the label is the session id in
	 * full — never truncated — prefixed by a copy-id icon button
	 * (SessionIdAndName precedent: the click copies the id, 2s ✓
	 * feedback). The session title is deliberately absent: it already
	 * renders below in ConversationPanel's SessionIdAndName, so the
	 * floor strip carries only the column's identity.
	 *
	 * Lens mode (The Panel Loupe ADR D8, 2026-09-04): the loupe renders
	 * this header whole but its floor-identity verbs inert — BOTH move
	 * chevrons and the close render visible-disabled regardless of edge
	 * or mount props (order/membership live on the column), while label
	 * and copy-id stay live (the clipboard has no floor membership).
	 * Default false: a floor mount renders exactly as before.
	 */
	import { Check, ChevronLeft, ChevronRight, Copy } from '@lucide/svelte';
	import PanelClose from './PanelClose.svelte';
	import { movePanelFromRegistry } from '$lib/services/panels/panel-registry';
	import { copyWithFeedback } from '$lib/utils/clipboard';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
	
	// The canvas-copy capture target: the header's PARENT — PanelColumn
	// renders the header as its first child, so the parent IS the column.
	let headerEl = $state<HTMLDivElement>();

	let {
		panelId,
		sessionId,
		label,
		copyValue,
		copyLabel,
		labelTestId,
		selected = false,
		canMoveLeft = false,
		canMoveRight = false,
		lens = false,
		onremove
	}: {
		/** Panel id — the move action's registry payload. */
		panelId: string;
		/** Session id — the column's identity: label text, copy value, tooltip. */
		sessionId: string;
		/** MANAGER VARIANT (W6, ADR D9): a plain title bar label — no id,
		 *  no copy button, no conversation chips (the manager carries its
		 *  own toolbar below). Absent = the conversation header verbatim.
		 *  With copyValue also set (the explorer variant) the label renders
		 *  WITH the copy button. */
		label?: string;
		/** Copy button value — present renders the copy-id prefix button
		 *  (the session variant's default). Set it together with label to
		 *  get the labeled-with-copy variant (workspace explorer: the
		 *  button copies the workspace full path). */
		copyValue?: string;
		/** Copy button accessible label. Default: the session-id copy. */
		copyLabel?: string;
		/** The label span's testid override (the explorer's title keeps
		 *  its explorer-title hook inside the floor chrome). */
		labelTestId?: string;
		/** Selection cue — the selected column carries a ring. */
		selected?: boolean;
		/** Move chevron gating — false at the row's edge hides the button. */
		canMoveLeft?: boolean;
		canMoveRight?: boolean;
		/** Lens mode (The Panel Loupe ADR D8, 2026-09-04): chevrons and
		 *  close render visible-disabled — both chevrons regardless of
		 *  edge, close without an onremove handler. Default false. */
		lens?: boolean;
		/** Close this panel (route-owned panels mutation). The opts carry
		 *  the click modifiers — Shift+Click means "close ONLY this panel"
		 *  (2026-09-01): the route skips the family closure. */
		onremove?: (opts?: { shiftKey?: boolean }) => void;
	} = $props();

	/** Copy-session-id feedback (2s ✓, copyWithFeedback contract). */
	let idCopied = $state(false);

	/** Chevron click — registry invoke (no floor → false → no-op). */
	function handleMove(dir: 'left' | 'right'): void {
		movePanelFromRegistry(panelId, dir);
	}
</script>

<div class="panel-header" class:selected data-testid="panel-header" title={label ?? sessionId} bind:this={headerEl}>
	<span class="label" data-testid={labelTestId ?? 'panel-header-label'}>
		{#if copyValue !== undefined || label === undefined}
			<button
				type="button"
				class="hdr-btn"
				data-testid="panel-header-copy-id"
				aria-label={copyLabel ?? 'Copy session id'}
				title={copyLabel ?? sessionId}
				onclick={async () => {
					await copyWithFeedback(copyValue ?? sessionId, (v) => (idCopied = v));
				}}
			>
				{#if idCopied}
					<Check size={12} class="text-status-pass" aria-hidden="true" />
				{:else}
					<Copy size={12} aria-hidden="true" />
				{/if}
			</button>
		{/if}
		<span class="id">{label ?? sessionId}</span>
	</span>
	<span class="actions">
		{#if canMoveLeft || lens}
			<button
				type="button"
				class="hdr-btn"
				disabled={lens}
				data-testid="panel-move-left"
				aria-label={t(m.movePanelLeft)}
				title={t(m.movePanelLeft)}
				onclick={() => handleMove('left')}
			>
				<ChevronLeft size={12} aria-hidden="true" />
			</button>
		{/if}
		{#if canMoveRight || lens}
			<button
				type="button"
				class="hdr-btn"
				disabled={lens}
				data-testid="panel-move-right"
				aria-label={t(m.movePanelRight)}
				title={t(m.movePanelRight)}
				onclick={() => handleMove('right')}
			>
				<ChevronRight size={12} aria-hidden="true" />
			</button>
		{/if}
		<!-- Capture the owning panel column as a PNG: click copies,
		     Shift+Click saves (SettingsHomeToolbar grammar). A floor verb —
		     inert in lens mode (the loupe renders the header whole but its
		     floor-identity verbs disabled; ADR D8). -->
		{#if !lens}
			<CanvasCopyButton
				container={headerEl?.parentElement}
				mode="visible"
				title={t(m.workspacePanelCommonCopyColumn)}
				size={14}
				class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-hover"
			/>
		{/if}
		{#if onremove || lens}
			<PanelClose {sessionId} {lens} {onremove} />
		{/if}
	</span>
</div>

<style>
	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		min-height: 1.75rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
		background: var(--color-surface-primary, var(--color-surface-elevated));
		flex-shrink: 0;
	}

	/* Focus tint (ConversationFooter's oldlace, 2026-08-28): the
	   selected column's floor strip carries the same tint as the
	   conversation header/footer below it — the column you would type
	   into reads as one tinted frame. */
	.panel-header.selected {
		background: var(--color-header-wash);
	}

	.label {
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		overflow: hidden;
		white-space: nowrap;
	}

	/* The id renders in full — never truncated; only a sub-min column
	   width can clip it (overflow: hidden above), and 44-char ids fit
	   the 480px floor minimum. */
	.id {
		flex-shrink: 0;
		letter-spacing: 0.01em;
	}

	.actions {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
	}

	.hdr-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
	}

	.hdr-btn:hover,
	.hdr-btn:focus-visible {
		background: var(--color-surface-secondary, #f1f3f5);
		color: var(--color-text-primary, #212529);
	}

	.hdr-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>

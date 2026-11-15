<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { MANAGER_ROW_TITLE } from '$lib/services/panels/panel-rows';
	import { CanvasCopyButton } from '@deepseek-insight/container-base';

	// The canvas-copy capture target: the header's PARENT — the .mgr-modal
	// frame (this header mounts inside the portaled PromptsManagerDialog,
	// not a PanelColumn). The modal is position:fixed and viewport-
	// centered; CanvasCopyButton's UNFIX_ROOT neutralizes that on the
	// clone so the capture doesn't shrink/offset (2026-10-07 bug).
	let headerEl = $state<HTMLDivElement>();

	/**
	 * PromptsManagerDialogHeader — shell header of the prompts manager
	 * modal: title left, close right. Extracted from
	 * PromptsManagerDialog.svelte; the panel carries neither (it owns
	 * only toolbar + table; onclose stays for its Escape path).
	 */
	let {
		onclose
	}: {
		onclose: () => void;
	} = $props();
</script>

<div class="mgr-dialog-header" bind:this={headerEl}>
	<div class="mgr-dialog-title">{MANAGER_ROW_TITLE}</div>
	<CanvasCopyButton
		container={headerEl?.parentElement}
		mode="visible"
		title={t(m.copyPromptManagerImage)}
		size={14}
		class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-hover"
	/>
	<button type="button" class="mgr-dialog-close" onclick={onclose} aria-label={t(m.close)}>×</button>
</div>

<style>
	.mgr-dialog-header {
		display: flex;
		align-items: center;
		padding-left: 0.5rem;
		gap: 0.5rem;
		flex: none; /* header never scrolls — only the body does */
	}

	.mgr-dialog-title {
		font-size: 0.9rem;
		font-weight: 600;
		margin: 0;
		flex: 1; /* title left, close right */
		text-align: left;
	}

	.mgr-dialog-close {
		border: none;
		background: transparent;
		color: var(--color-text-muted, #888);
		font-size: 1.125rem;
		line-height: 1;
		cursor: pointer;
	}

	.mgr-dialog-close:hover {
		color: var(--color-text-primary, #212529);
		font-size: 0.8125rem;
	}
</style>

<!--
	SidebarHeaderActions — the expanded rail header's right-hand corner as
	ONE base organ (ADR-0074, R11): copy camera → collapse chevron → extras
	snippet, in that fixed order. The corner's skin (flex layout + icon
	dressing + hover states) lives ONLY here now — retired from DSI's
	scoped CSS + :global block. Labels arrive as props (the base never
	translates); the capture target is CONSUMER-OWNED (the page's bind:this
	element, per ADR-0074 whole-surface capture scope). Extras absent
	renders no empty slot markup.
-->
<script lang="ts">
	import CanvasCopyButton from './CanvasCopyButton.svelte';
	import SidebarCollapseButton from './SidebarCollapseButton.svelte';

	let {
		/** Consumer-owned capture target (page bind:this). Null before
		 *  mount: the copy button still renders, its click is
		 *  CanvasCopyButton's documented null-container no-op. */
		captureContainer = null,
		captureTitle,
		captureMode = 'visible',
		captureSize = 14,
		collapsed = false,
		collapseLabel = 'Collapse sidebar',
		collapseLabelCollapsed = 'Restore sidebar',
		onToggleCollapse,
		copyTestId = 'canvas-copy-button',
		collapseTestId,
		children
	}: {
		captureContainer?: HTMLElement | null;
		captureTitle?: string;
		/** 'visible' (default) — the corner captures the live viewport box;
		 *  'full' — the whole scrollable content. */
		captureMode?: 'full' | 'visible';
		captureSize?: number;
		collapsed?: boolean;
		collapseLabel?: string;
		collapseLabelCollapsed?: string;
		onToggleCollapse?: () => void;
		copyTestId?: string;
		collapseTestId?: string;
		/** Extras (floor tray, gear menus…) — rendered AFTER the two
		 *  default organs, never before, never between. */
		children?: import('svelte').Snippet;
	} = $props();
</script>

<div class="rail-header-actions">
	<CanvasCopyButton
		container={captureContainer}
		title={captureTitle}
		mode={captureMode}
		size={captureSize}
		class="sha-icon-btn"
		testid={copyTestId}
	/>
	<SidebarCollapseButton
		class="sha-icon-btn"
		collapsed={collapsed}
		label={collapseLabel}
		labelCollapsed={collapseLabelCollapsed}
		testid={collapseTestId}
		onToggle={() => onToggleCollapse?.()}
	/>
	{#if children}
		{@render children?.()}
	{/if}
</div>

<style>
	.rail-header-actions {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	/* Corner skin — moved verbatim from DSI's :global(.icon-btn) block
	   (ADR-0074 D4): the button roots belong to the package organs, so a
	   scoped descendant :global under this component's own root is the
	   only way scoped CSS reaches them (R6 lesson). */
	.rail-header-actions :global(.sha-icon-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 0.25rem;
		color: var(--color-text-secondary);
		background: transparent;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.rail-header-actions :global(.sha-icon-btn:hover),
	.rail-header-actions :global(.sha-icon-btn:focus-visible) {
		color: var(--color-accent-purple);
		background: var(--color-surface-hover);
		outline: none;
	}
</style>

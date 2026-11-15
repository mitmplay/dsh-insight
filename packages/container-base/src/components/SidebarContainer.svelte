<script module lang="ts">
	/** The collapsed-stub geometry (OCI ControlRail parity — the width the
	 *  DSI shell carries as a constant; kept here so base and consumers
	 *  agree on the number). */
	export const SIDEBAR_COLLAPSED_WIDTH = 34;
</script>

<script lang="ts">
	/**
	 * SidebarContainer — the generic sidebar shell (ADR-0063 D5). Contract
	 * derived from DSI's AppSidebar (read-first mandate, Tasks 5.1): three
	 * branches, one component —
	 *
	 *   collapsed        → 34px stub; ALL content (skin, words, controls)
	 *                      arrives via the `collapsed` snippet — the base
	 *                      owns only the geometry and the testid.
	 *   embedded         → the BARE rail (no width wrapper, no gutter):
	 *                      the hosting column owns both (OCI ControlRail).
	 *   standalone       → width-carrying wrapper + badge slot + the rail
	 *                      + the drag gutter as the rail's flex SIBLING
	 *                      (the rail's overflow:hidden must never clip the
	 *                      gutter's hit area — the 2026-09-11 bug).
	 *
	 * State is OWNED OUTSIDE (props + callbacks): collapse/width/drag live
	 * with the page (OCI ownership split); the container renders and
	 * reports. Words ride snippets/props; colors ride tokens — sections
	 * render via the default snippet so the consumer composes its own.
	 */
	import type { Component, Snippet } from 'svelte';

	let {
		collapsed = false,
		width = 400,
		embedded = false,
		/** The expanded rail's header row (brand, actions, collapse trigger). */
		header,
		/** The rail body — the consumer's sections (default snippet). */
		children,
		/** The collapsed-stub SKIN — paint only (gradient, texture). The base
		 *  renders it as a pointer-transparent absolute underlay, so skin and
		 *  content can never fight over paint order (the SSC#1 lesson). */
		collapsedSkin,
		/** The collapsed-stub CONTENT — interactive elements only (buttons,
		 *  mounts). The base wraps it in a positioned layer above the skin. */
		collapsedContent,
		/** Width-badge slot (standalone wrapper only; consumer renders it). */
		badge,
		/** Gutter reports mousedown; the page owns drag + clamp. */
		onResizeStart,
		/** Accessible gutter name (consumer words). */
		gutterLabel = 'Resize',
		testId = 'sidebar',
		testIdCollapsed = 'sidebar-collapsed'
	}: {
		collapsed?: boolean;
		width?: number;
		embedded?: boolean;
		header?: Snippet;
		children?: Snippet;
		collapsedContent?: Snippet;
		collapsedSkin?: Snippet;
		badge?: Snippet;
		onResizeStart?: (e: MouseEvent) => void;
		gutterLabel?: string;
		testId?: string;
		testIdCollapsed?: string;
	} = $props();
</script>

{#if collapsed}
	<div class="cb-sidebar-stub" data-testid={testIdCollapsed}>
		{#if collapsedSkin}
			<div class="cb-stub-skin">{@render collapsedSkin()}</div>
		{/if}
		{#if collapsedContent}
			<div class="cb-stub-content">{@render collapsedContent()}</div>
		{/if}
	</div>
{:else if embedded}
	<aside class="cb-sidebar cb-sidebar-embedded" data-testid={testId}>
		{#if header}{@render header()}{/if}
		{@render children?.()}
	</aside>
{:else}
	<div class="cb-sidebar-wrap" style="width: {width}px" data-testid={testId + '-wrap'}>
		{#if badge}{@render badge()}{/if}
		<aside class="cb-sidebar" data-testid={testId}>
			{#if header}{@render header()}{/if}
			{@render children?.()}
		</aside>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions —
		     mouse-drag resize handle (ResizeGutter pattern); keyboard-driven
		     resize is a known gap, not a silent omission -->
		<div
			class="cb-sidebar-gutter"
			data-testid={testId + '-gutter'}
			role="separator"
			aria-orientation="vertical"
			aria-label={gutterLabel}
			onmousedown={(e) => onResizeStart?.(e)}
		></div>
	</div>
{/if}

<style>
	.cb-sidebar-stub {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		width: 34px;
		min-width: 34px;
		height: 100%;
		padding: 0.5rem 0;
		border: none;
		border-right: 1px solid var(--color-surface-border);
		color: var(--color-text-secondary);
		background: var(--color-surface-secondary);
		isolation: isolate;
	}
	/* SSC#1 structural contract (2026-11-14): skin and content are SEPARATE
	 * base-owned layers, so paint order is the DOM, not the consumer's
	 * positioning choices. The skin layer is an absolute, pointer-transparent
	 * underlay; the content layer is positioned and paints above by DOM
	 * order. A consumer cannot re-earn the buried-buttons bug (DSI's
	 * gradient once covered its static Restart/About buttons). */
	.cb-stub-skin {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.cb-stub-content {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
		min-height: 0;
		width: 100%;
	}
	.cb-sidebar-wrap {
		position: relative;
		display: flex;
		flex-shrink: 0;
		height: 100%;
		min-height: 0;
	}
	.cb-sidebar {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--color-surface-elevated);
	}
	.cb-sidebar-embedded {
		width: 100%;
	}
	.cb-sidebar-gutter {
		width: 6px;
		flex-shrink: 0;
		cursor: col-resize;
		transition: background-color 0.15s ease;
	}
	.cb-sidebar-gutter:hover {
		background: var(--color-accent-blue);
		opacity: 0.25;
	}
</style>

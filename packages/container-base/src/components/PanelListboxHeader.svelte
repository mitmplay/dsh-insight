<!--
	PanelListboxHeader — the listbox's header row (ADR-0070, R8, D3):
	chevron (right = collapsed, down = expanded, aria-expanded honest) +
	label area (props with English defaults; snippet passthrough for rich
	stems like DSI's Focused - <chip>) + trailing-actions snippet where the
	consumer injects its domain controls. Row layout: title flex-1,
	controls shrink-0.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		expanded = true,
		onToggle,
		label = 'Panels',
		children,
		search,
		trailing,
		testid = 'panel-listbox-header',
		toggleTestid = 'panel-listbox-header-toggle',
		controls,
		class: className = ''
	}: {
		expanded?: boolean;
		onToggle?: () => void;
		label?: string;
		children?: Snippet;
		/** R9 UX amendment: rendered INSIDE the title container after the
		 *  label — the search input owns the row's free width (title and
		 *  search share one container; trailing stays the icons/pills
		 *  cluster, operator feedback 2026-11-18). */
		search?: Snippet;
		trailing?: Snippet;
		testid?: string;
		toggleTestid?: string;
		controls?: string;
		class?: string;
	} = $props();
</script>

<div class="panel-listbox-header {className}" data-testid={testid}>
	<button
		type="button"
		class="lb-chevron"
		data-testid={toggleTestid}
		aria-expanded={expanded}
		aria-controls={controls}
		aria-label={label}
		title={label}
		onclick={() => onToggle?.()}
	>
		{#if expanded}
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M6 9l6 6 6-6" />
			</svg>
		{:else}
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M9 6l6 6-6 6" />
			</svg>
		{/if}
	</button>
	<div class="lb-title">
		{#if children}
			{@render children()}
		{:else}
			<span class="lb-label">{label}</span>
		{/if}
		{#if search}
			{@render search()}
		{/if}
	</div>
	{#if trailing}
		<div class="lb-trailing">
			{@render trailing()}
		</div>
	{/if}
</div>

<style>
	.panel-listbox-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		min-height: 28px;
	}
	.lb-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		background: none;
		color: var(--panel-listbox-header-fg);
		cursor: pointer;
		flex-shrink: 0;
	}
	.lb-title {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--panel-listbox-header-fg);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lb-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lb-trailing {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
</style>

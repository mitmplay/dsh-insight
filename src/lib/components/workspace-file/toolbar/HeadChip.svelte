<script lang="ts">
	/**
	 * HeadChip — the workspace-explorer hide/show toggle (2026-10-31):
	 * icon-only bordered chip; the glyph reflects the lane's visibility
	 * and the paraglide label rides aria-label + title.
	 */
	import { PanelLeftClose, PanelLeftOpen } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		/** The lane's current visibility — flips the glyph + label. */
		hidden = false,
		/** Toggle intent — flips the workspace-explorer tree lane. */
		ontoggle
	}: {
		hidden?: boolean;
		ontoggle: () => void;
	} = $props();
</script>

<button
	type="button"
	class="head-chip"
	data-testid="explorer-toggle"
	aria-label={hidden ? t(m.workspaceExplorerShow) : t(m.workspaceExplorerHide)}
	title={hidden ? t(m.workspaceExplorerShow) : t(m.workspaceExplorerHide)}
	onclick={ontoggle}
>
	{#if hidden}<PanelLeftOpen size={12} aria-hidden="true" />{:else}<PanelLeftClose size={12} aria-hidden="true" />{/if}
</button>

<style>
	.head-chip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
	}
	.head-chip:hover,
	.head-chip:focus-visible {
		background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
		color: var(--color-text-primary, #212529);
	}
</style>

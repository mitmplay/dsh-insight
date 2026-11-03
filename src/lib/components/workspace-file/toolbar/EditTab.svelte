<script lang="ts">
	/**
	 * EditTab — the source segment of the file toolbar's tab pair:
	 * icon-only (CodeXml glyph), the paraglide label rides
	 * aria-label + title so the accessible name survives.
	 */
	import { CodeXml } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		/** Whether this segment is the active tab. */
		active,
		/** Select intent — the owner flips its $bindable tab. */
		onselect
	}: {
		active: boolean;
		onselect: () => void;
	} = $props();
</script>

<button role="tab" aria-selected={active} class:active data-testid="tab-edit" aria-label={t(m.workspaceFileSource)} title={t(m.workspaceFileSource)} onclick={onselect}><CodeXml size={12} aria-hidden="true" /></button>

<style>
	button {
		height: 1.5rem;
		/* icon-only (2026-10-31): fixed square chip, centered glyph — same
		   bordered grammar as reload/capture beside it. */
		width: 1.5rem;
		justify-content: center;
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		padding: 0;
		font-size: 0.6875rem;
		cursor: pointer;
	}
	/* RCA fix B (2026-10-31): tint instead of solid fill — the glyph keeps
	   its dark ink on a soft accent wash, visible in BOTH states. */
	button.active {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, transparent);
		border-color: var(--color-accent-blue, #3b82f6);
		color: var(--color-accent-blue, #3b82f6);
	}
</style>

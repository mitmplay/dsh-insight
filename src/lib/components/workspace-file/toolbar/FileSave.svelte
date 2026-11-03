<script lang="ts">
	/**
	 * FileSave — The Single Edit (ADR D3): Save renders ONLY while a draft
	 * exists (the owner gates the mount). Icon-only (Save glyph); disabled
	 * while the delegated save is in flight.
	 */
	import { Save } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		/** The delegated save's progress — disables the verb while saving. */
		saving = false,
		/** Save intent — the panel POSTs the save. */
		onsave
	}: {
		saving?: boolean;
		onsave: () => void;
	} = $props();
</script>

<button
	type="button"
	class="head-chip save-btn"
	data-testid="file-save"
	aria-label={saving ? t(m.workspaceFileSaving) : t(m.workspaceFileSave)}
	title={saving ? t(m.workspaceFileSaving) : t(m.workspaceFileSave)}
	disabled={saving}
	onclick={onsave}
><Save size={12} aria-hidden="true" /></button>

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
	/* The class pair keeps the disabled rule scoped to Save alone. */
	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>

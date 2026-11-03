<script lang="ts">
	/**
	 * FileEdit — The Single Edit (ADR D2/D6): the mode verb. Icon-only
	 * (Pencil when idle, X while editing); the label rides aria-label +
	 * title and flips Edit -> Cancel with the mode.
	 */
	import { Pencil, UndoDot } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		/** The operator-facing edit mode — flips the glyph + label. */
		editing = false,
		/** Edit-mode intent — toggles the verb between Edit and Cancel. */
		ontoggledit
	}: {
		editing?: boolean;
		ontoggledit?: (next: boolean) => void;
	} = $props();
</script>

<button
	type="button"
	class="head-chip"
	data-testid="file-edit"
	aria-label={editing ? t(m.workspaceFileCancel) : t(m.workspaceFileEdit)}
	title={editing ? t(m.workspaceFileCancel) : t(m.workspaceFileEdit)}
	onclick={() => ontoggledit?.(!editing)}
>{#if editing}<UndoDot size={12} aria-hidden="true" />{:else}<Pencil size={12} aria-hidden="true" />{/if}</button>

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

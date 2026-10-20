<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * AttachmentChips (task 1.4) — the pending-draft shelf. Pure
	 * presentation: one chip per draft rendered above the input row. All
	 * lifecycle stays in the AttachmentManager's service — removal leaves
	 * as an id callback.
	 *
	 * DSH rail parity (2026-08-28, ui-attachment AttachmentRail): the
	 * chip IS the draft image — a 62×62 rounded card, no name/size
	 * labels (the file name survives as the img alt / lightbox alt) —
	 * with a zoom-in cursor and a "Show original" tooltip; a single
	 * click opens the ORIGINAL image in the ImageLightbox
	 * (document-level — the floor's zoom transform would trap a fixed
	 * backdrop); the remove control sits INSIDE the card's top-right
	 * corner and reveals on hover/focus, staying always visible on
	 * coarse pointers (touch has no hover).
	 */
	import type { AttachmentDraft } from '$lib/services/chat/attachment-service.svelte';
	import ImageLightbox from './ImageLightbox.svelte';

	let {
		drafts = [],
		onremove = () => {}
	}: {
		drafts?: AttachmentDraft[];
		/** Remove one draft by id (chips never remove by index). */
		onremove?: (id: string) => void;
	} = $props();

	/** The lightbox's open image; null = closed. */
	let previewing = $state<{ src: string; alt: string } | null>(null);
</script>

{#if drafts.length > 0}
	<div class="flex flex-wrap gap-1.5" data-testid="attachment-chips" role="list" aria-label={t(m.pendingAttachments)}>
		{#each drafts as draft (draft.id)}
			<div class="group relative" role="listitem" data-testid="attachment-chip">
				<button
					type="button"
					class="block h-[62px] w-[62px] cursor-zoom-in overflow-hidden rounded-[16px] border border-surface-border bg-surface-elevated"
					title="Show original"
					data-testid="attachment-chip-open"
					onclick={() => (previewing = { src: draft.previewUrl, alt: draft.file.name || 'image draft' })}
				>
					<img
						src={draft.previewUrl}
						alt={draft.file.name || 'image draft'}
						class="h-full w-full object-cover"
						data-testid="attachment-chip-thumb"
					/>
				</button>
				<button
					type="button"
					onclick={() => onremove(draft.id)}
					aria-label="Remove attachment {draft.file.name || 'image'}"
					data-testid="attachment-chip-remove"
					class="pointer-coarse:opacity-100 absolute top-1 right-1 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-slate-800/90 text-[10px] leading-none text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
				>×</button>
			</div>
		{/each}
	</div>
{/if}

{#if previewing}
	<ImageLightbox src={previewing.src} alt={previewing.alt} onclose={() => (previewing = null)} />
{/if}

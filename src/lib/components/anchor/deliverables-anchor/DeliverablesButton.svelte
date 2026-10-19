<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { Package } from '@lucide/svelte';
	import DeliverablesPopup from './DeliverablesPopup.svelte';
	import type { PresentedDelivery } from '$lib/services/conversation/deliverables';

	/**
	 * DeliverablesButton — the Deliverables leaf of the floating anchor
	 * stack (ADR-0027f, D2): the session's presented-file inventory as
	 * one click, beside the transcript. Behaves like PlanButton: the
	 * button owns its popup's open state and the trigger element while
	 * DeliverablesPopup renders the rows — the wrapper div is the
	 * popup's triggerEl, and the opening click bubbles to the window
	 * outside-click handler without closing what it just opened.
	 *
	 * Renders NOTHING while the inventory is empty (null/[] — no present
	 * ever landed; omit, never approximate). Tone CSS is OCI's verbatim
	 * pattern (scoped style, var + fallback) — teal marks the hand-off
	 * family (files the agent gave you).
	 */
	let {
		deliveries,
		onfileopen
	}: {
		/** The session's present events in ledger order; empty renders nothing. */
		deliveries: PresentedDelivery[] | null | undefined;
		/** The page's file-open seat (ADR-0013 D5) — row clicks jump. */
		onfileopen?: (path: string) => void;
	} = $props();

	/** Popup open state — the active tone mirrors it on the button. */
	let open = $state(false);
	/** The popup's trigger exclusion element (the wrapper div). */
	let triggerEl: HTMLElement | undefined = $state(undefined);

	/** Null-safe list — the render gate reads this, never the raw prop. */
	const items = $derived(deliveries ?? []);
	const fileCount = $derived(items.reduce((n, d) => n + d.files.length, 0));
</script>

{#if items.length > 0}
	<div class="relative" bind:this={triggerEl}>
		<button
			type="button"
			class="floating-anchor-btn tone-teal"
			class:active={open}
			title={t(m.deliverablesTitle) + fileCount + t(m.deliverablesFiles)}
			data-testid="deliverables-button"
			onclick={() => (open = !open)}
		>
			<Package size={14} />
		</button>
		<DeliverablesPopup deliveries={items} {triggerEl} bind:open={open} onopen={onfileopen} />
	</div>
{/if}

<style>
	.floating-anchor-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: background 0.15s, color 0.15s, transform 0.1s;
		pointer-events: auto;
	}

	.floating-anchor-btn:hover {
		transform: scale(1.08);
	}

	/* Teal tone — the deliverables hand-off family */
	.tone-teal {
		border: 1px solid var(--color-accent-teal, #14b8a6);
		background: color-mix(in srgb, var(--color-accent-teal, #14b8a6) 12%, transparent);
		color: var(--color-accent-teal, #14b8a6);
	}

	.tone-teal:hover {
		color: var(--color-text-primary, var(--color-surface-elevated));
	}

	.tone-teal.active {
		background: var(--color-accent-teal, #14b8a6);
		color: white;
		border-color: var(--color-accent-teal, #14b8a6);
	}

	/* Icon inherits button color */
	.floating-anchor-btn :global(svg) {
		color: inherit;
	}
</style>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { ListChecks } from '@lucide/svelte';
	import type { TodoItem } from '$lib/utils/todo-lists';
	import PlanPopup from './PlanPopup.svelte';

	/**
	 * PlanButton — the Current Plan leaf of the floating anchor stack
	 * (2026-08-31): the host's LIVE todos projection (the agent's standing
	 * plan) as one click, beside the transcript. Behaves like
	 * UserMessagesButton: the button owns its popup's open state and the
	 * trigger element while PlanPopup (extracted 2026-09-01, jumper
	 * pattern) renders the readout — the wrapper div is the popup's
	 * triggerEl — the opening click bubbles to the window outside-click
	 * handler and must not close what it just opened.
	 *
	 * The popup is the progress readout (tri-state glyphs + done/total
	 * header), mirroring TodoCard's glyph grammar. Renders NOTHING while
	 * there is no current plan (the projection is null/empty —
	 * pre-first-write or cleared by the next turn/start).
	 *
	 * Tone CSS is OCI's verbatim pattern (scoped style, var + fallback) —
	 * accent-purple matches TodoCard's plan chrome.
	 */
	let { todos }: { todos: TodoItem[] | null | undefined } = $props();

	/** Popup open state — the active tone mirrors it on the button. */
	let open = $state(false);
	/** The popup's trigger exclusion element (the wrapper div). */
	let triggerEl: HTMLElement | undefined = $state(undefined);

	/** Null-safe items — the render gate reads this, never the raw prop. */
	const items = $derived(todos ?? []);
	const done = $derived(items.filter((t) => t.status === 'completed').length);
</script>

{#if items.length > 0}
	<div class="relative" bind:this={triggerEl}>
		<button
			type="button"
			class="floating-anchor-btn tone-purple"
			class:active={open}
			title={t(m.currentPlan) + done + '/' + items.length + t(m.donePart)}
			data-testid="plan-button"
			onclick={() => (open = !open)}
		>
			<ListChecks size={14} />
		</button>
		<PlanPopup {items} {triggerEl} bind:open={open} />
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

	/* Purple tone — the current plan (matches TodoCard's chrome) */
	.tone-purple {
		border: 1px solid var(--color-accent-purple, #a855f7);
		background: color-mix(in srgb, var(--color-accent-purple, #a855f7) 12%, transparent);
		color: var(--color-accent-purple, #a855f7);
	}

	.tone-purple:hover {
		color: var(--color-text-primary, var(--color-surface-elevated));
	}

	.tone-purple.active {
		background: var(--color-accent-purple, #a855f7);
		color: white;
		border-color: var(--color-accent-purple, #a855f7);
	}

	/* Icon inherits button color */
	.floating-anchor-btn :global(svg) {
		color: inherit;
	}
</style>

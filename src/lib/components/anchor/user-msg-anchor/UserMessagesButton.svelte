<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { MessageSquareText } from '@lucide/svelte';
	import { groupTurns } from '$lib/utils/turn-grouping';
	import UserMessageJumper from './UserMessageJumper.svelte';

	/**
	 * UserMessagesButton — the User Messages leaf of the floating anchor
	 * stack (self-contained since 2026-08-26; absorbed FloatingAnchorButton,
	 * a generic tone/snippet primitive that had exactly one caller — this
	 * button — and a name that lied about its purpose): the cyan
	 * MessageSquareText button AND its popup jumper as one unit, owning
	 * the popup's open state and the trigger element. The wrapper div is
	 * the jumper's triggerEl — the opening click bubbles to the window
	 * outside-click handler and must not close what it just opened.
	 *
	 * Renders NOTHING while the conversation has no prompt groups or no
	 * scroll container — the jumper would have nothing to list (the gate
	 * moved in with the button).
	 *
	 * Tone CSS is OCI's verbatim (scoped style, var + fallback) — NOT
	 * Tailwind opacity utilities: DSI's theme defines no accent-cyan
	 * token, so `bg-accent-cyan/10` would silently generate nothing and
	 * the button would lose its tone entirely.
	 */
	let {
		groups,
		container
	}: {
		/** Derived turn groups — the jumper lists their prompt rows. */
		groups: ReturnType<typeof groupTurns>;
		/** The transcript scroll element (bindable through from the page). */
		container: HTMLElement | undefined;
	} = $props();

	/** Popup open state — the active tone mirrors it on the button. */
	let open = $state(false);
	/** The jumper's trigger exclusion element (the wrapper div). */
	let triggerEl: HTMLElement | undefined = $state(undefined);
</script>

{#if container !== undefined && groups.some((g) => g.kind === 'prompt')}
	<div class="relative" bind:this={triggerEl}>
		<button
			type="button"
			class="floating-anchor-btn tone-cyan"
			class:active={open}
			title={t(m.userMessagesTitle)}
			data-testid="user-messages-button"
			onclick={() => (open = !open)}
		>
			<MessageSquareText size={14} />
		</button>
		<UserMessageJumper {groups} {container} {triggerEl} bind:open={open} />
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

	/* Cyan tone — user messages (OCI parity) */
	.tone-cyan {
		border: 1px solid var(--color-accent-cyan, #06b6d4);
		background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 12%, transparent);
		color: var(--color-accent-cyan, #06b6d4);
	}

	.tone-cyan:hover {
		color: var(--color-text-primary, var(--color-surface-elevated));
	}

	.tone-cyan.active {
		background: var(--color-accent-cyan, #06b6d4);
		color: white;
		border-color: var(--color-accent-cyan, #06b6d4);
	}

	/* Icon inherits button color */
	.floating-anchor-btn :global(svg) {
		color: inherit;
	}
</style>

<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { FileText } from '@lucide/svelte';
	import { injectedShelfFor } from '$lib/services/conversation/injected-shelf';
	import { executeCommand } from '$lib/services/chat/command-executor';
	import { loadinjectedCommand } from '$lib/services/chat/command-parser';
	import type { DsiEntry } from '$lib/types';
	import InjectedShelfPopup from './InjectedShelfPopup.svelte';

	/**
	 * InjectedShelfButton — the FloatingAnchor's Injected leaf (The
	 * Loadinjected ADR D6): lists the conversation's injected documents in
	 * the operator's order (system-prompt first, then instructions by first
	 * injection) and opens one through the SAME parser→executor path the
	 * composer command takes — placement, lineage, and dedupe have exactly
	 * one implementation. It NEVER calls the floor registry directly (D6's
	 * rejected alternative: a second write path to the floor).
	 *
	 * The rows live in InjectedShelfPopup since 2026-10-18 (extracted on
	 * the PlanPopup pattern); hosting stays in FloatingAnchorContainerPopup
	 * (The Popup Shell ADR D1/D2): placement, pointer re-entry, and the
	 * close contract (Escape or a trusted outside click; the trigger
	 * exempt) are the container's. The popup is titled (user decision
	 * 2026-09-08, amending the ADR's D3 default): "Injected files: (n)".
	 *
	 * Renders NOTHING when the shelf is empty — the gate moved in with the
	 * button (the UserMessagesButton shape: self-contained with its popup).
	 */
	let {
		entries,
		sessionId,
		workspace = null,
		panelId = null,
		onnote
	}: {
		/** The conversation's dispatched entries — the shelf derives live. */
		entries: readonly DsiEntry[];
		/** The conversation the documents belong to (the dedupe pair's source half). */
		sessionId: string;
		/** The session workspace cwd — joins a member's relative display path
		 *  into the terminal-reachable FULL path (Loadinjected D6/D7). */
		workspace?: string | null;
		/** The owning floor panel — null outside a floor (the executor's honest no). */
		panelId?: string | null;
		/** Note sink — the executor's honest usage/no-match notes land here. */
		onnote?: (ok: boolean, note: string) => void;
	} = $props();

	/** Popup open state — the active tone mirrors it on the button. */
	let open = $state(false);
	/** The popup's trigger exclusion element (the wrapper div). */
	let triggerEl: HTMLElement | undefined = $state(undefined);

	const members = $derived(injectedShelfFor(entries));

	/** The D6 pick (amended 2026-09-17, The Retired Typed Command ADR
	 *  D3): the SAME executor path, composed through the parser's
	 *  constructor — the typed string is retired grammar the button must
	 *  never re-assemble. */
	function pick(displayPath: string): void {
		open = false;
		const parsed = loadinjectedCommand(displayPath, { add: true });
		void executeCommand(
			parsed,
			{ sessionId, workspace: null, agent: null, panelId, entries },
			onnote
		);
	}
</script>

{#if members.length > 0}
	<div class="relative" bind:this={triggerEl}>
		<button
			type="button"
			class="floating-anchor-btn tone-maroon"
			class:active={open}
			title={t(m.injectedTitle)}
			data-testid="injected-shelf-button"
			onclick={() => (open = !open)}
		>
			<FileText size={14} />
		</button>
		<InjectedShelfPopup {members} {entries} {workspace} {triggerEl} bind:open onpick={pick} />
	</div>
{/if}

<style>
	.relative {
		position: relative;
	}

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

	/* Maroon tone — the document-child paint (DOC_CHILD_PAINT var(--color-doc-child), ADR
	   D3): the button and the sidebar rows speak the same vocabulary. */
	.tone-maroon {
		border: 1px solid var(--color-doc-child);
		background: color-mix(in srgb, var(--color-doc-child) 12%, transparent);
		color: var(--color-doc-child);
	}

	.tone-maroon:hover {
		color: var(--color-text-primary, var(--color-surface-elevated));
	}

	.tone-maroon.active {
		background: var(--color-doc-child);
		color: white;
		border-color: var(--color-doc-child);
	}

	.floating-anchor-btn :global(svg) {
		color: inherit;
	}
</style>

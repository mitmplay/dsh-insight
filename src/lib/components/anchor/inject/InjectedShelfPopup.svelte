<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';
	import { injectedFullPath, injectedRecordFor } from '$lib/services/conversation/injected-shelf';
	import type { DsiEntry } from '$lib/types';
	import type { InjectedShelfMember } from '$lib/services/conversation/injected-shelf';

	/**
	 * InjectedShelfPopup — the Injected leaf's row list (extracted from
	 * InjectedShelfButton, 2026-10-18, on the PlanPopup pattern): the
	 * shelf members in the operator's order, each with its prefix copy
	 * affordance and pick target, under the "Injected files: (n)" header.
	 *
	 * Hosting lives in FloatingAnchorContainerPopup (The Popup Shell ADR
	 * D1/D2): placement, pointer re-entry, and the close contract
	 * (Escape or a trusted outside click; the trigger exempt) are the
	 * container's — this leaf renders ONLY the rows (copy affordance,
	 * pick, first-load divider). The pick is the host's: the button owns
	 * the SAME parser→executor path the composer command takes (The
	 * Loadinjected ADR D6), so this popup never touches the executor.
	 */
	let {
		members,
		entries,
		workspace = null,
		triggerEl,
		open = $bindable(false),
		onpick
	}: {
		/** The shelf members in the operator's order (derived upstream). */
		members: InjectedShelfMember[];
		/** The conversation's dispatched entries — copy resolves the system-prompt text. */
		entries: readonly DsiEntry[];
		/** The session workspace cwd — joins a member's relative display path
		 *  into the terminal-reachable FULL path (Loadinjected D6/D7). */
		workspace?: string | null;
		/** The toggle button's wrapper — the container's close-contract exclusion. */
		triggerEl: HTMLElement | undefined;
		/** Popup open state — bindable, host owns the toggle button. */
		open: boolean;
		/** The pick — the host's parser→executor path; the popup closes itself first. */
		onpick: (displayPath: string) => void;
	} = $props();
</script>

<FloatingAnchorContainerPopup
	bind:open
	{triggerEl}
	title={t(() => m.injectedFiles({ n: members.length }))}
	titleTestId="injected-shelf-popup-header"
	popupTestId="injected-shelf-popup"
>
	{#each members as m, i (m.displayPath)}
		{#if i > 0 && members[i - 1].firstLoad === true && m.firstLoad === false}
			<!-- The FIRST-LOAD boundary: everything above arrived in the
			     session's baseline (system prompt + baseline
			     instructions); everything below was injected LATER as
			     the session touched new scopes. -->
			<hr class="shelf-divider" data-testid="shelf-first-load-divider" />
		{/if}
		<div class="shelf-item" data-testid="injected-shelf-item" data-display-path={m.displayPath}>
			<!-- Prefix copy affordance. HONEST per kind (D7): a real
			     file copies the terminal-reachable FULL path (workspace
			     joined); the synthetic system-prompt member is NOT a
			     file — it copies the logged PROMPT TEXT instead, and the
			     tooltip says so. CopyButton stops propagation, so
			     copying never picks. -->
			<CopyButton
				value={m.origin === 'system-prompt'
					? (injectedRecordFor(entries, m.displayPath)?.text ?? m.displayPath)
					: injectedFullPath(workspace, m.displayPath)}
				title={m.origin === 'system-prompt'
					? 'Copy prompt text — a shelf name, not a file'
					: 'Copy full path'}
				class="shelf-copy"
			/>
			<button
				type="button"
				role="menuitem"
				class="shelf-pick"
				data-testid="injected-shelf-pick"
				title={m.displayPath}
				onclick={() => onpick(m.displayPath)}
			>
				<!-- The FULL display path is the label, unconditionally: five
				     files can share one basename (five AGENTS.md files is a
				     real desk), and a basename-only list reads as five
				     duplicates — the operator cannot pick the right file. -->
				<span class="shelf-pick-path">{m.displayPath}</span>
			</button>
		</div>
	{/each}
</FloatingAnchorContainerPopup>

<style>
	.shelf-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
	}

	.shelf-item:hover {
		background: color-mix(in srgb, var(--color-doc-child) 8%, transparent);
	}

	/* The origin boundary (D6/D7): the system-prompt shelf name is a
	   different KIND of member than the injected files — the divider makes
	   the two families legible at a glance. */
	.shelf-divider {
		width: 100%;
		margin: 0.125rem 0;
		border: none;
		border-top: 1px solid var(--color-surface-border, #dee2e6);
	}

	/* The prefix copy affordance — same mini-button grammar as the row
	   buttons: quiet by default, the Copy icon turns into the green Check
	   for 2s after a copy (CopyButton's own feedback). :global — the button
	   element belongs to CopyButton's component scope; the local .shelf-item
	   ancestor anchors the override (the WorkspaceRowItem :global(.label)
	   precedent). */
	.shelf-item :global(.shelf-copy) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		opacity: 0.6;
		cursor: pointer;
	}

	.shelf-item :global(.shelf-copy:hover) {
		opacity: 1;
		background: var(--color-surface-hover, rgb(0 0 0 / 0.1));
	}

	/* The pick target fills the rest of the row — clicking anywhere on the
	   path opens the document. The FULL display path IS the label
	   (basename-first read as five duplicates on a multi-AGENTS desk).
	   Long paths ellipsize; the full text stays in the button's title. */
	.shelf-pick {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0.25rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		font-size: 0.75rem;
	}

	.shelf-pick:hover {
		background: color-mix(in srgb, var(--color-doc-child) 8%, transparent);
	}

	.shelf-pick-path {
		min-width: 0;
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
</style>

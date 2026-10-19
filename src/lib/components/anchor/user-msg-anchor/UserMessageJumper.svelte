<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { TurnGroup } from '$lib/utils/turn-grouping';
	import { relativeTime } from '$lib/utils/time';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';

	/**
	 * UserMessageJumper — popup listing the session's HUMAN prompts for
	 * one-click jump-to-message (OCI UserMessageJumper port, 2026-08-23).
	 * Rendered inside a relatively-positioned wrapper beside its
	 * UserMessagesButton.
	 *
	 * Hosting lives in FloatingAnchorContainerPopup since 2026-09-08 (The
	 * Popup Shell ADR D1/D2): placement, width cap, and the close contract
	 * (Escape or a trusted outside click; the trigger exempt) are the
	 * container's — this leaf renders ONLY the rows, and hands focus back
	 * to the box after a jump through the container's exported focus().
	 *
	 * Identification contract (the reason this port exists): rows anchor
	 * by the prompt group's KEY — the user-message entry id (`u:<wire-id>`
	 * or `u:seq:<n>`), unique per session by construction — rendered as
	 * data-group-key on the page's group wrapper. A content id, not a
	 * positional index: the jump survives load-older prepends (older
	 * history shifts indexes but never ids), and the DOM query is scoped
	 * to the transcript viewport — never the document — so sibling
	 * surfaces cannot collide.
	 *
	 * Listing rule: group.kind === 'prompt' only — harness context
	 * injections (context groups / merged context chips) are not human
	 * prompts and stay out of the list.
	 */
	let {
		groups,
		container,
		triggerEl,
		open = $bindable(false)
	}: {
		/** The page's turn groups (groupTurns output) — prompt groups listed. */
		groups: TurnGroup[];
		/** Transcript scroll container (the page's <main>) — jump scope. */
		container: HTMLElement | undefined;
		/** The toggle button's wrapper — the container's close-contract exclusion. */
		triggerEl: HTMLElement | undefined;
		/** Popup open state — bindable, host owns the toggle button. */
		open: boolean;
	} = $props();

	/** Human prompts in wire order: prompt groups only (see contract). */
	const prompts = $derived(
		groups.filter((g): g is Extract<TurnGroup, { kind: 'prompt' }> => g.kind === 'prompt')
	);

	let shell: { focus: () => void } | undefined = $state();

	/** Center one group in the viewport (OCI centering math, scoped). */
	function scrollToGroup(key: string): void {
		if (!container) return;
		const el = container.querySelector(`[data-group-key="${cssEscape(key)}"]`) as HTMLElement | null;
		if (!el) return;
		const elRect = el.getBoundingClientRect();
		const cRect = container.getBoundingClientRect();
		const offset =
			elRect.top - cRect.top + container.scrollTop - (container.clientHeight - elRect.height) / 2;
		container.scrollTo({ top: offset, behavior: 'smooth' });
		// Jump never closes the popup — refocus so wheel/keys stay trapped.
		shell?.focus();
	}

	/** ids contain ':' (u:seq:12) — escape for the attribute selector. */
	function cssEscape(v: string): string {
		return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v;
	}

	function truncate(text: string, max = 60): string {
		return text.length <= max ? text : text.slice(0, max) + '…';
	}
</script>

<FloatingAnchorContainerPopup
	bind:this={shell}
	{open}
	{triggerEl}
	title="{t(m.userMessages)}{prompts.length})"
	titleTestId="user-message-jumper-header"
	popupTestId="user-message-jumper"
>
	{#each prompts as group (group.key)}
		<button
			type="button"
			class="w-full cursor-pointer border-b border-surface-border/30 px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-hover"
			data-testid="user-message-jumper-row"
			onclick={() => scrollToGroup(group.key)}
		>
			<div class="truncate text-xs text-text-primary">{truncate(group.entry.text)}</div>
			<div class="mt-0.5 text-[10px] text-text-muted" title={new Date(group.entry.time).toISOString()}>
				{relativeTime(group.entry.time)}
			</div>
		</button>
	{/each}
</FloatingAnchorContainerPopup>

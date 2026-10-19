<script lang="ts">
	import type { Snippet } from 'svelte';
	import { capToPanelColumn } from '$lib/utils/column-width-cap';

	/**
	 * FloatingAnchorContainerPopup — the FloatingAnchor's popup shell (The
	 * Popup Shell ADR D1): the ONE container for the anchor's item-list
	 * popups. It owns the hosting half of the popup job — placement
	 * (absolute right-full, vertically centered against the trigger's
	 * relative wrapper), pointer-events re-entry (the anchor column itself
	 * is pointer-events-none), the panel-column width cap, the close
	 * contract (Escape or a TRUSTED click outside closes; the popup and
	 * the toggle's triggerEl never close it — the opening click bubbles to
	 * the window handler and must not close what it just opened), and the
	 * optional title header row. The listing half — the rows — stays in
	 * the leaf via the default snippet (ADR D4). NO portal (ADR D5): the
	 * box renders inside the trigger's wrapper so floor-panel zoom and
	 * per-panel anchoring stay honest.
	 *
	 * `titleTestId` exists because the header's data-testid is part of
	 * each leaf's pinned surface (plan-popup-header, user-message-jumper-header).
	 */
	let {
		open = $bindable(false),
		triggerEl = undefined,
		title = undefined,
		titleTestId = undefined,
		popupTestId = 'floating-anchor-popup',
		fitWidth = false,
		children
	}: {
		/** Popup open state — bindable, the leaf owns the toggle button. */
		open?: boolean;
		/** The toggle button's wrapper — clicks inside it OPEN the popup and
		 *  must never close it (see the close contract above). */
		triggerEl?: HTMLElement | undefined;
		/** Header text — omitted renders no header row (the shelf, ADR D3). */
		title?: string | undefined;
		/** The header row's data-testid — leaf-pinned when the leaf has one. */
		titleTestId?: string | undefined;
		/** The box's data-testid — leaf-pinned surface (plan-popup,
		 *  user-message-jumper, injected-shelf-popup); default is the
		 *  container's own id for leaf-less hosts. */
		popupTestId?: string | undefined;
		/** Shrink the box to its content instead of the fixed w-96 one-liner
		 *  inventory leaves (ADR-0027f, 2026-10-19) — the 80vw cap stays. */
		fitWidth?: boolean;
		/** The leaf's item list. */
		children: Snippet;
	} = $props();

	let popupEl: HTMLDivElement | undefined = $state();

	// Width cap: 80% of the panel column on the floor (inline style),
	// 80vw standalone — see util. (The twin popups' former behavior.)
	$effect(() => {
		if (!popupEl) return;
		return capToPanelColumn(popupEl);
	});

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			open = false;
		}
	}

	function handleClickOutside(e: MouseEvent): void {
		if (!open || !e.isTrusted) return; // synthetic clicks (tests) never close
		const target = e.target as Node;
		if (popupEl?.contains(target)) return; // inside the popup
		if (triggerEl?.contains(target)) return; // the toggle that OPENED it
		open = false;
	}

	/** Focus the box — leaves call it through bind:this when an action
	 *  must hand focus back (the jumper's stay-open jump). */
	export function focus(): void {
		popupEl?.focus();
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#if open}
	<div
		bind:this={popupEl}
		tabindex="-1"
		class="pointer-events-auto absolute right-full top-1/2 z-50 mr-2 max-h-[60vh] max-w-[80vw] -translate-y-1/2 overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated py-1 shadow-xl outline-none focus:outline-none {fitWidth
			? 'w-fit'
			: 'w-96'}"
		data-testid={popupTestId}
	>
		{#if title !== undefined}
			<div
				class="border-b border-surface-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted"
				data-testid={titleTestId}
			>
				{title}
			</div>
		{/if}
		{@render children()}
	</div>
{/if}

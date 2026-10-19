<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';
	import type { TodoItem } from '$lib/utils/todo-lists';

	/**
	 * PlanPopup — the Current Plan readout (extracted from PlanButton,
	 * 2026-09-01, on the UserMessageJumper pattern): the live todos
	 * projection as one tri-state row list (● done / ◐ in progress /
	 * ○ pending) under a done/total header, mirroring TodoCard's glyph
	 * grammar.
	 *
	 * Hosting lives in FloatingAnchorContainerPopup since 2026-09-08 (The
	 * Popup Shell ADR D1/D2): placement, width cap, and the close contract
	 * (Escape or a trusted outside click; the trigger exempt) are the
	 * container's — this leaf renders ONLY the rows. Unlike the jumper's
	 * rows, these carry no action: the popup is the progress readout.
	 */
	let {
		items,
		triggerEl,
		open = $bindable(false)
	}: {
		/** The session's todo items in plan order (null-safe gate upstream). */
		items: TodoItem[];
		/** The toggle button's wrapper — the container's close-contract exclusion. */
		triggerEl: HTMLElement | undefined;
		/** Popup open state — bindable, host owns the toggle button. */
		open: boolean;
	} = $props();

	const done = $derived(items.filter((t) => t.status === 'completed').length);

	function glyph(status: TodoItem['status']): string {
		if (status === 'completed') return '●';
		if (status === 'in_progress') return '◐';
		return '○';
	}

	function glyphClass(status: TodoItem['status']): string {
		if (status === 'completed') return 'text-status-pass';
		if (status === 'in_progress') return 'text-accent-purple';
		return 'text-text-muted';
	}
</script>

<FloatingAnchorContainerPopup
	{open}
	{triggerEl}
	title="{t(m.currentPlan)}{done}/{items.length}{t(m.donePart)}"
	titleTestId="plan-popup-header"
	popupTestId="plan-popup"
>
	{#each items as item, i (i)}
		<div
			class="flex items-start gap-2 border-b border-surface-border/30 px-2.5 py-2 text-xs last:border-b-0"
			data-testid="plan-popup-row"
			data-status={item.status}
		>
			<span class="shrink-0 {glyphClass(item.status)}" aria-hidden="true">{glyph(item.status)}</span>
			<span
				class="min-w-0 break-words {item.status === 'completed'
					? 'text-text-muted line-through'
					: 'text-text-primary'}"
				>{item.content}</span
			>
		</div>
	{/each}
</FloatingAnchorContainerPopup>

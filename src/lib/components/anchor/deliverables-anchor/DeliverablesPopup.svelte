<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import type { PresentedDelivery } from '$lib/services/conversation/deliverables';

	/**
	 * DeliverablesPopup — the session's presented-file inventory
	 * (ADR-0027f, D3, row format amended 2026-10-19): ONE line per file
	 * across every present event, newest turn last — the description is
	 * the label (active foreground), falling back to the bare filename
	 * when the model supplied none; the full path rides the hover title
	 * and the row's CopyButton, never the visible line. Extracted from
	 * DeliverablesButton on
	 * the PlanPopup pattern (content vs chrome): hosting lives in
	 * FloatingAnchorContainerPopup (placement, width cap, close
	 * contract); this leaf renders ONLY the rows. A row click opens the
	 * file through the transcript's file-open seat — the popup is an
	 * inventory with a jump, never a copy (the ledger's path is truth).
	 */
	let {
		deliveries,
		triggerEl,
		open = $bindable(false),
		onopen
	}: {
		/** The session's present events in ledger order (newest last). */
		deliveries: PresentedDelivery[];
		/** The toggle button's wrapper — the container's close-contract exclusion. */
		triggerEl: HTMLElement | undefined;
		/** Popup open state — bindable, host owns the toggle button. */
		open: boolean;
		/** The page's file-open seat (ADR-0013 D5) — row clicks jump. */
		onopen?: (path: string) => void;
	} = $props();

	const fileCount = $derived(deliveries.reduce((n, d) => n + d.files.length, 0));

	/** The row's label: bare filename, extension stripped (ADR-0027f
	 *  D3 amendment 2026-10-19 — the full path rides the hover title
	 *  and the row's CopyButton, never the visible line). */
	function displayName(path: string): string {
		const base = path.split('/').pop() ?? path;
		const dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(0, dot) : base;
	}
</script>

<FloatingAnchorContainerPopup
	{open}
	{triggerEl}
	fitWidth
	title="{t(m.deliverablesTitle)}{fileCount}{t(m.deliverablesFiles)}"
	titleTestId="deliverables-popup-header"
	popupTestId="deliverables-popup"
>
	{#each deliveries as delivery (delivery.callId)}
		{#each delivery.files as file (file.path)}
			<button
				type="button"
				class="flex w-full items-center gap-1.5 border-b border-surface-border/30 px-2 py-1 text-left text-xs last:border-b-0 hover:bg-surface-border/20"
				data-testid="deliverables-popup-row"
				data-turn={delivery.turn}
				title={file.path}
				onclick={() => onopen?.(file.path)}
			>
				<CopyButton
					value={file.path}
					title={t(m.copyFullPath)}
					size={10}
					class="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text-secondary"
				/>
				<span class="min-w-0 flex-1 truncate text-text-primary">{file.description ?? displayName(file.path)}</span>
			</button>
		{/each}
	{/each}
</FloatingAnchorContainerPopup>

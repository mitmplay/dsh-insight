<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';

	/**
	 * RowButtonClose â the panel row's close X (extracted from
	 * SidebarOpenPanels, 2026-08-27): removes the row's panel from
	 * the floor (workspace context state write, root-owned â never a
	 * registry action). The host owns WHAT closing means; this button
	 * only stops the row's select click and fires `onclose`.
	 *
	 * FRAGMENT BY DESIGN: the button IS the root and ships no styles
	 * here — the host's :global `.row-btn` rules (base, paneled
	 * violet, dead red) reach it under the local row ancestors.
	 */
	let {
		label,
		onclose
	}: {
		/** The aria-label's subject â session title ?? sessionId (the row-label grammar). */
		label: string;
		/** Close invocation â the host closes the panel. */
		onclose: () => void;
	} = $props();
</script>

<button
	type="button"
	class="row-btn close"
	data-testid="sidebar-panel-close"
	aria-label="{t(m.closePanel)} {label}"
	title={t(m.closePanel)}
	onclick={(e) => {
		e.stopPropagation();
		onclose();
	}}
>
	<X size={12} aria-hidden="true" />
</button>

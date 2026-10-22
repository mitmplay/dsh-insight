<!--
	PanelClose — the panel column header's close button, extracted from
	PanelHeader. Presentational: reports upward via onremove (the Shift
	flag rides along — the subtree rule opts out). Lens mode renders it
	visible-disabled (The Panel Loupe ADR D8 — floor-identity verbs go
	inert; order/membership live on the column).
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { X } from '@lucide/svelte';

	let {
		/** Session id — names the panel in the accessible label. */
		sessionId,
		/** True in lens mode: visible-disabled regardless of onremove. */
		lens = false,
		/** Close reports upward; Shift+Click opts out of the subtree rule. */
		onremove
	}: {
		sessionId: string;
		lens?: boolean;
		onremove?: (detail: { shiftKey: boolean }) => void;
	} = $props();
</script>

<button
	type="button"
	class="hdr-btn"
	disabled={lens}
	data-testid="panel-close"
	aria-label={t(() => m.closePanelNamed({ id: sessionId }))}
	title={t(m.closePanelHint)}
	onclick={(e) => onremove?.({ shiftKey: e.shiftKey })}
>
	<X size={12} aria-hidden="true" />
</button>

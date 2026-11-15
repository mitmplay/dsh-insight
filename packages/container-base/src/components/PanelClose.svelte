<!--
	PanelClose — the panel column header's close button, promoted into
	container-base (ADR-0066, R6). Presentational: reports upward via
	onremove (the Shift flag rides along). Lens mode renders it
	visible-disabled. De-DSI'd per the base-never-translates law: the
	accessible label and hint arrive as PROPS with English defaults —
	translating consumers pass their own strings; the package carries no
	translation machinery and no app path aliases.
-->
<script lang="ts">

	let {
		/** Session id — the consumer's context for the panel being closed.
		 *  The base never translates (ADR-0063), so this is carried, not
		 *  spoken: pass the full spoken label via closeLabel. */
		sessionId,
		/** True in lens mode: visible-disabled regardless of onremove. */
		lens = false,
		/** Close reports upward; Shift+Click opts out of the subtree rule. */
		onremove,
		/** Accessible label — translating consumers pass their own. */
		closeLabel = 'Close panel',
		/** Tooltip hint — translating consumers pass their own. */
		closeHint = 'Close panel'
	}: {
		sessionId: string;
		lens?: boolean;
		onremove?: (detail: { shiftKey: boolean }) => void;
		closeLabel?: string;
		closeHint?: string;
	} = $props();
</script>

<button
	type="button"
	class="hdr-btn"
	disabled={lens}
	data-testid="panel-close"
	aria-label={sessionId ? `${closeLabel} ${sessionId}` : closeLabel}
	title={closeHint}
	onclick={(e) => onremove?.({ shiftKey: e.shiftKey })}
>
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M18 6 6 18" />
		<path d="m6 6 12 12" />
	</svg>
</button>

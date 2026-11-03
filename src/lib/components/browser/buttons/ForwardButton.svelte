<script lang="ts">
	/**
	 * ForwardButton — the nav → glyph (extracted from BrowserHeader
	 * 2026-11-02), BackButton's twin: press-and-HOLD arms the history menu
	 * via the caller's hold machine; a quick CLICK navigates one step.
	 * Presentational (house pattern): the caller owns canForward/busy and
	 * the hold/menu state — this button renders the glyph and reports hold
	 * down/up plus the click.
	 */
	let {
		/** Hold intent — the caller starts the long-press timer. */
		onholdstart,
		/** Hold released (up OR leave) — the caller settles the menu. */
		onholdend,
		/** Quick-click intent — one step forward. */
		onclick,
		/** Accessible name (i18n'd by the caller). */
		label,
		/** The surface's own e2e seam (browser-forward). */
		testid,
		disabled = false,
		/** Caller chrome classes (glyph size, chip border, hover…). */
		class: className = ''
	}: {
		onholdstart: () => void;
		onholdend: () => void;
		onclick: () => void;
		label: string;
		testid: string;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	class={className}
	data-testid={testid}
	aria-label={label}
	title={label}
	{disabled}
	onmousedown={onholdstart}
	onmouseup={onholdend}
	onmouseleave={onholdend}
	{onclick}
>→</button>

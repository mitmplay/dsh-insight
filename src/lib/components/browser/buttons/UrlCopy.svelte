<script lang="ts">
	/**
	 * UrlCopy — the prefix copy-URL chip (extracted from BrowserHeader
	 * 2026-11-02; the focus-polish correction that put the icon on the
	 * LEADING edge of the input, prefix-icon style). Copies the FOCUSED
	 * tab's URL; the copied state flips the icon to a check. Presentational
	 * (house pattern): the caller owns what copying means and when the
	 * check reverts — this chip renders the state and reports the intent.
	 */
	import { Check, Copy } from '@lucide/svelte';

	let {
		/** True during the copied flash — the check icon arm. */
		copied = false,
		/** Copy intent — the caller's copy logic (focused tab's URL). */
		oncopy,
		/** No focused URL — the chip goes quiet. */
		disabled = false,
		/** Accessible name / tooltip (rest + copied arms). */
		label,
		/** Copied-arm tooltip (usually a static 'Copied'). */
		copiedLabel,
		/** The surface's own e2e seam (browser-copy-url). */
		testid,
		/** Caller chrome classes (chip size, border, hover…). */
		class: className = ''
	}: {
		copied?: boolean;
		oncopy: () => void;
		disabled?: boolean;
		label: string;
		copiedLabel?: string;
		testid: string;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	class={className}
	data-testid={testid}
	aria-label={copied ? (copiedLabel ?? label) : label}
	title={copied ? (copiedLabel ?? label) : label}
	{disabled}
	onclick={oncopy}
>
	{#if copied}<Check size={12} />{:else}<Copy size={12} />{/if}
</button>

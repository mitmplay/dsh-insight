<script lang="ts">
	/**
	 * UrlInput — the search-style URL box (extracted from BrowserHeader
	 * 2026-11-02; glass-tab-ids Task 4 grammar): Escape restores the
	 * placeholder (clears the draft), Enter submits; the panel's answer —
	 * never Enter — is what settles the value. IME safety: Enter during
	 * composition confirms the candidate string, never the omnibox command.
	 * Presentational (house pattern): the caller owns what a submit means.
	 */
	let {
		/** The draft URL text — two-way with the caller. */
		value = $bindable(''),
		/** Placeholder (the caller i18n's the default). */
		placeholder = '',
		/** Quiet while a proxy verb is in flight or the session isn't live. */
		disabled = false,
		/** Submit intent — the caller's navigate logic. */
		onsubmit,
		/** The surface's own e2e seam (browser-url-input). */
		testid,
		/** Caller chrome classes (flex growth, border, padding…). */
		class: className = ''
	}: {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		onsubmit: (value: string) => void;
		testid: string;
		class?: string;
	} = $props();
</script>

<input
	class={className}
	type="text"
	data-testid={testid}
	{placeholder}
	{disabled}
	bind:value
	onkeydown={(e) => {
		// IME safety: Enter during composition confirms the candidate
		// string, never the omnibox command.
		if (e.isComposing) return;
		// glass-tab-ids Task 4: Escape restores the placeholder (clears).
		if (e.key === 'Escape') {
			value = '';
			return;
		}
		if (e.key === 'Enter') onsubmit(value);
	}}
/>
